import { h, dialog, para, toast, download, dmy, field, changeTable } from './dom.js';
import * as D from '../decimal.js';
import * as A from '../actions.js';
import * as C from '../calc.js';
import { checkFile, migrate } from '../model.js';
import { buildFromSheets, toSheets } from '../importer.js';
import { safetyBackup } from './app.js';

let XLSXp;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return XLSXp ??= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/xlsx.full.min.js'; s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('The Excel component could not be loaded.')); document.head.append(s); });
}
const stampName = () => new Date().toISOString().slice(0, 10);

export function render(ctx) {
  const st = ctx.store.state;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '980px' } },
    exportPanel(ctx), importPanel(ctx), backupPanel(ctx), trashPanel(ctx), logPanel(ctx));
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
  const xin = h('input', { type: 'file', accept: '.xlsx,.xls', style: { display: 'none' }, onChange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importExcel(ctx, f); } });
  const jin = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importJson(ctx, f); } });
  return h('section', { class: 'panel' }, h('div', { class: 'ph' }, 'Import', h('span', { class: 'sub' }, 'replaces ALL data')),
    h('div', { class: 'pb', style: { display: 'grid', gap: '8px' } }, h('div', { class: 'msg warn' }, '◆ Import replaces everything in the program with the file. A full backup is made first. Any error stops the import and nothing is replaced.'),
      h('div', { class: 'row' }, h('button', { class: 'btn', disabled: ctx.readOnly, onClick: () => xin.click() }, 'Choose Excel file to replace all data…'), h('button', { class: 'btn', disabled: ctx.readOnly, onClick: () => jin.click() }, 'Restore from a data file (.json)…'), xin, jin)));
}
async function importExcel(ctx, file) {
  let result;
  try {
    const X = await loadXLSX(); const wb = X.read(await file.arrayBuffer(), { type: 'array' });
    const sheets = {}; for (const n of wb.SheetNames) sheets[n] = X.utils.sheet_to_json(wb.Sheets[n], { defval: '', raw: true });
    result = buildFromSheets(sheets);
  } catch (e) { return dialog({ title: 'The file could not be read', body: para(e.message, ''), info: true }); }
  const list = (items, cls) => h('ul', { style: { margin: '6px 0', paddingLeft: '18px', maxHeight: '180px', overflow: 'auto' }, class: cls }, items.slice(0, 60).map((x) => h('li', null, (x.sheet ? `${x.sheet}${x.row ? ' row ' + x.row : ''}: ` : '') + x.msg)), items.length > 60 ? h('li', null, `… and ${items.length - 60} more`) : null);
  if (!result.ok) return dialog({ title: 'Import stopped: nothing was changed', wide: true, info: true, ok: 'Close', body: h('div', null, h('div', { class: 'msg bad' }, `■ ${result.errors.length} error${result.errors.length === 1 ? '' : 's'} found. Correct the file and try again.`), list(result.errors, 'err'), result.warnings.length ? h('p', { class: 'note' }, `${result.warnings.length} warning(s) not shown.`) : null) });
  const s = result.summary; const st = ctx.store.state;
  const ok = await dialog({ title: 'Replace all data with this file?', wide: true, danger: true, ok: 'Replace all data', confirmWord: 'DELETE', body: h('div', null,
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

// ------------------------------------------------------------- backups
const KIND = { auto: 'Automatic', 'before-update': 'Before an update', 'before-restore': 'Before a restore', 'before-replace': 'Before an import' };
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
