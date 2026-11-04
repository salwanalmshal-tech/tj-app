import { h, dialog, para, toast, download, dmy, field, changeTable } from './dom.js';
import * as D from '../decimal.js';
import * as A from '../actions.js';
import * as C from '../calc.js';
import { checkFile, migrate, emptyState } from '../model.js';
import { buildFromSheets, toSheets, mergeImport } from '../importer.js';
import { askRecalc } from './capital.js';
import { safetyBackup } from './app.js';
import { excelCopiesToDelete } from '../storage.js';

let XLSXp;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return XLSXp ??= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/xlsx.full.min.js'; s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('The Excel component could not be loaded.')); document.head.append(s); });
}
const stampName = () => new Date().toISOString().slice(0, 10);

export function render(ctx) {
  const st = ctx.store.state;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '980px' } },
    exportPanel(ctx), importPanel(ctx), backupPanel(ctx), excelPanel(ctx), trashPanel(ctx), logPanel(ctx), clearPanel(ctx));
}

// ------------------------------------------------------------- export
function exportPanel(ctx) {
  return h('section', { class: 'panel' }, h('div', { class: 'ph' }, 'Export', h('span', { class: 'sub' }, 'your data is yours: take it any time')),
    h('div', { class: 'pb', style: { display: 'grid', gap: '8px' } }, para('The Excel file uses the same sheets and columns as the import template, so you can import it again later. The data file (.json) is a complete copy of everything, including settings, stop history and the change log.', ''),
      h('div', { class: 'row' }, h('button', { class: 'btn pri', onClick: async () => { try { const X = await loadXLSX(); download(`TradeJournal-${stampName()}.xlsx`, toXlsx(X, toSheets(ctx.store.state))); } catch (e) { toast(e.message); } } }, 'Download Excel (.xlsx)'),
        h('button', { class: 'btn', onClick: () => download(`TradeJournal-${stampName()}.json`, new Blob([JSON.stringify(ctx.store.state, null, 1)], { type: 'application/json' })) }, 'Download data file (.json)'))));
}
function toXlsx(X, sheets) {
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
function importPanel(ctx) {
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
  return h('section', { class: 'panel' }, h('div', { class: 'ph' }, 'Import', h('span', { class: 'sub' }, 'update your data, or start new')),
    h('div', { class: 'pb', style: { display: 'grid', gap: '8px' } }, para('First you choose the kind of import: Update keeps your data and adds what is new; New start replaces everything. Any error stops the import and nothing changes.', ''),
      h('div', { class: 'row' }, h('button', { class: 'btn pri', disabled: ctx.readOnly, onClick: choose }, 'Import from Excel…'), h('button', { class: 'btn', disabled: ctx.readOnly, onClick: () => jin.click() }, 'Restore from a data file (.json)…'), xin, jin)));
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
    h('p', { class: 'sub', style: { margin: '0 0 8px' } }, `This removes what is in the program now: ${st.trades.length} trades, ${st.dividends.length} dividends, ${st.capital.flows.length} capital lines, your saved layouts and your settings. A full backup is made first.`),
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
function excelPanel(ctx) {
  const S = ctx.store.state.settings; const box = h('div', { class: 'pb' }, 'Loading…');
  ctx.storage.listExcelCopies().then((list) => box.replaceChildren(list.length ? h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, ['When', 'File', ''].map((x) => h('th', null, x)))),
    h('tbody', null, list.map((b) => h('tr', null, h('td', null, dmy(b.time.slice(0, 10)) + ' · ' + new Date(b.time).toTimeString().slice(0, 5)), h('td', { class: 'mut' }, b.name),
      h('td', { class: 'r' }, h('button', { class: 'btn sm', onClick: async () => { try { const blob = await ctx.storage.readExcelCopy(b.id); if (blob) download(b.name, blob); } catch (e) { toast(e.message); } } }, 'Download')))))))
    : h('p', { class: 'note' }, 'No Excel copy yet. The first one is made the next time the program makes a backup, or with the button below.'))).catch((e) => box.replaceChildren(h('p', { class: 'err' }, 'Could not load the Excel copies: ' + e.message)));
  return h('section', { class: 'panel' }, h('div', { class: 'ph' }, 'Excel copies', h('span', { class: 'sub' }, `every ${S.excelCopyDays} day${S.excelCopyDays === 1 ? '' : 's'}, newest ${S.excelCopyKeep} kept · change in Settings`)),
    h('div', { class: 'pb', style: { paddingBottom: 0 } }, para('A readable Excel file of your journal, in the Backups folder next to your data file. Open it in Excel or Google Sheets. To restore, use the JSON backups above.', '')), box,
    h('div', { class: 'pb' }, h('button', { class: 'btn', disabled: ctx.readOnly, onClick: async () => { try { await makeExcelCopy(ctx); toast('Excel copy made.'); ctx.redraw(); } catch (e) { toast('The Excel copy could not be made: ' + e.message); } } }, 'Make an Excel copy now')));
}

