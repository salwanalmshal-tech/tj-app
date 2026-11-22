// Scans tab. 1.8.0 Step 1; 1.8.1 (his choices 2026-11-22): status menu in the Status column (+ Not decided); Scanners panel
// with View (click a scan = see only it) and Compare (tick 2+); two scans of the SAME scanner = "What changed" (Joined / Left
// / Stayed); fold a scanner, rename or delete it (Trash); a filter row that always shows what is on; Review | Lists switch:
// ready-made lists + his own folders and lists (folder = one TradingView watchlist, list = a section), L / Add to list / Select,
// pop-ups when a stock is in other lists, marks + Clean up for rejected or bought stocks, downloads as one file or separate.
import { h, dialog, para, toast, download, dmy, field } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';
import * as A from '../actions.js';
import * as SC from '../scans.js';

const V = { page: 'review', mode: 'view', view: null, pick: [], sel: null, more: {}, f: SC.emptyFilter(), fOpen: false, selMode: false, ticked: new Set(), stayOpen: false, onlyJoined: false, list: null, dl: new Set(), lfold: {} };
let CTX = null;
let LAST = { rows: [] };

const isTyping = (el) => !!el && (el.closest?.('input, textarea, select, [contenteditable="true"]'));
const dialogOpen = () => !!document.querySelector('.scrim, .sc-menu');
const tvUrl = (r) => 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(r.full.includes(':') ? r.full : r.t);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- keys and paste (only on the Scans tab)
if (typeof document !== 'undefined') {
  document.addEventListener('paste', (e) => {
    if (!CTX || CTX.route !== 'scans' || isTyping(e.target) || dialogOpen()) return;
    const text = e.clipboardData?.getData('text') ?? ''; if (!text.trim()) return;
    e.preventDefault(); takePaste(CTX, text);
  });
  document.addEventListener('keydown', (e) => {
    if (!CTX || CTX.route !== 'scans' || V.page !== 'review' || isTyping(e.target) || dialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key; const rows = LAST.rows; if (k === '?') { e.preventDefault(); keysHelp(); return; } if (!rows.length) return;
    const i = Math.max(0, rows.findIndex((r) => r.t === V.sel));
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); const j = Math.min(rows.length - 1, Math.max(0, i + (k === 'ArrowDown' ? 1 : -1))); V.sel = rows[j].t; CTX.redraw(); return; }
    const cur = rows[i]; if (!cur) return;
    const key = k.toLowerCase();
    if (key === 'n') { e.preventDefault(); setStatus(CTX, cur, 'near'); }
    else if (key === 'w') { e.preventDefault(); setStatus(CTX, cur, 'watch'); }
    else if (key === 'r') { e.preventDefault(); rejectDialog(CTX, cur); }
    else if (key === 'l') { e.preventDefault(); addToListDialog(CTX, [cur]); }
    else if (k === 'Enter') { e.preventDefault(); window.open(tvUrl(cur), '_blank', 'noopener'); }
  });
}

// ---------------------------------------------------------------- page
export function render(ctx) {
  CTX = ctx; const st = ctx.store.state;
  const groups = SC.runsByScanner(st);
  const head = h('header', { class: 'pg-head sc-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'Trade'), h('h1', null, 'Scans'),
    h('p', { class: 'lead' }, 'Your scanner results, the stocks they have in common, and your decision on each one.')),
    h('div', { class: 'sc-headbtns' },
      h('div', { class: 'seg sc-pages', role: 'tablist', 'aria-label': 'Scans view' }, ['review', 'lists'].map((p) => h('button', { type: 'button', role: 'tab', class: V.page === p ? 'on' : '', 'aria-selected': String(V.page === p), onClick: () => { V.page = p; ctx.redraw(); } }, p === 'review' ? 'Review' : 'Lists'))),
      h('button', { class: 'btn sm', onClick: () => collectHelp() }, 'Get TJ Collect'), h('button', { class: 'btn sm', 'aria-label': 'Keyboard keys', onClick: () => keysHelp() }, 'Keys ?')));
  if (V.page === 'lists') return h('div', { class: 'scans' }, head, listsPage(ctx, st));
  if (!groups.length) return h('div', { class: 'scans' }, head, emptyState(ctx));
  return h('div', { class: 'scans' }, head, reviewPage(ctx, st, groups));
}

function reviewPage(ctx, st, groups) {
  const today = ctx.today(); const ids = new Set(st.scans.runs.map((r) => r.id));
  if (!ids.has(V.view)) V.view = groups[0].runs[0].id;
  V.pick = V.pick.filter((id) => ids.has(id));
  const pick = V.mode === 'compare' ? (V.pick.length ? V.pick : [V.view]) : [V.view];
  const kind = pick.length >= 2 ? SC.compareMode(st, pick) : 'one';
  const cmp = kind === 'changes' ? SC.changes(st, pick, today) : SC.compare(st, pick, today);
  const info = tradeInfo(st);
  let base = cmp.rows; if (kind === 'changes' && V.onlyJoined) base = base.filter((r) => r.chg === 'joined');
  const fr = SC.applyFilter(base, V.f, { isOpen: (t) => !!info.get(t)?.open, traded: (t) => !!info.get(t)?.closed.length });
  const nav = kind === 'changes' && !V.stayOpen ? fr.rows.filter((r) => r.chg !== 'stayed') : fr.rows;
  LAST = { rows: nav };
  if (!nav.some((r) => r.t === V.sel)) V.sel = nav[0]?.t ?? null;
  const sel = fr.rows.find((r) => r.t === V.sel) || null;

  const scannersToday = groups.filter((g) => g.runs[0].date === today).length;
  const decided = cmp.rows.filter((r) => r.mark).length; const near = Object.values(st.scans.marks).filter((m) => m.st === 'near').length;
  const stepNow = scannersToday < groups.length ? 0 : decided < cmp.rows.length ? 1 : 2;
  const step = (i, title, text, onClick) => h('button', { type: 'button', class: 'sc-step' + (i === stepNow ? ' now' : '') + (i < stepNow ? ' done' : ''), onClick }, h('b', null, `${i + 1} ${title}`), h('span', null, text));
  const steps = h('div', { class: 'sc-steps', role: 'group', 'aria-label': 'Your scan review' },
    step(0, 'Collect', `${scannersToday} of ${plural(groups.length, 'scanner')} today`, () => pasteFromButton(ctx)),
    step(1, 'Review', cmp.rows.length ? `${decided} of ${cmp.rows.length} decided` : 'No stocks here', () => { const f = nav.find((r) => !r.mark); if (f) { V.sel = f.t; ctx.redraw(); } }),
    step(2, 'Lists', `${near} near buy · ${plural(st.scans.lists.length, 'list')}`, () => { V.page = 'lists'; ctx.redraw(); }));
  return [steps, h('div', { class: 'sc-grid' }, leftPanel(ctx, st, groups, pick, today), middle(ctx, st, cmp, kind, fr, info, today), right(ctx, st, sel, info, today))];
}

function emptyState(ctx) {
  return h('section', { class: 'card sc-empty' }, h('h2', null, 'Start with your first scan'),
    h('ol', null,
      h('li', null, h('b', null, 'Put TJ Collect on your bookmarks bar. '), 'Drag this button onto the bar (show it with Ctrl + Shift + B): ', dragButton()),
      h('li', null, h('b', null, 'Open a scanner on TradingView '), 'and click TJ Collect. It copies the scanner rows with every column you see.'),
      h('li', null, h('b', null, 'Come back here and press Ctrl + V. '), 'Do the same for each scanner, then use Compare to see the stocks they have in common.')),
    h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => pasteFromButton(ctx) }, 'Paste a scan'), h('span', { class: 'note' }, 'You can also paste plain tickers, for example NVDA, AAPL, WMT.')));
}
function dragButton() {
  return h('a', { class: 'sc-drag', href: SC.collectHref(), draggable: 'true', title: 'Drag me to your bookmarks bar', onClick: (e) => { e.preventDefault(); toast('Drag this button onto your bookmarks bar. Clicking it here does nothing.'); } }, 'TJ Collect');
}
function collectHelp() {
  dialog({ title: 'Get the TJ Collect button', info: true, body: h('div', { style: { display: 'grid', gap: '10px' } },
    para('Drag the button below onto your bookmarks bar (show the bar with Ctrl + Shift + B). Then, on a TradingView scanner, click it: it copies only the scanner rows, every column you see, the scanner name and the date.', ''),
    h('div', null, dragButton()),
    para('If dragging does not work, right-click the button, choose Copy link, and paste it as the address of a new bookmark.', 'note')) });
}
function keysHelp() {
  const k = (key, what) => h('div', { class: 'sc-key' }, h('kbd', null, key), h('span', null, what));
  dialog({ title: 'Keys in Scans', info: true, body: h('div', { style: { display: 'grid', gap: '8px' } },
    k('↑ ↓', 'Move through the list'), k('N', 'Near buy'), k('R', 'Rejected (choose a reason)'), k('W', 'Watching'), k('L', 'Add to one of your lists'), k('Enter', 'Open the stock in TradingView'), k('Ctrl + V', 'Add a scan from TJ Collect'), k('?', 'This list'),
    para('The keys work only on the Review view of this tab and never while you type in a box.', 'note')) });
}

