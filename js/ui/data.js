import { h, dialog, para, toast, download, dmy, field, changeTable } from './dom.js';
import * as D from '../decimal.js';
import * as A from '../actions.js';
import * as C from '../calc.js';
import { checkFile, migrate, emptyState, dataProblems } from '../model.js';
import { buildFromSheets, toSheets, mergeImport } from '../importer.js';
import { askRecalc } from './capital.js';
import { safetyBackup } from './app.js';
import { excelCopiesToDelete } from '../storage.js';
import { goSection as goSettingsSection } from './settings.js';

let XLSXp;
export function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return XLSXp ??= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/xlsx.full.min.js'; s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('The Excel component could not be loaded.')); document.head.append(s); });
}
const stampName = () => new Date().toISOString().slice(0, 10);

// Layout 2026-11-06 (after his "Safety Centre" example): a left menu with five sections; every action and rule stays as agreed
// (import kinds, checks, backups first, typed DELETE, Trash 15 days, change log never erased).
let lastSection = 'overview';
const SECTIONS = [['overview', 'Overview', 'Main actions'], ['backups', 'Backups', 'Recovery points'], ['excel', 'Excel copies', 'Readable copies'], ['trash', 'Trash and activity', 'Deleted items and log']];
const card = (title, tag, ...kids) => h('section', { class: 'scard' }, h('div', { class: 'sch' }, h('h3', null, title), tag ? h('span', { class: 'stag' }, tag) : null), h('div', { class: 'scb' }, kids));
const task = (eyebrow, title, text, tone, ...buttons) => h('section', { class: 'task ' + (tone || '') }, h('div', { class: 'te' }, eyebrow), h('h3', null, title), h('p', null, text), h('div', { class: 'row' }, buttons));
const when = (iso) => dmy(iso.slice(0, 10)) + ' · ' + new Date(iso).toTimeString().slice(0, 5);
export function render(ctx) {
  const panes = {}; const navBtns = {}; const head = h('div', { class: 'spane-h' });
  const titles = { overview: ['What do you want to do?', 'Choose one task. Technical details stay out of the way until you need them.'], backups: ['Recovery backups', 'Complete JSON copies kept in the “Backups” folder next to your data file.'], excel: ['Excel copies', 'Readable files for analysis and review in Excel or Google Sheets.'], trash: ['Trash and activity', 'Deleted items stay 15 days. The change log is kept, except after emptying the Trash, a "New start" import, or a Restore.'], clear: ['Clear all data', 'Start with an empty journal, only after reviewing what happens.'] };
  const build = { overview: () => overviewPane(ctx, pick), backups: () => backupPane(ctx), excel: () => excelPane(ctx), trash: () => trashPane(ctx), clear: () => clearPane(ctx) };
  function pick(key) {
    lastSection = key;
    if (!panes[key]) { panes[key] = h('div', { class: 'spane-b' }, build[key]()); body.append(panes[key]); }
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== key;
    for (const [k, b] of Object.entries(navBtns)) b.classList.toggle('on', k === key);
    head.replaceChildren(h('div', { class: 'crumb' }, 'Import / Export / ' + (SECTIONS.find((x) => x[0] === key)?.[1] ?? 'Clear all data')), h('h2', null, titles[key][0]), h('p', null, titles[key][1]));
  }
  const body = h('div', { style: { display: 'contents' } });
  const nav = h('nav', { class: 'snav', 'aria-label': 'Import and export sections' },
    ...SECTIONS.map(([k, t, sub]) => (navBtns[k] = h('button', { type: 'button', onClick: () => pick(k) }, h('b', null, t), h('span', null, sub)))),
    h('div', { class: 'snav-sep' }),
    (navBtns.clear = h('button', { type: 'button', class: 'danger', onClick: () => pick('clear') }, h('b', null, 'Clear all data'), h('span', null, 'Danger zone'))));
  const status = h('span', { class: 'set-status' }, 'Checking backups…');
  ctx.storage.listBackups().then((l) => { status.className = 'set-status ' + (l.length ? 'ok' : 'warn'); status.textContent = l.length ? 'Protected · latest backup ' + when(l[0].time) : 'No backup yet'; }).catch(() => { status.className = 'set-status warn'; status.textContent = 'Backups could not be checked'; });
  const root = h('div', { class: 'sset' }, h('div', { class: 'sset-top' }, status), h('div', { class: 'sset-grid' }, nav, h('div', { class: 'spane' }, head, body,
    h('p', { class: 'note', style: { textAlign: 'center', margin: '4px 0 0' } }, 'Every import is checked first. If an error is found, nothing changes.'))));
  pick(build[lastSection] ? lastSection : 'overview');
  return root;
}