// ------------------------------------------------------------- backups
const KIND = { auto: 'Automatic', manual: 'Made by you', 'before-update': 'Before an update', 'before-restore': 'Before a restore', 'before-replace': 'Before an import', 'before-clear': 'Before clearing all data' };
function backupPanel(ctx) {
  const box = h('div', { class: 'pb' }, 'Loading…');
  ctx.storage.listBackups().then((list) => {
    box.replaceChildren(list.length ? h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, ['When', 'Kind', ''].map((x) => h('th', null, x)))), h('tbody', null, list.map((b) => h('tr', null, h('td', null, dmy(b.time.slice(0, 10)) + ' ' + b.time.slice(11, 16)), h('td', null, KIND[b.kind] || b.kind),
      h('td', { class: 'r' }, h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn sm', onClick: async () => { try { download(b.name || 'backup.json', new Blob([JSON.stringify(await ctx.storage.readBackup(b.id), null, 1)], { type: 'application/json' })); } catch (e) { toast(e.message); } } }, 'Download'),
        h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: async () => { try { const raw = await ctx.storage.readBackup(b.id); const c = checkFile(raw); if (!c.ok) return toast(c.reason); await replaceWith(ctx, migrate(raw), 'the backup of ' + dmy(b.time.slice(0, 10))); } catch (e) { toast(e.message); } } }, 'Restore…')))))))) : h('p', { class: 'note' }, 'No backups yet. The first one is made when you open the program with changed data.'));
  }).catch((e) => box.replaceChildren(h('p', { class: 'err' }, 'Could not load the backups: ' + e.message)));
  return h('section', { class: 'panel' }, h('div', { class: 'ph' }, 'Backups', h('span', { class: 'sub' }, 'kept in the “Backups” folder next to your data file')), box,
    h('div', { class: 'pb' }, h('button', { class: 'btn', disabled: ctx.readOnly, onClick: async () => { const ok = await safetyBackup('manual'); toast(ok ? 'Backup made.' : 'The backup could not be made.'); ctx.redraw(); } }, 'Back up now')));
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
function trashPanel(ctx) {
  const st = ctx.store.state; const items = st.trash.map((e, idx) => ({ e, idx })).reverse();
  return h('section', { class: 'panel' }, h('div', { class: 'ph' }, 'Trash', h('span', { class: 'sub' }, 'deleted items stay 15 days')),
    items.length ? h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, ['Deleted', 'Kind', 'Item', ''].map((x) => h('th', null, x)))), h('tbody', null, items.map(({ e, idx }) => h('tr', null, h('td', null, dmy(e.deletedAt.slice(0, 10))), h('td', null, TRASH_KIND[e.kind] || e.kind), h('td', null, trashLabel(st, e)),
      h('td', { class: 'r' }, h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: () => { const r = ctx.act((d) => { const x = A.restoreFromTrash(d, idx); if (x.ok) A.recalcCapital(d); return x; }, { label: 'restore', now: true }); toast(r.ok ? 'Restored.' : r.error); } }, 'Restore'))))))) : h('div', { class: 'pb note' }, 'The Trash is empty.'));
}
function logPanel(ctx) {
  const st = ctx.store.state; const log = st.changeLog.slice(-100).reverse();
  return h('details', { class: 'panel' }, h('summary', { class: 'ph', style: { cursor: 'pointer' } }, `Change log (${st.changeLog.length} entries, never erased)`),
    h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, ['When', 'What', 'Details'].map((x) => h('th', null, x)))), h('tbody', null, log.map((l) => h('tr', null, h('td', null, dmy(l.ts.slice(0, 10)) + ' ' + l.ts.slice(11, 16)), h('td', null, l.type), h('td', { class: 'mut' }, Object.entries(l).filter(([k]) => !['ts', 'type'].includes(k)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · '))))))));
}

// ------------------------------------------------------------- clear all data (Q9)
function clearPanel(ctx) {
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
  return h('section', { class: 'panel', style: { borderColor: 'var(--negline)' } }, h('div', { class: 'ph' }, 'Clear all data', h('span', { class: 'sub' }, 'start again from the beginning')),
    h('div', { class: 'pb', style: { display: 'grid', gap: '8px' } }, para('Deletes every trade, the capital, all lists and the logs, so the program is empty. A full backup is made first. Backups and Excel copies in Google Drive stay.', ''),
      h('div', { class: 'row' }, h('button', { class: 'btn quiet-dng', disabled: ctx.readOnly, onClick: run }, 'Clear all data…'))));
}