// ---------------------------------------------------------------- small pop-up menu (status menu, ⋯ menus)
let MENU_EL = null;
function closeMenu() { MENU_EL?.remove(); MENU_EL = null; document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', escKey, true); window.removeEventListener('scroll', closeMenu, true); }
const outside = (e) => { if (MENU_EL && !MENU_EL.contains(e.target)) closeMenu(); };
const escKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } };
function popMenu(anchor, label, items) {
  closeMenu();
  MENU_EL = h('div', { class: 'sc-menu', role: 'menu', 'aria-label': label }, items.filter(Boolean).map((it) => h('button', { type: 'button', role: 'menuitem', class: 'sc-mi ' + (it.cls || '') + (it.on ? ' on' : ''), onClick: (e) => { e.stopPropagation(); closeMenu(); it.fn(); } }, h('span', null, it.label), it.key ? h('kbd', null, it.key) : null)));
  document.body.append(MENU_EL);
  const b = anchor.getBoundingClientRect(); const m = MENU_EL.getBoundingClientRect();
  const left = Math.max(8, Math.min(b.right - m.width, innerWidth - m.width - 8));
  const top = b.bottom + 4 + m.height > innerHeight - 8 ? Math.max(8, b.top - m.height - 4) : b.bottom + 4;
  Object.assign(MENU_EL.style, { left: left + 'px', top: top + 'px' });
  MENU_EL.querySelector('.sc-mi')?.focus();
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', escKey, true); window.addEventListener('scroll', closeMenu, true); }, 0);
}

// ---------------------------------------------------------------- left: scanners (View / Compare)
function leftPanel(ctx, st, groups, pick, today) {
  const cmpMode = V.mode === 'compare';
  const toggle = (id, on) => { V.pick = on ? [...new Set([...pick, id])] : pick.filter((x) => x !== id); V.sel = null; ctx.redraw(); };
  const when = (r) => (r.date === today ? 'Today' : dmy(r.date));
  // two scans of one scanner on the same day: 1st, 2nd … so they can be told apart
  const nth = (r) => { const same = st.scans.runs.filter((x) => x.scanner === r.scanner && x.date === r.date).sort((a, b) => a.seq - b.seq); return same.length > 1 ? ` (${['1st', '2nd', '3rd'][same.indexOf(r)] ?? same.indexOf(r) + 1 + 'th'})` : ''; };
  const runLine = (r) => {
    const on = cmpMode ? pick.includes(r.id) : V.view === r.id;
    const main = cmpMode
      ? h('label', null, h('input', { type: 'checkbox', checked: on, onChange: (e) => toggle(r.id, e.target.checked) }), h('span', null, `${when(r)}${nth(r)} · ${r.rows.length}`), r.trimmed ? h('span', { class: 'note' }, ' · short') : null)
      : h('button', { type: 'button', class: 'sc-runbtn', 'aria-pressed': String(on), onClick: () => { V.view = r.id; V.sel = null; ctx.redraw(); } }, `${when(r)}${nth(r)} · ${r.rows.length} stocks`, r.trimmed ? h('span', { class: 'note', title: `Older than ${st.settings.scanKeepDays} days: only the tickers are kept` }, ' · short') : null);
    return h('div', { class: 'sc-run' + (on ? ' on' : '') }, main,
      h('button', { class: 'sc-x', 'aria-label': `Delete the ${r.scanner} scan of ${dmy(r.date)}`, disabled: ctx.readOnly, onClick: async () => {
        const ok = await dialog({ title: `Delete the ${r.scanner} scan of ${dmy(r.date)}?`, ok: 'Delete', danger: true, body: para('It moves to the Trash for 15 days. Your statuses on the stocks stay.', '') });
        if (!ok) return; const res = ctx.act((d) => A.deleteScanRun(d, r.id), { label: 'delete scan', now: true }); if (res.ok) toast('Scan moved to the Trash.', 'Undo', () => ctx.store.undo()); } }, '×'));
  };
  const scanner = (g) => {
    const folded = !!st.scans.fold[g.scanner]; const all = V.more[g.scanner]; const runs = all ? g.runs : g.runs.slice(0, 3);
    const menuBtn = h('button', { type: 'button', class: 'sc-dots', 'aria-label': `More for ${g.scanner}`, disabled: ctx.readOnly, onClick: (e) => popMenu(e.currentTarget, g.scanner, [
      { label: 'Rename…', fn: () => renameScannerDialog(ctx, g.scanner) },
      { label: 'Delete scanner…', cls: 'rej', fn: () => deleteScannerDialog(ctx, g) }]) }, '⋯');
    return h('div', { class: 'sc-scanner' + (folded ? ' folded' : '') },
      h('div', { class: 'sc-shead' },
        h('button', { type: 'button', class: 'sc-fold', 'aria-expanded': String(!folded), 'aria-label': (folded ? 'Open ' : 'Fold ') + g.scanner, onClick: () => { ctx.act((d) => A.setScannerFold(d, g.scanner, !folded), { label: 'fold', now: true, noUndo: true }); ctx.redraw(); } }, folded ? '▸' : '▾'),
        h('button', { type: 'button', class: 'sc-sname', title: g.scanner, onClick: () => { if (cmpMode) toggle(g.runs[0].id, !pick.includes(g.runs[0].id)); else { V.view = g.runs[0].id; V.sel = null; ctx.redraw(); } } }, g.scanner), menuBtn),
      folded ? h('div', { class: 'note sc-fnote' }, `${plural(g.runs.length, 'scan')} · newest ${when(g.runs[0]).toLowerCase()}`) : [runs.map(runLine),
        g.runs.length > 3 ? h('button', { class: 'linkish', onClick: () => { V.more[g.scanner] = !all; ctx.redraw(); } }, all ? 'Show fewer' : `Show ${g.runs.length - 3} older`) : null]);
  };
  return h('aside', { class: 'card sc-left', 'aria-label': 'Scanners' },
    h('div', { class: 'sc-lhead' }, h('h3', null, 'Scanners'),
      h('button', { class: 'btn sm' + (cmpMode ? ' pri' : ''), onClick: () => { if (cmpMode) { V.mode = 'view'; } else { V.mode = 'compare'; V.pick = [V.view]; } V.sel = null; ctx.redraw(); } }, cmpMode ? 'Done' : 'Compare')),
    cmpMode ? h('p', { class: 'note sc-hint' }, 'Tick 2 or more scans. Different scanners: the stocks found by all. Two scans of the same scanner: what changed.') : null,
    groups.map(scanner),
    h('div', { class: 'sc-paste' }, h('span', null, 'Press ', h('kbd', null, 'Ctrl'), ' + ', h('kbd', null, 'V'), ' to add a scan'), h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: () => pasteFromButton(ctx) }, 'Paste')));
}
async function renameScannerDialog(ctx, name) {
  const inp = h('input', { value: name, 'aria-label': 'Scanner name', maxlength: '60' }); setTimeout(() => inp.select(), 0);
  await dialog({ title: `Rename ${name}`, ok: 'Rename', body: h('div', { style: { display: 'grid', gap: '8px' } }, field('Name', inp), para('Use the same name as in TradingView, so TJ Collect files new scans under it.', 'note')),
    onOk: () => { const r = ctx.act((d) => A.renameScanner(d, name, inp.value), { label: 'rename scanner', now: true }); return r.ok ? true : r.error; } });
}
async function deleteScannerDialog(ctx, g) {
  const ok = await dialog({ title: `Delete ${g.scanner} and its ${plural(g.runs.length, 'scan')}?`, ok: 'Delete', danger: true, body: para('Everything moves to the Trash for 15 days, so you can restore it. Your statuses on the stocks and your lists stay.', '') });
  if (!ok) return; const r = ctx.act((d) => A.deleteScanner(d, g.scanner), { label: 'delete scanner', now: true });
  if (r.ok) toast(`${g.scanner} moved to the Trash.`, 'Undo', () => ctx.store.undo()); else toast(r.error);
}