// ------------------------------------------------------------- overview: the main tasks
function overviewPane(ctx, pick) {
  const latest = h('div', { class: 'latest' }, h('div', null, h('b', null, 'Latest recovery point'), h('span', null, 'Loading…')));
  ctx.storage.listBackups().then((l) => {
    if (!l.length) return latest.replaceChildren(h('div', null, h('b', null, 'Latest recovery point'), h('span', null, 'No backup yet. The first one is made when you open the program with changed data, or with “Back up now”.')), h('div', { class: 'row' }, h('button', { class: 'btn', disabled: ctx.readOnly, onClick: () => pick('backups') }, 'Go to backups')));
    const b = l[0];
    latest.replaceChildren(h('div', null, h('b', null, 'Latest recovery point'), h('span', null, when(b.time) + ' · ' + (KIND[b.kind] || b.kind))),
      h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => downloadBackup(ctx, b) }, 'Download'), h('button', { class: 'btn', disabled: ctx.readOnly, onClick: () => restoreBackup(ctx, b) }, 'Restore…')));
  }).catch((e) => latest.replaceChildren(h('div', null, h('b', null, 'Latest recovery point'), h('span', { class: 'err' }, 'Could not load the backups: ' + e.message))));
  const imp = importControls(ctx);
  return [
    task('Most common', 'Take a copy of my journal', 'An Excel file for reading and analysis (same sheets as the import template, so it can be imported again), or a complete data file (.json) with everything, including settings, stop history and the change log.', 'acc',
      h('button', { class: 'btn pri', onClick: () => downloadExcel(ctx) }, 'Download Excel'), h('button', { class: 'btn', onClick: () => downloadJson(ctx) }, 'Download complete backup (.json)')),
    h('div', { class: 'task-grid' },
      task('Bring data in', 'Import from Excel', 'Update keeps your data and adds what is new. New start replaces everything. You choose first; a backup is always made before anything changes.', '',
        h('button', { class: 'btn', disabled: ctx.readOnly, onClick: imp.choose }, 'Import Excel…'), imp.xin),
      task('Recover journal', 'Restore from a data file', 'Replace all data with a complete data file (.json) you saved before. A backup of the current data is made first, and you confirm by typing DELETE.', '',
        h('button', { class: 'btn', disabled: ctx.readOnly, onClick: () => imp.jin.click() }, 'Choose data file…'), imp.jin)),
    latest,
  ];
}
// ------------------------------------------------------------- export
async function downloadExcel(ctx) { try { const X = await loadXLSX(); download(`TradeJournal-${stampName()}.xlsx`, toXlsx(X, toSheets(ctx.store.state))); } catch (e) { toast(e.message); } }
function downloadJson(ctx) { download(`TradeJournal-${stampName()}.json`, new Blob([JSON.stringify(ctx.store.state, null, 1)], { type: 'application/json' })); }
export function toXlsx(X, sheets) {
  const wb = X.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const ws = X.utils.aoa_to_sheet([headers]);
    rows.forEach((r, ri) => headers.forEach((hd, ci) => {
      const v = r[hd]; if (v === '' || v === undefined) return; const ref = X.utils.encode_cell({ r: ri + 1, c: ci });
      if (v.d) { const [y, m, d] = v.d.split('-').map(Number); ws[ref] = { t: 'n', v: Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000), z: 'dd-mm-yyyy' }; }
      else if (v.n !== undefined) ws[ref] = { t: 'n', v: Number(v.n) };
      else ws[ref] = { t: 's', v: String(v) };
    }));
    ws['!ref'] = X.utils.encode_range({ r: 0, c: 0 }, { r: Math.max(rows.length, 1), c: Math.max(headers.length - 1, 0) });
    ws['!cols'] = headers.map((x) => ({ wch: Math.max(12, x.length + 2) }));
    X.utils.book_append_sheet(wb, ws, name);
  }
  const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ------------------------------------------------------------- import / restore