// ---------------------------------------------------------------- middle: the stocks
function middle(ctx, st, cmp, kind, fr, info, today) {
  const shown = shownCols(st, cmp.cols);
  const r0 = cmp.runs[0];
  const title = kind === 'one' ? `${r0.scanner} · ${r0.date === today ? 'today' : dmy(r0.date)}` : kind === 'changes' ? `What changed in ${r0.scanner}` : `In all ${cmp.runs.length} ticked scans`;
  const sub = kind === 'changes' ? `${dmy(cmp.older.date)} (${cmp.older.rows.length}) → ${dmy(cmp.newer.date)} (${cmp.newer.rows.length})` : kind === 'common' ? [...new Set(cmp.runs.map((r) => r.scanner))].join(' ∩ ') : `${plural(cmp.rows.length, 'stock')}`;
  const active = SC.filterCount(V.f) + (V.f.status !== 'all' ? 1 : 0) + (V.f.q ? 1 : 0) + (V.onlyJoined ? 1 : 0);
  const top = h('div', { class: 'sc-mhead' },
    h('div', null, h('h3', null, title, h('span', { class: 'sc-count' }, fr.rows.length)),
      h('span', { class: 'note' }, active ? h('b', { class: 'sc-filtered' }, `Showing ${fr.rows.length} of ${fr.total} · filtered`) : sub)),
    h('div', { class: 'row' },
      h('button', { class: 'btn sm' + (V.selMode ? ' pri' : ''), onClick: () => { V.selMode = !V.selMode; V.ticked = new Set(); ctx.redraw(); } }, V.selMode ? 'Done selecting' : 'Select'),
      h('button', { class: 'btn sm', onClick: () => colsDialog(ctx, cmp.cols, shown) }, 'Columns')));
  const parts = [top, filterRow(ctx, fr, cmp.cols)];
  if (kind === 'changes') {
    const joined = cmp.rows.filter((r) => r.chg === 'joined');
    parts.push(h('div', { class: 'sc-actbar' }, h('span', null, h('b', null, `${joined.length} joined`), ` · ${cmp.rows.filter((r) => r.chg === 'left').length} left · ${cmp.rows.filter((r) => r.chg === 'stayed').length} stayed`),
      h('button', { class: 'btn sm', disabled: !joined.length || ctx.readOnly, onClick: () => addToListDialog(ctx, joined) }, 'Add all joined to a list…'),
      h('button', { class: 'btn sm' + (V.onlyJoined ? ' pri' : ''), 'aria-pressed': String(V.onlyJoined), onClick: () => { V.onlyJoined = !V.onlyJoined; ctx.redraw(); } }, 'Review joined only')));
  }
  if (V.selMode) {
    const vis = fr.rows.filter((r) => kind !== 'changes' || V.stayOpen || r.chg !== 'stayed'); const n = V.ticked.size;
    parts.push(h('div', { class: 'sc-actbar sel' }, h('b', null, `${n} ticked`),
      h('button', { class: 'btn sm pri', disabled: !n || ctx.readOnly, onClick: () => addToListDialog(ctx, fr.rows.filter((r) => V.ticked.has(r.t)), () => { V.ticked = new Set(); }) }, 'Add ticked to…'),
      h('button', { class: 'linkish', onClick: () => { V.ticked = new Set(vis.map((r) => r.t)); ctx.redraw(); } }, `Tick all ${vis.length}`),
      n ? h('button', { class: 'linkish', onClick: () => { V.ticked = new Set(); ctx.redraw(); } }, 'Clear') : null));
  }
  if (!fr.rows.length) {
    parts.push(h('div', { class: 'empty' }, h('b', null, fr.total ? 'No stock matches your filter' : kind === 'common' ? `No stock is in all ${cmp.runs.length} ticked scans` : 'No stocks here'),
      fr.total ? h('button', { class: 'btn sm', onClick: () => { clearFilter(); ctx.redraw(); } }, 'Clear all filters') : h('span', null, kind === 'common' ? 'Untick a scan on the left to see more.' : '')));
    return h('section', { class: 'card sc-mid' }, parts);
  }
  const ncol = shown.length + 3 + (V.selMode ? 1 : 0);
  const head = h('tr', null, V.selMode ? h('th', { class: 'sc-tk' }, '') : null, h('th', null, 'Stock'), h('th', { class: 'r', title: 'RS (scan): strength over 3, 6 and 12 months, ranked 1–99 against every stock in the scans shown. Needs Perf % 3M, 6M and 1Y columns in your scanner.' }, 'RS'), shown.map((c) => h('th', { class: 'r' }, c)), h('th', null, 'Status'));
  const body = []; let last = null;
  const GN = { 0: 'New', 1: 'Watching and near buy', 2: 'Rejected', joined: '+ Joined', left: '− Left', stayed: 'Stayed' };
  const grpOf = (r) => (kind === 'changes' ? r.chg : !r.mark ? 0 : r.mark.st === 'rej' ? 2 : 1);
  const nIn = (g) => fr.rows.filter((r) => grpOf(r) === g).length;
  for (const r of fr.rows) {
    const g = grpOf(r);
    if (g !== last) {
      last = g;
      if (g === 'stayed') body.push(h('tr', { class: 'sc-grp' }, h('td', { colspan: String(ncol) }, h('button', { type: 'button', class: 'sc-grpbtn', 'aria-expanded': String(V.stayOpen), onClick: () => { V.stayOpen = !V.stayOpen; ctx.redraw(); } }, `${V.stayOpen ? '▾' : '▸'} Stayed · ${nIn(g)}`))));
      else body.push(h('tr', { class: 'sc-grp' + (g === 'joined' ? ' joined' : g === 'left' ? ' left' : '') }, h('td', { colspan: String(ncol) }, `${GN[g]} · ${nIn(g)}`)));
    }
    if (g === 'stayed' && !V.stayOpen) continue;
    body.push(rowEl(ctx, st, r, shown, info, today, kind === 'changes' ? cmp.newer.scanner : ''));
  }
  setTimeout(() => document.querySelector('.sc-row.on')?.scrollIntoView({ block: 'nearest' }), 0);
  parts.push(h('div', { class: 'sc-tw' }, h('table', { class: 'sc-t' }, h('thead', null, head), h('tbody', null, body))),
    h('div', { class: 'note sc-foot' }, h('kbd', null, '↑'), ' ', h('kbd', null, '↓'), ' move · ', h('kbd', null, 'N'), ' near buy · ', h('kbd', null, 'R'), ' reject · ', h('kbd', null, 'W'), ' watch · ', h('kbd', null, 'L'), ' add to list · ', h('kbd', null, 'Enter'), ' TradingView'));
  return h('section', { class: 'card sc-mid' }, parts);
}
function rowEl(ctx, st, r, shown, info, today, scannerName) {
  const lists = SC.listsOf(st, r.t);
  const leftWarn = r.chg === 'left' && r.mark && r.mark.st !== 'rej';
  return h('tr', { class: 'sc-row' + (r.t === V.sel ? ' on' : '') + (r.mark?.st === 'rej' ? ' rej' : ''), 'aria-selected': String(r.t === V.sel), onClick: () => { V.sel = r.t; ctx.redraw(); } },
    V.selMode ? h('td', { class: 'sc-tk', onClick: (e) => e.stopPropagation() }, h('input', { type: 'checkbox', 'aria-label': 'Tick ' + r.t, checked: V.ticked.has(r.t), onChange: (e) => { if (e.target.checked) V.ticked.add(r.t); else V.ticked.delete(r.t); ctx.redraw(); } })) : null,
    h('td', null, h('div', { class: 'sc-sym' }, h('b', null, r.t),
      !r.mark && r.chg !== 'left' ? h('span', { class: 'sc-tag new' }, 'New') : null,
      leftWarn ? h('span', { class: 'sc-tag earn', title: `It is no longer in ${scannerName}, but you still have it as ${SC.STATUS[r.mark.st]}` }, `Left · still ${SC.STATUS[r.mark.st].toLowerCase()}`) : null,
      lists.length ? h('span', { class: 'sc-tag list', title: 'In your lists: ' + lists.map((l) => l.name).join(', ') }, `≡ ${lists.length === 1 ? lists[0].name : lists.length + ' lists'}`) : null,
      ...marks(st, r, info, today))),
    h('td', { class: 'r' + (r.rs !== null && r.rs >= 80 ? ' sc-strong' : '') }, r.rs ?? '–'),
    shown.map((c) => h('td', { class: 'r' }, r.vals[c] || '–')),
    h('td', { class: 'sc-stcell' }, h('button', { type: 'button', class: 'sc-stbtn', 'aria-haspopup': 'menu', 'aria-label': `Status of ${r.t}`, disabled: ctx.readOnly, onClick: (e) => { e.stopPropagation(); V.sel = r.t; statusMenu(ctx, r, e.currentTarget); } }, statusText(st, r.mark), h('span', { class: 'sc-caret', 'aria-hidden': 'true' }, '▾'))));
}
function statusMenu(ctx, r, anchor) {
  const cur = r.mark?.st || null;
  popMenu(anchor, `Status of ${r.t}`, [
    { label: 'Watching', key: 'W', cls: 'watch', on: cur === 'watch', fn: () => setStatus(ctx, r, 'watch') },
    { label: 'Near buy', key: 'N', cls: 'near', on: cur === 'near', fn: () => setStatus(ctx, r, 'near') },
    { label: 'Rejected…', key: 'R', cls: 'rej', on: cur === 'rej', fn: () => rejectDialog(ctx, r) },
    { label: 'Add to list…', key: 'L', cls: 'sep', fn: () => addToListDialog(ctx, [r]) },
    cur ? { label: 'Not decided', cls: 'none', fn: () => { const res = ctx.act((d) => A.clearScanMark(d, r.t), { label: `${r.t} not decided`, now: true }); if (!res.ok) toast(res.error); ctx.redraw(); } } : null]);
}