function importControls(ctx) {
  let mode = 'update';
  const xin = h('input', { type: 'file', accept: '.xlsx,.xls', style: { display: 'none' }, onChange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importExcel(ctx, f, mode); } });
  const jin = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importJson(ctx, f); } });
  // Q10: first step asks which kind of import this is
  const choose = () => {
    const opt = (value, title, text, checked) => h('label', { class: 'pick' + (checked ? ' on' : '') }, h('input', { type: 'radio', name: 'imode', value, checked, onChange: (e) => { mode = value; e.target.closest('.picks').querySelectorAll('.pick').forEach((x) => x.classList.toggle('on', x.contains(e.target))); } }), h('div', null, h('b', null, title), h('span', null, text)));
    mode = 'update';
    dialog({ title: 'What kind of import is this?', ok: 'Choose Excel file…', body: h('div', { class: 'picks' },
      opt('update', 'Update: keep my data and add what is new', 'Your trades, capital and lists stay. New rows from the file are added. Rows that are already in the program are skipped and listed. A backup is made first.', true),
      opt('new', 'New start: replace all data', 'Everything in the program is replaced by the file. A backup is made first, and you confirm by typing DELETE.', false)),
      onOk: () => { xin.click(); return true; } });
  };
  return { choose, xin, jin };
}
async function importExcel(ctx, file, mode = 'new') {
  let result;
  try {
    const X = await loadXLSX(); const wb = X.read(await file.arrayBuffer(), { type: 'array' });
    const sheets = {}; for (const n of wb.SheetNames) sheets[n] = X.utils.sheet_to_json(wb.Sheets[n], { defval: '', raw: true });
    result = buildFromSheets(sheets);
  } catch (e) { return dialog({ title: 'The file could not be read', body: para(e.message, ''), info: true }); }
  const list = (items, cls) => h('ul', { style: { margin: '6px 0', paddingLeft: '18px', maxHeight: '180px', overflow: 'auto' }, class: cls }, items.slice(0, 60).map((x) => h('li', null, (x.sheet ? `${x.sheet}${x.row ? ' row ' + x.row : ''}: ` : '') + x.msg)), items.length > 60 ? h('li', null, `… and ${items.length - 60} more`) : null);
  if (!result.ok) return dialog({ title: 'Import stopped: nothing was changed', wide: true, info: true, ok: 'Close', body: h('div', null, h('div', { class: 'msg bad' }, `■ ${result.errors.length} error${result.errors.length === 1 ? '' : 's'} found. Correct the file and try again.`), list(result.errors, 'err'), result.warnings.length ? h('p', { class: 'note' }, `${result.warnings.length} warning(s) not shown.`) : null) });
  const s = result.summary; const st = ctx.store.state;
  if (mode === 'update') return importUpdate(ctx, result, list);
  const ok = await dialog({ title: 'New start: replace all data with this file?', wide: true, danger: true, ok: 'Replace all data', confirmWord: 'DELETE', body: h('div', null,
    h('p', { style: { margin: '0 0 8px' } }, 'The file contains: ', h('b', null, `${s.trades} trades (${s.open} open, ${s.closed} closed), ${s.sales} sales, ${s.flows} deposits/withdrawals, ${s.dividends} dividends, ${s.stocks} stocks.`)),
    h('p', { class: 'sub', style: { margin: '0 0 8px' } }, `This removes what is in the program now: ${st.trades.length} trades, ${st.dividends.length} dividends, ${st.capital.flows.length} capital lines and your saved layouts. Your settings stay as they are. A full backup is made first.`),
    h('div', { class: 'msg warn', style: { margin: '0 0 8px' } }, '◆ Also emptied, with no way back: the Trash, the change log, the stop-loss history, and which History trades you have already seen.'),
    result.ignoredSheets.length ? h('p', { class: 'note' }, 'Ignored sheets: ' + result.ignoredSheets.join(', ')) : null,
    result.warnings.length ? h('div', null, h('b', null, `${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'} (still imported):`), list(result.warnings, 'note')) : null),
    onOk: async () => {
      if (!(await safetyBackup('before-replace'))) return 'The backup could not be made, so nothing was replaced. Check your connection and try again.';
      const fresh = result.state; fresh.settings = structuredClone(st.settings); // settings are not part of the Excel file: keep yours
      ctx.store.replace(fresh, 'import'); toast('Imported. A backup of the old data was made first.'); return true;
    } });
  void ok;
}
async function importUpdate(ctx, result, list) {
  const m = mergeImport(ctx.store.state, result.state); const msg = (x) => ({ msg: x });
  if (!m.ok) return dialog({ title: 'Import stopped: nothing was changed', wide: true, info: true, ok: 'Close', body: h('div', null,
    h('div', { class: 'msg bad' }, `■ ${m.conflicts.length} conflict${m.conflicts.length === 1 ? '' : 's'} between the file and your data. Correct them and try again.`), list(m.conflicts.map(msg), 'err'),
    m.skipped.length ? h('p', { class: 'note' }, `${m.skipped.length} row(s) are already in the program and would be skipped.`) : null) });
  const a = m.added; const n = Object.values(a).reduce((x, y) => x + y, 0);
  if (!n) return dialog({ title: 'Nothing new in this file', info: true, ok: 'Close', body: h('div', null, para('Every row of the file is already in the program. Nothing was changed.', ''), m.skipped.length ? list(m.skipped.map(msg), 'note') : null) });
  const line = (k, label) => (a[k] ? h('li', null, `${a[k]} ${label}`) : null);
  await dialog({ title: 'Update: add these rows to your data?', wide: true, ok: 'Add to my data', body: h('div', null,
    h('b', null, 'Will be added:'), h('ul', { style: { margin: '6px 0 10px', paddingLeft: '18px' } }, line('trades', 'trades (new T-numbers)'), line('sales', 'sales'), line('flows', 'deposits/withdrawals'), line('dividends', 'dividends'), line('stocks', 'stocks'), line('setups', 'setups'), line('errors', 'errors')),
    m.skipped.length ? h('div', null, h('b', null, `Already in the program, skipped (${m.skipped.length}):`), list(m.skipped.map(msg), 'note')) : null,
    result.warnings.length ? h('div', null, h('b', null, `${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'} (still added):`), list(result.warnings, 'note')) : null,
    para('Your existing trades, capital, lists and settings stay. A full backup is made first.', 'note')),
    onOk: async () => {
      if (!(await safetyBackup('before-replace'))) return 'The backup could not be made, so nothing was added. Check your connection and try again.';
      ctx.store.replace(m.state, 'import update'); toast(`Added ${n} row${n === 1 ? '' : 's'}. A backup was made first.`); setTimeout(() => askRecalc(ctx), 0); return true;
    } });
}
async function importJson(ctx, file) {
  let raw; try { raw = JSON.parse(await file.text()); } catch { return dialog({ title: 'The file could not be read', body: para('It is not a valid data file.', ''), info: true }); }
  const c = checkFile(raw); if (!c.ok) return dialog({ title: 'Cannot use this file', body: para(c.reason, ''), info: true });
  const next = migrate(raw); await replaceWith(ctx, next, 'the data file ' + file.name);
}
async function replaceWith(ctx, next, what) {
  const st = ctx.store.state;
  const probs = dataProblems(next); // review fix 2026-11-09: a file with a wrong value is never put in place
  if (probs.length) return dialog({ title: 'Cannot use this file', info: true, body: h('pre', { class: 'note', style: { whiteSpace: 'pre-wrap', margin: 0 } }, 'Some values are not valid, so nothing was replaced:\n• ' + probs.slice(0, 8).join('\n• ') + (probs.length > 8 ? `\n… and ${probs.length - 8} more` : '')) });
  return dialog({ title: `Replace all data with ${what}?`, wide: true, danger: true, ok: 'Replace all data', confirmWord: 'DELETE', body: h('div', null,
    h('p', { style: { margin: '0 0 8px' } }, `The copy contains ${next.trades.length} trades, ${next.dividends.length} dividends and ${next.capital.flows.length} capital lines. The program holds ${st.trades.length} trades, ${st.dividends.length} dividends and ${st.capital.flows.length} capital lines now.`), para('A full backup of the current data is made first.', '')),
    onOk: async () => { if (!(await safetyBackup('before-restore'))) return 'The backup could not be made, so nothing was replaced.'; ctx.store.replace(next, 'restore'); toast('Data replaced. A backup of the previous data was made first.'); return true; } });
}