// ---------------------------------------------------------------- filter row (his wish: easy, and always clear what is on)
function clearFilter() { V.f = SC.emptyFilter(); V.onlyJoined = false; }
function setF(ctx, patch) { V.f = { ...V.f, ...patch }; ctx.redraw(); }
function filterRow(ctx, fr, cols) {
  const SN = { all: 'All', new: 'New', watch: 'Watching', near: 'Near buy', rej: 'Rejected' };
  const n = SC.filterCount(V.f);
  const q = h('input', { type: 'search', class: 'sc-q', value: V.f.q, placeholder: 'Find a ticker', 'aria-label': 'Find a ticker', 'data-keep': 'sc-q',
    onInput: (e) => { V.f = { ...V.f, q: e.target.value }; ctx.redraw(); const el = document.querySelector('[data-keep="sc-q"]'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } } });
  const row = h('div', { class: 'sc-frow' },
    h('div', { class: 'seg sc-sts', role: 'group', 'aria-label': 'Show status' }, SC.STATUS_KEYS.map((k) => h('button', { type: 'button', class: V.f.status === k ? 'on' : '', 'aria-pressed': String(V.f.status === k), onClick: () => setF(ctx, { status: k }) }, SN[k], h('span', { class: 'sc-n' }, fr.counts[k])))),
    q,
    h('button', { type: 'button', class: 'btn sm sc-fbtn' + (n ? ' active' : ''), 'aria-expanded': String(V.fOpen), onClick: () => { V.fOpen = !V.fOpen; ctx.redraw(); } }, n ? `Filter · ${n}` : 'Filter', h('span', { 'aria-hidden': 'true' }, V.fOpen ? ' ▴' : ' ▾')));
  const chips = [];
  const chip = (text, off) => h('span', { class: 'sc-fchip' }, text, h('button', { type: 'button', 'aria-label': 'Remove filter ' + text, onClick: () => { off(); ctx.redraw(); } }, '×'));
  if (V.f.status !== 'all') chips.push(chip('Status: ' + SN[V.f.status], () => { V.f = { ...V.f, status: 'all' }; }));
  if (V.f.q) chips.push(chip('Ticker has “' + V.f.q + '”', () => { V.f = { ...V.f, q: '' }; }));
  if (V.f.rsMin !== null && V.f.rsMin !== '') chips.push(chip('RS ≥ ' + V.f.rsMin, () => { V.f = { ...V.f, rsMin: null }; }));
  if (V.f.noEarn) chips.push(chip('No earnings ≤ 7 d', () => { V.f = { ...V.f, noEarn: false }; }));
  if (V.f.traded) chips.push(chip('Traded before', () => { V.f = { ...V.f, traded: false }; }));
  if (V.f.noOpen) chips.push(chip('No open positions', () => { V.f = { ...V.f, noOpen: false }; }));
  V.f.rules.forEach((ru, i) => chips.push(chip(`${ru.col} ${ru.op === 'has' ? 'has' : ru.op === '>=' ? '≥' : '≤'} ${ru.val}`, () => { V.f = { ...V.f, rules: V.f.rules.filter((_, j) => j !== i) }; })));
  if (V.onlyJoined) chips.push(chip('Joined only', () => { V.onlyJoined = false; }));
  return h('div', { class: 'sc-filter' }, row, V.fOpen ? filterPanel(ctx, cols) : null,
    chips.length ? h('div', { class: 'sc-fchips', 'aria-label': 'Filters that are on' }, chips, h('button', { type: 'button', class: 'linkish', onClick: () => { clearFilter(); ctx.redraw(); } }, 'Clear all')) : null);
}
function filterPanel(ctx, cols) {
  const rs = h('input', { type: 'number', min: '1', max: '99', value: V.f.rsMin ?? '', 'aria-label': 'RS at least', class: 'sc-num', onChange: (e) => setF(ctx, { rsMin: e.target.value === '' ? null : Math.min(99, Math.max(1, Math.round(Number(e.target.value)))) }) });
  const sw = (key, label) => h('label', { class: 'sc-sw' }, h('input', { type: 'checkbox', checked: V.f[key], onChange: (e) => setF(ctx, { [key]: e.target.checked }) }), ' ', label);
  const col = h('select', { 'aria-label': 'Column' }, cols.map((c) => h('option', { value: c }, c)));
  const op = h('select', { 'aria-label': 'Rule' }, h('option', { value: '>=' }, '≥ at least'), h('option', { value: '<=' }, '≤ at most'), h('option', { value: 'has' }, 'has text'));
  const val = h('input', { 'aria-label': 'Value', placeholder: 'e.g. 4 or 1B', class: 'sc-val' });
  const add = () => { const v = val.value.trim(); if (!v || !col.value) return toast('Choose a column and type a value.'); if (op.value !== 'has' && SC.numOf(v) === null) return toast('Type a number, for example 4, 10 or 1B.'); setF(ctx, { rules: [...V.f.rules, { col: col.value, op: op.value, val: v }] }); };
  val.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  return h('div', { class: 'sc-fpanel' },
    h('div', { class: 'sc-fline' }, h('label', { class: 'sc-sw' }, 'RS at least ', rs), sw('noEarn', 'Hide earnings within 7 days'), sw('traded', 'Only stocks I traded before'), sw('noOpen', 'Hide my open positions')),
    cols.length ? h('div', { class: 'sc-fline' }, h('span', { class: 'note' }, 'Column rule'), col, op, val, h('button', { type: 'button', class: 'btn sm', onClick: add }, 'Add rule'))
      : h('p', { class: 'note' }, 'Column rules need a scan copied with TJ Collect (plain tickers have no columns).'),
    h('div', { class: 'sc-fline end' }, h('button', { type: 'button', class: 'btn sm', onClick: () => { V.fOpen = false; ctx.redraw(); } }, 'Done')));
}