// ------------------------------------------------------------- weekly Excel copy (readable copy in the Backups folder)
export async function makeExcelCopy(ctx) {
  const X = await loadXLSX(); const blob = toXlsx(X, toSheets(ctx.store.state));
  await ctx.storage.writeExcelCopy(blob);
  for (const id of excelCopiesToDelete(await ctx.storage.listExcelCopies(), ctx.store.state.settings.excelCopyKeep)) await ctx.storage.deleteExcelCopy(id);
}
function excelPane(ctx) {
  const S = ctx.store.state.settings; const box = h('div', null, h('p', { class: 'note' }, 'Loading…'));
  ctx.storage.listExcelCopies().then((list) => box.replaceChildren(list.length ? h('div', { class: 'blist' }, list.map((b) => h('div', { class: 'brow' }, h('b', null, when(b.time)), h('span', { class: 'mut' }, b.name), h('span'),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', onClick: async () => { try { const blob = await ctx.storage.readExcelCopy(b.id); if (blob) download(b.name, blob); } catch (e) { toast(e.message); } } }, 'Download')))))
    : h('p', { class: 'note' }, 'No Excel copy yet. The first one is made at the next backup, or with “Make an Excel copy now”.'))).catch((e) => box.replaceChildren(h('p', { class: 'err' }, 'Could not load the Excel copies: ' + e.message)));
  return [
    task('Schedule', 'Readable Excel copies', `An Excel copy is made every ${S.excelCopyDays} day${S.excelCopyDays === 1 ? '' : 's'} and the newest ${S.excelCopyKeep} are kept, in the Backups folder next to your data file.`, 'acc',
      h('button', { class: 'btn pri', disabled: ctx.readOnly, onClick: async () => { try { await makeExcelCopy(ctx); toast('Excel copy made.'); ctx.redraw(); } catch (e) { toast('The Excel copy could not be made: ' + e.message); } } }, 'Make an Excel copy now'),
      h('button', { class: 'btn', onClick: () => { goSettingsSection('saving'); ctx.go('settings'); } }, 'Change schedule in Settings')),
    card('Newest copies', 'Excel or Google Sheets', box),
    task('Important difference', 'Excel is for reading; the data file is for recovery', 'Use Excel for analysis and review. To get the journal back with settings, stop history and the change log, use a JSON backup.', 'amber'),
  ];
}

// ------------------------------------------------------------- backups
const KIND = { auto: 'Automatic', manual: 'Made by you', 'before-update': 'Before an update', 'before-restore': 'Before a restore', 'before-replace': 'Before an import', 'before-clear': 'Before clearing all data' };
const KIND_TONE = { auto: 'pos', manual: 'info', 'before-update': 'warn', 'before-restore': 'warn', 'before-replace': 'neg', 'before-clear': 'neg' };
async function downloadBackup(ctx, b) { try { download(b.name || 'backup.json', new Blob([JSON.stringify(await ctx.storage.readBackup(b.id), null, 1)], { type: 'application/json' })); } catch (e) { toast(e.message); } }
async function restoreBackup(ctx, b) { try { const raw = await ctx.storage.readBackup(b.id); const c = checkFile(raw); if (!c.ok) return toast(c.reason); await replaceWith(ctx, migrate(raw), 'the backup of ' + when(b.time)); } catch (e) { toast(e.message); } }
function backupPane(ctx) {
  const kpis = h('div', { class: 'kpis' }, ...['Available', 'Latest', 'Automatic'].map((k) => h('div', { class: 'kpi' }, h('span', null, k), h('b', null, '…'))));
  const box = h('div', null, h('p', { class: 'note' }, 'Loading…'));
  ctx.storage.listBackups().then((list) => {
    const v = [String(list.length), list.length ? when(list[0].time) : '–', String(list.filter((b) => b.kind === 'auto').length)];
    kpis.querySelectorAll('.kpi b').forEach((b, i) => { b.textContent = v[i]; });
    box.replaceChildren(list.length ? h('div', { class: 'blist' }, list.map((b) => h('div', { class: 'brow' }, h('b', null, when(b.time)), h('span', { class: 'kpill ' + (KIND_TONE[b.kind] || '') }, KIND[b.kind] || b.kind), h('span'),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', onClick: () => downloadBackup(ctx, b) }, 'Download'), h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: () => restoreBackup(ctx, b) }, 'Restore…')))))
      : h('p', { class: 'note' }, 'No backups yet. The first one is made when you open the program with changed data.'));
  }).catch((e) => box.replaceChildren(h('p', { class: 'err' }, 'Could not load the backups: ' + e.message)));
  const backNow = h('button', { class: 'btn pri sm', disabled: ctx.readOnly, onClick: async () => { const ok = await safetyBackup('manual'); toast(ok ? 'Backup made.' : 'The backup could not be made.'); ctx.redraw(); } }, 'Back up now');
  return [kpis,
    h('section', { class: 'scard' }, h('div', { class: 'sch' }, h('h3', null, 'Recovery points'), backNow), h('div', { class: 'scb' }, box)),
    task('Recovery rule', 'A backup is complete', 'Each JSON backup holds all journal data, settings, stop history and the change log. Kept: the last 10, one per day for 30 days and one per month for a year. Restoring always makes a safety copy of the current data first.', 'green')];
}

// ------------------------------------------------------------- trash
const TRASH_KIND = { trade: 'Trade', dividend: 'Dividend', flow: 'Capital line', stocks: 'Stock', setups: 'Setup', errors: 'Error', sales: 'Sales' };
function trashLabel(st, e) {
  const i = e.item;
  if (e.kind === 'trade') return `${i.id} ${A.symbolOf(st, i)} · ${dmy(i.buyDate)}`;
  if (e.kind === 'dividend') return `${A.stockById(st, i.stockId)?.symbol ?? '?'} ${dmy(i.payDate)} ${D.fmt(D.d(i.amount), 2)}`;
  if (e.kind === 'flow') return `${i.type} ${dmy(i.date)} ${D.fmt(D.d(i.amount), 2)}`;
  if (e.kind === 'sales') return `${i.sales.length} sale(s) of ${i.tradeId}`;
  return i.symbol || i.name || '';
}
function trashPane(ctx) {
  const st = ctx.store.state; const items = st.trash.map((e, idx) => ({ e, idx })).reverse();
  const left = (e) => { const d = 15 - Math.floor((Date.now() - Date.parse(e.deletedAt)) / 86400000); return d <= 0 ? 'last day' : d + ' day' + (d === 1 ? '' : 's') + ' left'; };
  const trash = items.length ? h('div', { class: 'blist' }, items.map(({ e, idx }) => h('div', { class: 'brow' }, h('b', null, TRASH_KIND[e.kind] || e.kind), h('span', null, trashLabel(st, e)), h('span', { class: 'mut' }, left(e)),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: () => { const before = new Set(A.capitalDiffs(ctx.store.state).map((x) => x.id + ':' + x.after)); const r = ctx.act((d) => A.restoreFromTrash(d, idx), { label: 'restore', now: true }); toast(r.ok ? 'Restored.' : r.error); if (r.ok && A.capitalDiffs(ctx.store.state).some((x) => !before.has(x.id + ':' + x.after))) setTimeout(() => askRecalc(ctx), 0); } }, 'Restore')))))
    : h('div', { class: 'empty' }, h('b', null, 'The Trash is empty'), h('span', null, 'Deleted items appear here with the days left to restore them.'));
  const log = st.changeLog.slice(-100).reverse();
  const logEl = h('details', { class: 'logbox' }, h('summary', null, h('b', null, `${st.changeLog.length} entr${st.changeLog.length === 1 ? 'y' : 'ies'}`), h('span', null, ' · show the latest 100')),
    h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, ['When', 'What', 'Details'].map((x) => h('th', null, x)))), h('tbody', null, log.map((l) => h('tr', null, h('td', null, dmy(l.ts.slice(0, 10)) + ' ' + l.ts.slice(11, 16)), h('td', null, l.type), h('td', { class: 'mut' }, Object.entries(l).filter(([k]) => !['ts', 'type'].includes(k)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · '))))))));
  return [card('Trash', '15 days', trash), card('Change log', 'Trade changes', h('p', { class: 'snote' }, 'A record of trade changes: opening a trade, edits to quantity/buy price/commission/buy date, Initial stop, sales and their edits, removing a sale, deleting a trade, and stock splits. Deposits, withdrawals, dividends, start capital, settings and your lists (stocks/setups/errors) are not recorded here. Current stop changes are kept in a separate history that is not shown on any screen yet.'), logEl),
    task('Why this matters', 'Recover mistakes and understand changes', 'The Trash protects recently deleted items. The change log shows when and how a trade changed.', 'green')];
}

// ------------------------------------------------------------- clear all data (Q9)
function clearPane(ctx) {
  const run = async () => {
    const st = ctx.store.state;
    const first = await dialog({ title: 'Do you really want to delete all data?', danger: true, ok: 'Yes, delete all data', body: h('div', null,
      para(`This deletes everything in the program: ${st.trades.length} trades, the start capital, ${st.capital.flows.length} deposits/withdrawals, ${st.dividends.length} dividends, all lists (stocks, setups, errors), the trash, the change log and the stop history. Settings go back to their starting values.`, ''),
      para('A full backup is made first and cannot be skipped, so you can get everything back with Restore. Your backups and Excel copies in Google Drive are not deleted.', 'note')) });
    if (!first) return;
    await dialog({ title: 'Last step: delete all data', danger: true, ok: 'Delete all data', confirmWord: 'DELETE', body: para('After this the program is empty and starts from the beginning with the start capital.', ''),
      onOk: async () => {
        if (!(await safetyBackup('before-clear'))) return 'The backup could not be made, so nothing was deleted. Check your connection and try again.';
        ctx.store.replace(emptyState(), 'clear all data'); toast('All data deleted. A backup was made first.'); setTimeout(() => ctx.go('capital', { first: true }), 0); return true;
      } });
  };
  return [h('section', { class: 'scard dz' }, h('div', { class: 'sch' }, h('h3', null, 'Clear all journal data')), h('div', { class: 'scb' },
      h('p', { class: 'snote' }, 'Deletes every trade, the capital, all lists, the trash and the logs, so the program is empty and starts from the beginning. A full backup is made first and cannot be skipped. Your backups and Excel copies in Google Drive stay.'),
      h('div', { class: 'row', style: { paddingBottom: '6px' } }, h('button', { class: 'btn quiet-dng', disabled: ctx.readOnly, onClick: run }, 'Clear all data…')),
      h('p', { class: 'note', style: { margin: '6px 0 4px' } }, 'Two steps: first a review of what will be deleted, then you type DELETE.'))),
    task('Safety design', 'Destructive actions stay separate', 'Clear all data never sits next to export, backup or restore. It always needs a review step and a typed confirmation.', 'amber')];
}