function shownCols(st, cols) {
  const saved = (st.scans?.showCols || []).filter((c) => cols.includes(c)); if (saved.length) return saved;
  const want = [/^adr/i, /sector/i, /^price$/i, /^float\s*%|float %/i, /earning/i]; const out = [];
  for (const re of want) { const c = cols.find((x) => re.test(x) && !out.includes(x)); if (c) out.push(c); }
  return out.length ? out : cols.slice(0, 4);
}
function colsDialog(ctx, cols, shown) {
  if (!cols.length) return dialog({ title: 'No columns', info: true, body: para('This scan has only tickers. Scans copied with TJ Collect bring every column you see in TradingView.', '') });
  const boxes = cols.map((c) => [c, h('input', { type: 'checkbox', checked: shown.includes(c) })]);
  dialog({ title: 'Columns to show', ok: 'Show', body: h('div', { class: 'sc-cols' }, para('Up to 8. All columns stay saved with each scan; this only chooses what you see.', 'note'), boxes.map(([c, b]) => h('label', null, b, ' ', c))),
    onOk: () => { const p = boxes.filter(([, b]) => b.checked).map(([c]) => c); if (p.length > 8) return 'Choose 8 columns at most.'; const r = ctx.act((d) => A.setScanCols(d, p), { label: 'scan columns', now: true }); return r.ok ? true : r.error; } });
}

function tradeInfo(st) {
  const m = new Map();
  for (const t of st.trades) {
    const sym = (A.symbolOf(st, t) || '').toUpperCase(); if (!m.has(sym)) m.set(sym, { open: false, closed: [] });
    const x = m.get(sym); if (C.openQty(t) > 0n) x.open = true; else if (t.sales.length) x.closed.push(t);
  }
  return m;
}
function marks(st, r, info, today) {
  const out = []; const x = info.get(r.t);
  if (x?.open) out.push(h('span', { class: 'sc-tag open', title: 'You hold this stock now' }, '● Open'));
  if (x?.closed.length) {
    const rs = x.closed.map((t) => C.rMultiple(t)).filter((v) => v !== null); const sum = rs.reduce((a, b) => a + b, 0n);
    out.push(h('span', { class: 'sc-tag past', title: x.closed.map((t) => `${t.id} · bought ${dmy(t.buyDate)}`).join('\n') }, `↺ ${plural(x.closed.length, 'trade')}` + (rs.length ? `, ${D.fmt(sum, 1, { sign: true })} R` : '')));
  }
  const seen = SC.seenCount(st, r.t, today); if (seen >= 2) out.push(h('span', { class: 'sc-tag seen', title: `Found by your scans on ${seen} different days in the last ${SC.SEEN_DAYS} days` }, `Seen ${seen} days`));
  if (r.earnings && r.earnings.days >= 0 && r.earnings.days <= 30) out.push(h('span', { class: 'sc-tag ' + (r.earnings.days <= 7 ? 'earn' : 'earnlater'), title: 'Earnings date ' + dmy(r.earnings.iso) }, r.earnings.days === 0 ? 'Earnings today' : `Earnings in ${r.earnings.days} d`));
  return out;
}
function statusText(st, m) {
  if (!m) return h('span', { class: 'sc-st new' }, 'Not decided');
  const reasons = m.st === 'rej' ? reasonNames(st, m) : '';
  return h('span', { class: 'sc-st ' + m.st, title: `${SC.STATUS[m.st]} on ${dmy(m.date)}${reasons ? ' · ' + reasons : ''}` }, SC.STATUS[m.st], m.st === 'rej' && reasons ? h('span', { class: 'sc-why' }, ' · ' + reasons) : null);
}
const reasonNames = (st, m) => [...(m.reasons || []).map((id) => st.rejects.find((x) => x.id === id)?.name).filter(Boolean), m.other || ''].filter(Boolean).join(', ');

// ---------------------------------------------------------------- right: the selected stock
function right(ctx, st, r, info, today) {
  if (!r) return h('aside', { class: 'card sc-right' }, h('div', { class: 'empty' }, h('b', null, 'No stock selected'), h('span', null, 'Pick a stock in the list.')));
  const m = r.mark; const lists = SC.listsOf(st, r.t);
  const btn = (key, label, s) => h('button', { type: 'button', class: 'sc-sbtn ' + s + (m?.st === s ? ' on' : ''), 'aria-pressed': String(m?.st === s), disabled: ctx.readOnly, onClick: () => (s === 'rej' ? rejectDialog(ctx, r) : setStatus(ctx, r, s)) }, label, h('kbd', null, key));
  const vals = Object.entries(r.vals).filter(([, v]) => v);
  return h('aside', { class: 'card sc-right', 'aria-label': 'Selected stock' },
    h('div', { class: 'sc-rhead' }, h('div', null, h('div', { class: 'sc-big' }, r.t), h('span', { class: 'note' }, (r.full.includes(':') ? r.full.split(':')[0] : 'Exchange unknown') + (r.rs !== null ? ` · RS ${r.rs}` : ''))),
      h('a', { class: 'btn sm', href: tvUrl(r), target: '_blank', rel: 'noopener' }, 'Open in TradingView ↗')),
    r.chg === 'left' ? h('div', { class: 'msg warn sc-leftmsg' }, 'It is no longer in the newer scan.' + (m && m.st !== 'rej' ? ` You still have it as ${SC.STATUS[m.st]}.` : '')) : null,
    h('div', { class: 'sc-sbtns', role: 'group', 'aria-label': 'Status' }, btn('W', 'Watching', 'watch'), btn('N', 'Near buy', 'near'), btn('R', 'Rejected', 'rej')),
    m ? h('p', { class: 'note' }, `${SC.STATUS[m.st]} since ${dmy(m.date)}` + (m.st === 'rej' && reasonNames(st, m) ? ' · ' + reasonNames(st, m) : ''), m.st === 'rej' ? h('button', { class: 'linkish', onClick: () => rejectDialog(ctx, r) }, ' Change reason') : null)
      : h('p', { class: 'note' }, 'Not decided yet.'),
    h('div', { class: 'sc-inlists' }, h('span', { class: 'note' }, lists.length ? 'In your lists: ' + lists.map((l) => l.name).join(' · ') : 'Not in any of your lists.'),
      h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: () => addToListDialog(ctx, [r]) }, 'Add to list…', h('kbd', null, 'L'))),
    h('div', { class: 'sc-marks' }, marks(st, r, info, today)),
    vals.length ? h('dl', { class: 'sc-vals' }, vals.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])) : h('p', { class: 'note' }, 'Only the ticker was pasted for this stock.'));
}

// ---------------------------------------------------------------- status
function setStatus(ctx, r, status, reasons = [], other = '') {
  const res = ctx.act((d) => A.setScanMark(d, r.t, { status, reasons, other, date: ctx.today() }), { label: `${r.t} ${SC.STATUS[status].toLowerCase()}`, now: true });
  if (!res.ok) return toast(res.error);
  const next = LAST.rows.find((x) => !x.mark && x.t !== r.t); if (next && !r.mark) V.sel = next.t;
  ctx.redraw();
}
function rejectDialog(ctx, r) {
  if (ctx.readOnly) return;
  const st = ctx.store.state; const m = r.mark?.st === 'rej' ? r.mark : null; const on = new Set(m?.reasons || []);
  const chips = st.rejects.filter((x) => !x.archived || on.has(x.id)).map((x) => { const b = h('button', { type: 'button', class: 'sc-chip' + (on.has(x.id) ? ' on' : ''), 'aria-pressed': String(on.has(x.id)), onClick: () => { if (on.has(x.id)) on.delete(x.id); else on.add(x.id); b.classList.toggle('on'); b.setAttribute('aria-pressed', String(on.has(x.id))); } }, x.name); return b; });
  const other = h('input', { value: m?.other || '', placeholder: 'Other reason (optional)', 'aria-label': 'Other reason', maxlength: '120' });
  dialog({ title: `Reject ${r.t}`, ok: 'Reject', body: h('div', { style: { display: 'grid', gap: '10px' } }, h('div', { class: 'sc-chips' }, chips), field('Other', other), para('Add or rename the chips in Lists → Reject reasons.', 'note')),
    onOk: () => { setStatus(ctx, r, 'rej', [...on], other.value); return true; } });
}

// ---------------------------------------------------------------- add to list (L, menu, right panel, Select)
// rows: [{t, full}]. After choosing a list: if some are already in OTHER lists, his pop-up asks Keep in both / Remove from those.
async function addToListDialog(ctx, rows, after) {
  if (ctx.readOnly || !rows.length) return;
  const sc = ctx.store.state.scans;
  const choice = { id: null };
  const opts = [];
  const newName = h('input', { placeholder: 'New list name', 'aria-label': 'New list name', maxlength: '60', onInput: () => { if (newName.value) { choice.id = null; for (const x of opts) { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); } } } });
  const opt = (l) => { const b = h('button', { type: 'button', class: 'sc-lopt', role: 'radio', 'aria-checked': 'false', onClick: () => { choice.id = l.id; for (const x of opts) { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); } newName.value = ''; } }, l.name, h('span', { class: 'note' }, ' · ' + l.items.length)); opts.push(b); return b; };
  const groups = [...sc.folders.map((f) => [f.name, sc.lists.filter((l) => l.folder === f.id)]), ['Not in a folder', sc.lists.filter((l) => !l.folder)]].filter(([, ls]) => ls.length);
  const folderSel = h('select', { 'aria-label': 'Folder of the new list' }, h('option', { value: '' }, 'No folder'), sc.folders.map((f) => h('option', { value: f.id }, f.name)));
  const pickBox = groups.length ? h('div', { class: 'sc-lpick', role: 'radiogroup', 'aria-label': 'Your lists' }, groups.map(([name, ls]) => h('div', null, h('div', { class: 'eyebrow' }, name), h('div', { class: 'sc-lopts' }, ls.map(opt))))) : para('You have no lists yet. Make the first one:', 'note');
  setTimeout(() => (opts.length ? opts[0] : newName).focus(), 0);
  const ok = await dialog({ title: rows.length === 1 ? `Add ${rows[0].t} to a list` : `Add ${rows.length} stocks to a list`, ok: 'Add',
    body: h('div', { style: { display: 'grid', gap: '10px' } }, pickBox, h('div', { class: 'sc-newlist' }, newName, folderSel)),
    onOk: () => (choice.id || newName.value.trim() ? true : 'Pick a list or type a name for a new one.') });
  if (!ok) return;
  let target = choice.id;
  if (!target) { const r = ctx.act((d) => A.addScanList(d, newName.value, folderSel.value || null), { label: 'new list', now: true }); if (!r.ok) return toast(r.error); target = r.data.id; }
  const st2 = ctx.store.state; const tName = st2.scans.lists.find((l) => l.id === target)?.name;
  const elsewhere = new Map(); for (const r of rows) for (const l of SC.listsOf(st2, r.t)) if (l.id !== target) { if (!elsewhere.has(l.id)) elsewhere.set(l.id, { l, t: [] }); elsewhere.get(l.id).t.push(r.t); }
  let removeFrom = [];
  if (elsewhere.size) {
    const keep = h('input', { type: 'radio', name: 'sc-else', checked: true }); const rem = h('input', { type: 'radio', name: 'sc-else' });
    const names = [...elsewhere.values()].map((x) => x.l.name);
    const lines = [...elsewhere.values()].map((x) => h('li', null, h('b', null, x.l.name), ': ' + x.t.slice(0, 12).join(', ') + (x.t.length > 12 ? '…' : '')));
    const go = await dialog({ title: rows.length === 1 ? `${rows[0].t} is also in ${names.join(', ')}` : 'Some stocks are already in other lists', ok: 'Add',
      body: h('div', { class: 'sc-dup' }, rows.length > 1 ? h('ul', { class: 'sc-ul' }, lines) : null,
        h('label', null, keep, ' Keep in both'), h('label', null, rem, ` Remove from ${names.length === 1 ? names[0] : 'those lists'}`)) });
    if (!go) return; if (rem.checked) removeFrom = [...elsewhere.keys()];
  }
  const res = ctx.act((d) => A.addToScanList(d, target, rows.map((r) => ({ t: r.t, full: r.full })), { removeFrom, date: ctx.today() }), { label: 'add to ' + tName, now: true });
  if (!res.ok) return toast(res.error);
  after?.(); ctx.redraw();
  toast(res.data.added ? `${plural(res.data.added, 'stock')} added to ${tName}.` : `Already in ${tName}.`, 'Undo', () => ctx.store.undo());
}

// ---------------------------------------------------------------- Lists view
function listsPage(ctx, st) {
  const sc = st.scans; const ready = SC.readyLists(st);
  const all = [...ready, ...sc.lists];
  if (!all.some((l) => l.id === V.list)) V.list = ready[0].id;
  const cur = all.find((l) => l.id === V.list);
  const ownIds = new Set(sc.lists.map((l) => l.id)); V.dl = new Set([...V.dl].filter((id) => ownIds.has(id)));
  const listRow = (l, own) => h('div', { class: 'sc-lrow' + (l.id === V.list ? ' on' : '') },
    own ? h('input', { type: 'checkbox', 'aria-label': 'Tick ' + l.name + ' for download', checked: V.dl.has(l.id), onChange: (e) => { if (e.target.checked) V.dl.add(l.id); else V.dl.delete(l.id); ctx.redraw(); } }) : h('span', { class: 'sc-ready', 'aria-hidden': 'true' }, '★'),
    h('button', { type: 'button', class: 'sc-lname', 'aria-pressed': String(l.id === V.list), onClick: () => { V.list = l.id; ctx.redraw(); } }, l.name),
    own && A.staleInList(st, l).length ? h('span', { class: 'sc-stale', title: 'Stocks rejected or bought since you added them' }, '!') : null,
    h('span', { class: 'sc-n' }, l.items.length));
  const folderBlock = (f) => {
    const ls = sc.lists.filter((l) => l.folder === f.id); const folded = !!V.lfold[f.id]; const allTicked = ls.length && ls.every((l) => V.dl.has(l.id));
    return h('div', { class: 'sc-folder' },
      h('div', { class: 'sc-fhead' },
        h('button', { type: 'button', class: 'sc-fold', 'aria-expanded': String(!folded), 'aria-label': (folded ? 'Open ' : 'Fold ') + f.name, onClick: () => { V.lfold[f.id] = !folded; ctx.redraw(); } }, folded ? '▸' : '▾'),
        h('input', { type: 'checkbox', 'aria-label': 'Tick all lists of ' + f.name, checked: !!allTicked, disabled: !ls.length, onChange: (e) => { for (const l of ls) { if (e.target.checked) V.dl.add(l.id); else V.dl.delete(l.id); } ctx.redraw(); } }),
        h('b', { class: 'sc-fname', title: f.name }, '▣ ' + f.name), h('span', { class: 'sc-n' }, plural(ls.length, 'list')),
        h('button', { type: 'button', class: 'sc-dots', 'aria-label': 'More for folder ' + f.name, onClick: (e) => popMenu(e.currentTarget, f.name, [
          { label: 'Download as one watchlist', fn: () => downloadSections(ctx, f.name, ls) },
          { label: 'New list in this folder…', fn: () => newListDialog(ctx, f.id) },
          { label: 'Rename…', fn: () => nameDialog(ctx, 'Rename folder', f.name, (d, v) => A.renameScanFolder(d, f.id, v)) },
          { label: 'Delete folder…', cls: 'rej', fn: () => deleteFolderDialog(ctx, f, ls) }]) }, '⋯')),
      folded ? null : (ls.length ? ls.map((l) => listRow(l, true)) : h('p', { class: 'note sc-indent' }, 'No lists yet.')));
  };
  const loose = sc.lists.filter((l) => !l.folder);
  const tick = [...V.dl].map((id) => sc.lists.find((l) => l.id === id)).filter(Boolean);
  const left = h('aside', { class: 'card sc-left sc-lists', 'aria-label': 'Lists' },
    h('h3', null, 'Ready-made'), h('p', { class: 'note' }, 'Made from your statuses. Always up to date.'), ready.map((l) => listRow(l, false)),
    h('div', { class: 'sc-lhead' }, h('h3', null, 'Your lists'), h('div', { class: 'row' }, h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: () => newFolderDialog(ctx) }, '+ Folder'), h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: () => newListDialog(ctx, null) }, '+ List'))),
    !sc.folders.length && !loose.length ? h('p', { class: 'note' }, 'A folder becomes one TradingView watchlist; its lists become the sections. Add stocks from Review with L, “Add to list…” or Select.') : null,
    sc.folders.map(folderBlock), loose.length && sc.folders.length ? h('div', { class: 'eyebrow sc-indent' }, 'Not in a folder') : null, loose.map((l) => listRow(l, true)),
    tick.length ? h('div', { class: 'sc-dlbar' }, h('b', null, `${plural(tick.length, 'list')} ticked`),
      h('button', { class: 'btn sm pri', onClick: () => downloadSections(ctx, tick.length === 1 ? tick[0].name : 'TJ lists', tick) }, 'Download as one watchlist (sections)'),
      h('button', { class: 'btn sm', onClick: () => downloadSeparate(ctx, tick) }, 'Download separate files')) : null);
  return h('div', { class: 'sc-grid2' }, left, listPanel(ctx, st, cur, ownIds.has(cur.id)));
}
function listPanel(ctx, st, l, own) {
  const info = tradeInfo(st); const stale = own ? new Set(A.staleInList(st, l)) : new Set();
  const folder = own && l.folder ? st.scans.folders.find((f) => f.id === l.folder) : null;
  const btns = [h('button', { class: 'btn sm pri', disabled: !l.items.length, onClick: () => downloadOne(ctx, l) }, 'Download for TradingView')];
  if (!own) btns.push(h('button', { class: 'btn sm', disabled: !l.items.length || ctx.readOnly, onClick: () => addToListDialog(ctx, l.items) }, 'Add all to a list…'));
  else {
    if (stale.size) btns.push(h('button', { class: 'btn sm sc-clean', disabled: ctx.readOnly, onClick: () => cleanUpDialog(ctx, l, stale) }, `Clean up ${stale.size}`));
    btns.push(h('button', { type: 'button', class: 'btn sm', 'aria-label': 'More for list ' + l.name, disabled: ctx.readOnly, onClick: (e) => popMenu(e.currentTarget, l.name, [
      { label: 'Rename…', fn: () => nameDialog(ctx, 'Rename list', l.name, (d, v) => A.renameScanList(d, l.id, v)) },
      { label: 'Move to folder…', fn: () => moveListDialog(ctx, l) },
      { label: 'Delete list…', cls: 'rej', fn: () => deleteListDialog(ctx, l) }]) }, '⋯'));
  }
  const top = h('div', { class: 'sc-mhead' }, h('div', null, h('h3', null, l.name, h('span', { class: 'sc-count' }, l.items.length)),
    h('span', { class: 'note' }, own ? (folder ? `In folder ${folder.name} · a section of that watchlist` : 'Not in a folder') : 'Ready-made from your statuses')), h('div', { class: 'row' }, btns));
  if (!l.items.length) return h('section', { class: 'card sc-mid' }, top, h('div', { class: 'empty' }, h('b', null, 'This list is empty'), h('span', null, own ? 'In Review, select a stock and press L, or use Select to add many at once.' : l.id === 'ready-watch' ? 'Mark stocks Watching (W) in Review.' : 'Mark stocks Near buy (N) in Review.')));
  const rows = l.items.map((x) => {
    const m = st.scans.marks[x.t]; const others = SC.listsOf(st, x.t).filter((o) => o.id !== l.id); const i = info.get(x.t);
    return h('tr', { class: 'sc-row' + (stale.has(x.t) ? ' rej' : '') },
      h('td', null, h('div', { class: 'sc-sym' }, h('b', null, x.t), h('span', { class: 'note' }, x.full.includes(':') ? x.full.split(':')[0] : ''),
        m?.st === 'rej' ? h('span', { class: 'sc-tag earn' }, 'Rejected') : null, i?.open ? h('span', { class: 'sc-tag open' }, '● Open') : null)),
      h('td', null, m ? statusText(st, m) : h('span', { class: 'sc-st new' }, 'Not decided')),
      h('td', { class: 'note' }, others.length ? 'Also in ' + others.map((o) => o.name).join(', ') : ''),
      own ? h('td', { class: 'note' }, x.added ? dmy(x.added) : '') : null,
      h('td', { class: 'r sc-acts' },
        h('a', { class: 'sc-iconbtn', href: tvUrl({ t: x.t, full: x.full }), target: '_blank', rel: 'noopener', 'aria-label': 'Open ' + x.t + ' in TradingView', title: 'Open in TradingView' }, '↗'),
        own ? h('button', { type: 'button', class: 'sc-iconbtn', 'aria-label': 'Move ' + x.t, title: 'Move to another list', disabled: ctx.readOnly, onClick: () => moveItemDialog(ctx, l, x) }, '⇄') : null,
        own ? h('button', { type: 'button', class: 'sc-iconbtn', 'aria-label': 'Remove ' + x.t, title: 'Remove from this list', disabled: ctx.readOnly, onClick: () => removeItem(ctx, l, x, others) }, '×') : null));
  });
  return h('section', { class: 'card sc-mid' }, top,
    stale.size ? h('div', { class: 'msg warn sc-leftmsg' }, `${plural(stale.size, 'stock')} rejected or bought since you added ${stale.size === 1 ? 'it' : 'them'}. They are marked below; Clean up removes them.`) : null,
    h('div', { class: 'sc-tw' }, h('table', { class: 'sc-t' }, h('thead', null, h('tr', null, h('th', null, 'Stock'), h('th', null, 'Status'), h('th', null, 'Other lists'), own ? h('th', null, 'Added') : null, h('th', { class: 'r' }, ''))), h('tbody', null, rows))));
}
async function nameDialog(ctx, title, value, act) {
  const inp = h('input', { value, maxlength: '60', 'aria-label': 'Name' }); setTimeout(() => inp.select(), 0);
  await dialog({ title, ok: 'Save', body: field('Name', inp), onOk: () => { const r = ctx.act((d) => act(d, inp.value), { label: title.toLowerCase(), now: true }); return r.ok ? true : r.error; } });
  ctx.redraw();
}
async function newFolderDialog(ctx) {
  const inp = h('input', { maxlength: '60', 'aria-label': 'Folder name', placeholder: 'e.g. Swing December' }); setTimeout(() => inp.focus(), 0);
  await dialog({ title: 'New folder', ok: 'Create', body: h('div', { style: { display: 'grid', gap: '8px' } }, field('Name', inp), para('A folder becomes one watchlist in TradingView; its lists become the sections.', 'note')),
    onOk: () => { const r = ctx.act((d) => A.addScanFolder(d, inp.value), { label: 'new folder', now: true }); return r.ok ? true : r.error; } });
  ctx.redraw();
}
async function newListDialog(ctx, folder) {
  const sc = ctx.store.state.scans;
  const inp = h('input', { maxlength: '60', 'aria-label': 'List name', placeholder: 'e.g. Tier A' }); setTimeout(() => inp.focus(), 0);
  const sel = h('select', { 'aria-label': 'Folder' }, h('option', { value: '' }, 'No folder'), sc.folders.map((f) => h('option', { value: f.id, selected: f.id === folder }, f.name)));
  let made = null;
  await dialog({ title: 'New list', ok: 'Create', body: h('div', { style: { display: 'grid', gap: '8px' } }, field('Name', inp), field('Folder', sel)),
    onOk: () => { const r = ctx.act((d) => A.addScanList(d, inp.value, sel.value || null), { label: 'new list', now: true }); if (r.ok) made = r.data.id; return r.ok ? true : r.error; } });
  if (made) V.list = made; ctx.redraw();
}
async function moveListDialog(ctx, l) {
  const sc = ctx.store.state.scans;
  const sel = h('select', { 'aria-label': 'Folder' }, h('option', { value: '' }, 'No folder'), sc.folders.map((f) => h('option', { value: f.id, selected: f.id === l.folder }, f.name)));
  await dialog({ title: `Move ${l.name}`, ok: 'Move', body: field('To folder', sel), onOk: () => { const r = ctx.act((d) => A.moveScanList(d, l.id, sel.value || null), { label: 'move list', now: true }); return r.ok ? true : r.error; } });
  ctx.redraw();
}
async function deleteListDialog(ctx, l) {
  const ok = await dialog({ title: `Delete the list ${l.name}?`, ok: 'Delete', danger: true, body: para(`Its ${plural(l.items.length, 'stock')} leave this list only. It moves to the Trash for 15 days.`, '') });
  if (!ok) return; const r = ctx.act((d) => A.deleteScanList(d, l.id), { label: 'delete list', now: true }); if (r.ok) toast(`${l.name} moved to the Trash.`, 'Undo', () => ctx.store.undo()); ctx.redraw();
}
async function deleteFolderDialog(ctx, f, ls) {
  const ok = await dialog({ title: `Delete the folder ${f.name}?`, ok: 'Delete', danger: true, body: para(ls.length ? `Its ${plural(ls.length, 'list')} (${ls.map((l) => l.name).join(', ')}) go with it. Everything moves to the Trash for 15 days.` : 'It is empty. It moves to the Trash for 15 days.', '') });
  if (!ok) return; const r = ctx.act((d) => A.deleteScanFolder(d, f.id), { label: 'delete folder', now: true }); if (r.ok) toast(`${f.name} moved to the Trash.`, 'Undo', () => ctx.store.undo()); ctx.redraw();
}
async function removeItem(ctx, l, x, others) {
  let all = false;
  if (others.length) {
    const only = h('input', { type: 'radio', name: 'sc-rm', checked: true }); const every = h('input', { type: 'radio', name: 'sc-rm' });
    const ok = await dialog({ title: `${x.t} is also in ${others.map((o) => o.name).join(', ')}`, ok: 'Remove', body: h('div', { class: 'sc-dup' }, h('label', null, only, ` Remove only from ${l.name}`), h('label', null, every, ' Remove from all lists')) });
    if (!ok) return; all = every.checked;
  }
  const r = ctx.act((d) => A.removeFromScanList(d, l.id, [x.t], { all }), { label: `remove ${x.t}`, now: true });
  if (r.ok) toast(`${x.t} removed${all ? ' from all lists' : ''}.`, 'Undo', () => ctx.store.undo()); else toast(r.error); ctx.redraw();
}
async function moveItemDialog(ctx, l, x) {
  const sc = ctx.store.state.scans; const others = sc.lists.filter((o) => o.id !== l.id);
  if (!others.length) return toast('Make another list first (+ List).');
  const sel = h('select', { 'aria-label': 'To list' }, others.map((o) => h('option', { value: o.id }, (o.folder ? sc.folders.find((f) => f.id === o.folder)?.name + ' › ' : '') + o.name)));
  await dialog({ title: `Move ${x.t}`, ok: 'Move', body: field('To list', sel), onOk: () => { const r = ctx.act((d) => A.moveScanItems(d, l.id, sel.value, [x.t], { date: ctx.today() }), { label: 'move ' + x.t, now: true }); return r.ok ? true : r.error; } });
  ctx.redraw();
}
async function cleanUpDialog(ctx, l, stale) {
  const ok = await dialog({ title: `Clean up ${l.name}?`, ok: 'Remove them', body: h('div', { style: { display: 'grid', gap: '8px' } }, para('These stocks were rejected or bought since you added them:', ''), h('b', null, [...stale].join(', ')), para('They leave this list only. Undo brings them back.', 'note')) });
  if (!ok) return; const r = ctx.act((d) => A.cleanUpScanLists(d, [l.id]), { label: 'clean up ' + l.name, now: true }); if (r.ok) toast(`${plural(r.data.n, 'stock')} removed.`, 'Undo', () => ctx.store.undo()); ctx.redraw();
}
// downloads (TradingView: watchlist name → Import list…; needs a paid plan)
const importHint = 'In TradingView: click the watchlist name → Import list… and pick the file from your Downloads.';
function downloadOne(ctx, l) {
  const name = `${SC.safeFileName(l.name)} ${dmy(ctx.today())}.txt`;
  download(name, new Blob([SC.tradingViewList(l.items)], { type: 'text/plain' })); toast(`Saved “${name}”. ${importHint}`, null, null, 9000);
}
function downloadSections(ctx, title, lists) {
  const withItems = lists.filter((l) => l.items.length); if (!withItems.length) return toast('These lists are empty.');
  const name = `${SC.safeFileName(title)} ${dmy(ctx.today())}.txt`;
  download(name, new Blob([SC.tradingViewSections(withItems)], { type: 'text/plain' }));
  toast(`Saved “${name}”: one watchlist with ${plural(withItems.length, 'section')}. ${importHint}`, null, null, 9000);
}
function downloadSeparate(ctx, lists) {
  const withItems = lists.filter((l) => l.items.length); if (!withItems.length) return toast('These lists are empty.');
  withItems.forEach((l, i) => setTimeout(() => download(`${SC.safeFileName(l.name)} ${dmy(ctx.today())}.txt`, new Blob([SC.tradingViewList(l.items)], { type: 'text/plain' })), i * 400));
  toast(`Saving ${plural(withItems.length, 'file')}. If your browser asks, allow several downloads. ${importHint}`, null, null, 9000);
}

// ---------------------------------------------------------------- paste
async function pasteFromButton(ctx) {
  if (ctx.readOnly) return;
  try { const t = await navigator.clipboard.readText(); if (t && t.trim()) return takePaste(ctx, t); } catch { /* browser said no: use the box */ }
  const box = h('textarea', { rows: '6', 'aria-label': 'Paste here', placeholder: 'Press Ctrl + V here' });
  setTimeout(() => box.focus(), 0);
  dialog({ title: 'Paste a scan', ok: 'Add', body: h('div', { style: { display: 'grid', gap: '8px' } }, para('Click TJ Collect on your TradingView scanner, then paste here. Plain tickers work too.', 'note'), box),
    onOk: () => { const p = SC.parsePaste(box.value); if (!p.ok) return p.error; setTimeout(() => takePaste(ctx, box.value), 0); return true; } });
}
async function takePaste(ctx, text) {
  if (ctx.readOnly) return;
  const p = SC.parsePaste(text); if (!p.ok) return toast(p.error);
  const today = ctx.today(); let scanner = p.scanner; const date = p.date || today;
  if (p.kind === 'plain' || !scanner) {
    const names = SC.runsByScanner(ctx.store.state).map((g) => g.scanner);
    const nm = h('input', { value: scanner || '', list: 'sc-names', 'aria-label': 'Scanner name', maxlength: '60' });
    setTimeout(() => nm.focus(), 0);
    const ok = await dialog({ title: `Name this scan (${plural(p.rows.length, 'stock')})`, ok: 'Add', body: h('div', { style: { display: 'grid', gap: '8px' } }, field('Scanner', nm), h('datalist', { id: 'sc-names' }, names.map((n) => h('option', { value: n }))),
      p.skipped?.length ? para(`Not tickers, left out: ${p.skipped.slice(0, 8).join(', ')}${p.skipped.length > 8 ? '…' : ''}`, 'note') : null),
      onOk: () => (nm.value.trim() ? true : 'Give the scanner a name.') });
    if (!ok) return; scanner = nm.value.trim();
  }
  let replace = false;
  if (A.scanRunExists(ctx.store.state, scanner, date)) {
    const keep = h('input', { type: 'radio', name: 'sc-dup', value: 'keep' }); const rep = h('input', { type: 'radio', name: 'sc-dup', value: 'replace', checked: true });
    const ok = await dialog({ title: `${scanner} was already added ${date === today ? 'today' : 'on ' + dmy(date)}`, ok: 'Add', body: h('div', { class: 'sc-dup' },
      h('label', null, rep, ' Replace that scan with this one'), h('label', null, keep, ' Keep both (then Compare shows what changed)'), para('Your statuses on the stocks stay either way.', 'note')) });
    if (!ok) return; replace = rep.checked;
  }
  const res = ctx.act((d) => A.addScanRun(d, { scanner, date, cols: p.cols, rows: p.rows, shown: p.shown }, { replace, today }), { label: 'scan ' + scanner, now: true });
  if (!res.ok) return toast(res.error);
  V.page = 'review'; V.mode = 'view'; V.view = res.data.run.id; V.sel = null; ctx.redraw();
  const miss = p.shown && p.rows.length < p.shown ? ` TradingView showed ${p.shown}; scroll to the bottom of the list and collect again to get all.` : '';
  toast(`${scanner}: ${plural(p.rows.length, 'stock')} added.` + miss, 'Undo', () => ctx.store.undo(), miss ? 9000 : 5000);
}
