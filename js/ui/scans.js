// Scans tab — 1.8.2 one screen (his choices 2026-11-22, evening): Sources (scanners, saved comparisons, ready-made lists,
// his folders and lists) fold away behind a button; a narrow stock list; TradingView's own chart taking most of the screen
// (Daily, Volume, EMA 10, SMA 20); a thin decision bar + up to 6 key values under it; quick views All / In all scans /
// New today / Dropped today / Not decided / Near buy; Chart | Table switch; ↑ ↓ moves the list and the chart follows.
import { h, dialog, para, toast, download, dmy, field } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';
import * as A from '../actions.js';
import * as SC from '../scans.js';

const V = { src: null, pickOpen: false, manageOpen: false, cmpTick: new Set(), q: 'all', view: 'chart', sel: null, f: SC.emptyFilter(), fOpen: false, selMode: false, ticked: new Set(), lfold: {} };
let CTX = null;
let LAST = { rows: [], v: null };

const isTyping = (el) => !!el && (el.closest?.('input, textarea, select, [contenteditable="true"]'));
const dialogOpen = () => !!document.querySelector('.scrim, .sc-menu');
const menuHidden = () => { try { return localStorage.getItem('tj-scans-nomenu') === '1'; } catch { return false; } };
// 1.8.10: his Finviz Elite chart page (daily, his 1h1v layout, his screener in the sidebar); only the ticker changes. Finviz writes BRK.B as BRK-B.
const fvUrl = (r) => 'https://elite.finviz.com/charts?t=' + encodeURIComponent(SC.finvizTicker(r.t)) + '&p=d&l=1h1v&sidebar=screener&screener=154772492'; // 154772492 = his W1-1M screen
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- keys and paste (only on the Scans tab)
if (typeof document !== 'undefined') {
  document.addEventListener('paste', (e) => {
    if (!CTX || CTX.route !== 'scans' || isTyping(e.target) || dialogOpen()) return;
    const text = e.clipboardData?.getData('text') ?? ''; if (!text.trim()) return;
    e.preventDefault(); takePaste(CTX, text);
  });
  document.addEventListener('keydown', (e) => {
    if (!CTX || CTX.route !== 'scans' || isTyping(e.target) || dialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key; const rows = LAST.rows; if (k === '?') { e.preventDefault(); keysHelp(); return; } if (k === 's' || k === 'S') { e.preventDefault(); V.pickOpen = !V.pickOpen; CTX.redraw(); return; } if (!rows.length) return;
    const i = Math.max(0, rows.findIndex((r) => r.t === V.sel));
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); const j = Math.min(rows.length - 1, Math.max(0, i + (k === 'ArrowDown' ? 1 : -1))); V.sel = rows[j].t; CTX.redraw(); return; }
    const cur = rows[i]; if (!cur) return; const key = k.toLowerCase();
    if (key === 'n') { e.preventDefault(); setStatus(CTX, cur, 'near'); }
    else if (key === 'w') { e.preventDefault(); setStatus(CTX, cur, 'watch'); }
    else if (key === 'r') { e.preventDefault(); rejectDialog(CTX, cur); }
    else if (key === 'l') { e.preventDefault(); addToListDialog(CTX, [cur]); }
    else if (key === 's') { e.preventDefault(); V.pickOpen = true; CTX.redraw(); }
    else if (k === 'Enter') { e.preventDefault(); window.open(fvUrl(cur), '_blank', 'noopener'); }
  });
}

// ---------------------------------------------------------------- the chart (kept alive between redraws)
// The TradingView chart lives in one element outside the page redraws and is laid over a placeholder, so marking a stock
// does not reload the chart; it reloads only when the stock changes (after a short pause, so ↑ ↓ stays quick).
let HOST = null; let HOST_SYM = null; let SYM_TIMER = null;
function host() {
  if (HOST) return HOST;
  HOST = document.createElement('div'); HOST.className = 'sc-chost'; HOST.style.display = 'none'; document.body.append(HOST);
  window.addEventListener('resize', placeChart);
  new MutationObserver(() => requestAnimationFrame(placeChart)).observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
  return HOST;
}
function fitHeight() {
  const body = document.querySelector('.sc-body'); if (!body) return;
  if (innerWidth < 900) { body.style.height = ''; return; }
  const top = body.getBoundingClientRect().top + window.scrollY; body.style.height = Math.max(460, innerHeight - top - 14) + 'px';
}
function placeChart() {
  fitHeight();
  if (!HOST) return; const ph = document.getElementById('sc-chart-ph');
  if (!ph || !CTX || CTX.route !== 'scans') { HOST.style.display = 'none'; return; }
  const r = ph.getBoundingClientRect();
  Object.assign(HOST.style, { display: 'block', top: r.top + window.scrollY + 'px', left: r.left + window.scrollX + 'px', width: r.width + 'px', height: r.height + 'px' });
}
function showChart(symbol) {
  host(); placeChart(); if (symbol === HOST_SYM) return;
  clearTimeout(SYM_TIMER);
  SYM_TIMER = setTimeout(() => {
    HOST_SYM = symbol; HOST.textContent = '';
    HOST.append(h('iframe', { src: SC.chartUrl(symbol, location.href), title: 'TradingView chart of ' + symbol, allowtransparency: 'true', allowfullscreen: 'true', style: { width: '100%', height: '100%', border: '0', display: 'block' } }));
    HOST.dataset.symbol = symbol;
  }, HOST_SYM ? 300 : 0);
}

// ---------------------------------------------------------------- page
export function render(ctx) {
  CTX = ctx; const st = ctx.store.state; const today = ctx.today();
  const sc = st.scans; const groups = SC.runsByScanner(st);
  document.body.classList.toggle('tj-nomenu', menuHidden());
  if (!validSrc(st, V.src)) { V.src = groups.length ? { kind: 'scanner', name: groups[0].scanner } : sc.lists.length ? { kind: 'list', id: sc.lists[0].id } : null; V.q = 'all'; V.sel = null; }
  if (!V.src) return h('div', { class: 'scans' }, h('header', { class: 'pg-head sc-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'Trade'), h('h1', null, 'Scans')),
    h('div', { class: 'sc-headbtns' }, h('button', { class: 'btn sm', onClick: () => keysHelp() }, 'Keys ?'))), emptyState(ctx));
  const v = SC.sourceView(st, V.src, today);
  if (!SC.quickShown(v, V.q)) V.q = v.kind === 'compare' ? 'inall' : 'all';
  const info = tradeInfo(st);
  const fr = SC.applyFilter(SC.quickRows(v, V.q), V.f, { isOpen: (t) => !!info.get(t)?.open, traded: (t) => !!info.get(t)?.closed.length });
  LAST = { rows: fr.rows, v };
  if (!fr.rows.some((r) => r.t === V.sel)) V.sel = fr.rows[0]?.t ?? null;
  const sel = fr.rows.find((r) => r.t === V.sel) || null;
  const main = V.view === 'table' ? tablePanel(ctx, st, v, fr, info, today) : [listPanel(ctx, st, v, fr, info, today), chartPanel(ctx, st, v, sel, info, today)];
  if (V.view === 'chart' && sel) setTimeout(() => showChart(sel.full && sel.full.includes(':') ? sel.full : sel.t), 0); else setTimeout(placeChart, 0);
  setTimeout(() => { placeChart(); document.querySelector('.sc-li.on')?.scrollIntoView({ block: 'nearest' }); }, 0);
  return h('div', { class: 'scans full' }, toolbar(ctx, st, v), filterExtras(ctx, v.cols), V.pickOpen ? picker(ctx, st, groups, today) : null, V.manageOpen ? manage(ctx, st, groups) : null,
    h('div', { class: 'sc-body ' + V.view }, main));
}
function validSrc(st, s) {
  if (!s) return false; const sc = st.scans;
  if (s.kind === 'scanner') return sc.runs.some((r) => r.scanner === s.name);
  if (s.kind === 'compare') return (sc.compares || []).some((c) => c.id === s.id);
  if (s.kind === 'quick') return s.scanners.filter((n) => sc.runs.some((r) => r.scanner === n)).length >= 2;
  if (s.kind === 'list') return sc.lists.some((l) => l.id === s.id);
  if (s.kind === 'ready') return SC.readyLists(st).some((l) => l.id === s.id);
  return false;
}
function openSrc(ctx, s) { V.src = s; V.q = s.kind === 'compare' || s.kind === 'quick' ? 'inall' : 'all'; V.sel = null; V.ticked = new Set(); V.pickOpen = false; ctx.redraw(); }

function emptyState(ctx) {
  // 1.8.10: both sources (TradingView and Finviz) and the current way to compare
  const src = (name, btn, how) => h('div', { class: 'sc-getbtn' }, h('div', null, h('b', null, name), para(how, 'note')), btn);
  return h('section', { class: 'card sc-empty' }, h('h2', null, 'Start with your first scan'),
    h('ol', null,
      h('li', null, h('b', null, 'Put a TJ Collect button on your bookmarks bar. '), 'Drag the button for the site you scan on onto the bar (show the bar with Ctrl + Shift + B):',
        h('div', { class: 'sc-emptysrc' },
          src('TradingView', dragButton(), 'Copies the scanner rows with every column you see.'),
          src('Finviz', dragButton(true), 'Copies the 20 stocks of the page you see; collect page 2, 3 … the same way and they join one scan. Use the Performance view for RS.'))),
      h('li', null, h('b', null, 'Open your screener ', ), 'on TradingView or Finviz and click the button.'),
      h('li', null, h('b', null, 'Come back here and press Ctrl + V. '), 'Each screener becomes a scanner under Sources.'),
      h('li', null, h('b', null, 'Compare: '), 'Sources → ⇄ Compare scanners… → tick them → Show common stocks.')),
    h('div', { class: 'row' }, h('button', { class: 'btn pri', disabled: ctx.readOnly, onClick: () => fvGetDialog(ctx) }, '⟳ Get from Finviz Elite'), h('button', { class: 'btn', onClick: () => pasteFromButton(ctx) }, 'Paste a scan'), h('span', { class: 'note' }, 'You can also paste plain tickers, for example NVDA, AAPL, WMT.')));
}
function dragButton(fv = false) {
  return h('a', { class: 'sc-drag' + (fv ? ' fv' : ''), href: fv ? SC.collectFvHref() : SC.collectHref(), draggable: 'true', title: 'Drag me to your bookmarks bar', onClick: (e) => { e.preventDefault(); toast('Drag this button onto your bookmarks bar. Clicking it here does nothing.'); } }, fv ? 'TJ Collect Finviz' : 'TJ Collect');
}
function collectHelp() {
  dialog({ title: 'Get the TJ Collect buttons', info: true, body: h('div', { style: { display: 'grid', gap: '12px' } },
    para('Drag a button onto your bookmarks bar (show the bar with Ctrl + Shift + B). Then click it on your scanner page and press Ctrl + V here.', ''),
    h('div', { class: 'sc-getbtn' }, h('div', null, h('b', null, 'TradingView'), para('On a TradingView screener: copies the scanner rows, every column you see, the name and the date.', 'note')), dragButton()),
    h('div', { class: 'sc-getbtn' }, h('div', null, h('b', null, 'Finviz'), para('On a Finviz screener: copies the 20 stocks of the page you see, with the columns of your view. Collect page 2, 3 … the same way: they join the same scan. Use the Performance view to get RS.', 'note')), dragButton(true)),
    para('If dragging does not work, right-click a button, choose Copy link, and paste it as the address of a new bookmark.', 'note')) });
}
function keysHelp() {
  const k = (key, what) => h('div', { class: 'sc-key' }, h('kbd', null, key), h('span', null, what));
  dialog({ title: 'Keys in Scans', info: true, body: h('div', { style: { display: 'grid', gap: '8px' } },
    k('↑ ↓', 'Move through the list (the chart follows)'), k('N', 'Near buy'), k('R', 'Rejected (choose a reason)'), k('W', 'Watching'), k('L', 'Add to one of your lists'), k('Enter', 'Open the stock in Finviz'), k('Ctrl + V', 'Add a scan from TJ Collect'), k('?', 'This list'),
    para('The keys work only on this tab and never while you type in a box.', 'note')) });
}

// ---------------------------------------------------------------- small pop-up menu
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

// ---------------------------------------------------------------- the one slim toolbar (1.8.8)
function toolbar(ctx, st, v) {
  const kindName = { scanner: 'Scanner', compare: v.quick ? 'Compare' : 'Comparison', ready: 'Ready-made', list: 'My list' }[v.kind] || '';
  const picker = v.picker ? h('select', { class: 'sc-pick', 'aria-label': v.kind === 'compare' ? 'Day' : 'Scan', onChange: (e) => { V.src = { ...V.src, [v.kind === 'compare' ? 'date' : 'run']: e.target.value }; V.sel = null; ctx.redraw(); } },
    v.picker.options.map((o) => h('option', { value: o.value, selected: o.value === v.picker.value }, o.label))) : null;
  const n = SC.filterCount(V.f) + (V.f.status !== 'all' ? 1 : 0);
  const q = h('input', { type: 'search', class: 'sc-q', value: V.f.q, placeholder: 'Find', 'aria-label': 'Find a ticker', 'data-keep': 'sc-q',
    onInput: (e) => { V.f = { ...V.f, q: e.target.value }; ctx.redraw(); const el = document.querySelector('[data-keep="sc-q"]'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } } });
  const hidden = menuHidden();
  return h('div', { class: 'sc-tool' },
    h('button', { type: 'button', class: 'sc-ibtn', 'aria-label': hidden ? 'Show the program menu' : 'Hide the program menu', title: hidden ? 'Show the program menu' : 'Hide the program menu for a bigger chart', onClick: () => { try { localStorage.setItem('tj-scans-nomenu', hidden ? '0' : '1'); } catch { /* fine */ } ctx.redraw(); } }, hidden ? '⇥' : '⇤'),
    h('button', { type: 'button', class: 'sc-srcpick' + (V.pickOpen ? ' open' : ''), 'aria-expanded': String(V.pickOpen), title: 'Sources (S)', onClick: (e) => { e.stopPropagation(); V.pickOpen = !V.pickOpen; ctx.redraw(); } },
      h('span', { class: 'sc-srck' }, kindName), h('b', null, v.title), h('span', { class: 'sc-srcn' }, v.kind === 'compare' ? `${v.inAll ?? 0} in all` : plural(v.rows.length, 'stock')), h('span', { 'aria-hidden': 'true' }, ' ▾')),
    picker,
    v.kind === 'scanner' && v.run && !ctx.readOnly ? h('button', { type: 'button', class: 'sc-ibtn', 'aria-label': 'Delete this scan', title: 'Delete this scan (only the day shown)', onClick: () => deleteRunDialog(ctx, v.run) }, '🗑') : null,
    v.quick ? h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: () => saveQuickDialog(ctx, v) }, 'Save this comparison') : null,
    v.kind === 'compare' && (v.inAll ?? 0) > 0 ? h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: () => addToListDialog(ctx, v.rows.filter((r) => r.n === v.N)) }, `Add the ${v.inAll} to a list…`) : null,
    v.kind === 'ready' && v.rows.length ? h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: () => addToListDialog(ctx, v.rows) }, 'Add all to a list…') : null,
    v.missing?.length ? h('span', { class: 'sc-tag earn', title: 'No scans yet: ' + v.missing.join(', ') }, 'Missing: ' + v.missing.join(', ')) : null,
    h('div', { class: 'sc-quick', role: 'group', 'aria-label': 'Quick views' }, SC.QUICK.filter(([k]) => SC.quickShown(v, k)).map(([k, label]) =>
      h('button', { type: 'button', class: 'sc-qv' + (V.q === k ? ' on' : '') + (k === 'dropped' ? ' drop' : ''), 'aria-pressed': String(V.q === k), onClick: () => { V.q = k; V.sel = null; ctx.redraw(); } }, label, h('span', { class: 'sc-n' }, SC.quickRows(v, k).length)))),
    h('span', { class: 'spacer' }),
    q, h('button', { type: 'button', class: 'btn sm sc-fbtn' + (n ? ' active' : ''), 'aria-expanded': String(V.fOpen), onClick: () => { V.fOpen = !V.fOpen; ctx.redraw(); } }, n ? `Filter · ${n}` : 'Filter'),
    h('div', { class: 'seg sc-pages', role: 'group', 'aria-label': 'View' }, [['chart', 'Chart'], ['table', 'Table']].map(([k, l]) => h('button', { type: 'button', class: V.view === k ? 'on' : '', 'aria-pressed': String(V.view === k), onClick: () => { V.view = k; ctx.redraw(); } }, l))),
    h('button', { class: 'btn sm pri', disabled: ctx.readOnly, title: 'Get your Finviz Elite screeners', onClick: () => fvGetDialog(ctx) }, '⟳ Finviz'),
    h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: () => pasteFromButton(ctx) }, 'Paste scan'),
    h('button', { class: 'btn sm', title: 'Get the TJ Collect buttons for TradingView and Finviz', onClick: () => collectHelp() }, 'TJ Collect'),
    h('button', { class: 'btn sm', 'aria-label': 'Keyboard keys', title: 'Keys', onClick: () => keysHelp() }, '?'));
}
async function saveQuickDialog(ctx, v) {
  const nm = h('input', { value: v.title.slice(0, 60), maxlength: '60', 'aria-label': 'Name' }); setTimeout(() => nm.select(), 0); let made = null;
  await dialog({ title: 'Save this comparison', ok: 'Save', body: h('div', { style: { display: 'grid', gap: '8px' } }, field('Name', nm), para('It stays under Comparisons and always uses the newest scan of each scanner.', 'note')),
    onOk: () => { const r = ctx.act((d) => A.addScanCompare(d, nm.value, v.scanners), { label: 'save comparison', now: true }); if (r.ok) made = r.data.id; return r.ok ? true : r.error; } });
  if (made) openSrc(ctx, { kind: 'compare', id: made });
}
// ---------------------------------------------------------------- Sources menu (1.8.9, his wish: simple — a click opens it, nothing else)
let PICK_CLOSE = null;
function picker(ctx, st, groups, today) {
  const sc = st.scans; const on = (s) => V.src && V.src.kind === s.kind && (s.kind === 'scanner' ? V.src.name === s.name : V.src.id === s.id);
  const icons = (label, edit, del) => (ctx.readOnly ? [] : [
    edit ? h('button', { type: 'button', class: 'sc-micon', 'aria-label': 'Rename or edit ' + label, title: 'Rename / edit', onClick: (e) => { e.stopPropagation(); edit(); } }, '✎') : null,
    del ? h('button', { type: 'button', class: 'sc-micon del', 'aria-label': 'Delete ' + label, title: 'Delete', onClick: (e) => { e.stopPropagation(); del(); } }, '🗑') : null]);
  // 1.8.10 (his choice A): rename ✎ and delete 🗑 always visible beside the line, light grey, darker when pointed at
  const item = (s, label, right, edit, del) => h('div', { class: 'sc-mline' + (on(s) ? ' on' : '') },
    h('button', { type: 'button', class: 'sc-mitem' + (on(s) ? ' on' : ''), onClick: () => openSrc(ctx, s) }, h('span', { class: 'sc-mlabel' }, label), right ? h('span', { class: 'sc-mright' }, right) : null), ...icons(label, edit, del));
  const sec = (title, ...kids) => h('div', { class: 'sc-msec' }, h('div', { class: 'sc-mhd' }, title), ...kids);
  const ready = SC.readyLists(st).filter((l) => l.id === 'ready-near' || l.id === 'ready-watch');
  const folderName = (l) => (l.folder ? (sc.folders.find((f) => f.id === l.folder)?.name || '') + ' › ' : '');
  const lists = [...sc.lists].sort((a, b) => (folderName(a) + a.name).localeCompare(folderName(b) + b.name));
  const panel = h('div', { class: 'sc-picker sc-simple card', role: 'dialog', 'aria-label': 'Sources', onClick: (e) => e.stopPropagation() },
    sec('Scanners',
      groups.length ? groups.map((g) => item({ kind: 'scanner', name: g.scanner }, g.scanner, `${g.runs[0].date === today ? 'today' : dmy(g.runs[0].date).slice(0, 5)} · ${g.runs[0].rows.length}`, () => renameScannerDialog(ctx, g.scanner), () => deleteScannerDialog(ctx, g.scanner)))
        : h('p', { class: 'note' }, 'Press Ctrl + V on this page to add a scan.'),
      groups.length >= 2 ? h('button', { type: 'button', class: 'sc-mitem sc-maction', onClick: () => compareTickDialog(ctx, groups) }, h('span', { class: 'sc-mlabel' }, '⇄ Compare scanners…')) : null),
    (sc.compares || []).length ? sec('Saved comparisons', sc.compares.map((c) => item({ kind: 'compare', id: c.id }, c.name, `${SC.sourceView(st, { kind: 'compare', id: c.id }, today).inAll ?? 0} in all`, () => compareDialog(ctx, c), () => deleteCompareDialog(ctx, c)))) : null,
    sec('By status', h('div', { class: 'sc-mrow' }, ready.map((l) => h('button', { type: 'button', class: 'sc-mitem' + (on({ kind: 'ready', id: l.id }) ? ' on' : ''), onClick: () => openSrc(ctx, { kind: 'ready', id: l.id }) }, h('span', { class: 'sc-mlabel' }, l.id === 'ready-near' ? 'Near buy' : 'Watching'), h('span', { class: 'sc-mright' }, String(l.items.length)))))),
    sec('My lists',
      lists.length ? lists.map((l) => item({ kind: 'list', id: l.id }, folderName(l) + l.name, plural(l.items.length, 'stock'), () => nameDialog(ctx, 'Rename list', l.name, (d, x) => A.renameScanList(d, l.id, x)), () => deleteListDialog(ctx, l)))
        : h('p', { class: 'note' }, 'No lists yet. Add stocks with L while you look at charts.'),
      h('button', { type: 'button', class: 'sc-mitem sc-maction', disabled: ctx.readOnly, onClick: () => newListDialog(ctx, null) }, h('span', { class: 'sc-mlabel' }, '+ New list'))),
    h('button', { type: 'button', class: 'btn sm sc-managebtn', onClick: () => { V.pickOpen = false; V.manageOpen = true; ctx.redraw(); } }, '✎ Manage scanners and lists'));
  if (PICK_CLOSE) { document.removeEventListener('mousedown', PICK_CLOSE, true); document.removeEventListener('keydown', PICK_CLOSE, true); }
  PICK_CLOSE = (e) => {
    if (!V.pickOpen || dialogOpen()) return;
    if (e.type === 'keydown' ? e.key === 'Escape' : !e.target.closest?.('.sc-picker, .sc-srcpick, .sc-menu, .scrim')) { V.pickOpen = false; document.removeEventListener('mousedown', PICK_CLOSE, true); document.removeEventListener('keydown', PICK_CLOSE, true);
      document.querySelector('.sc-picker')?.remove(); const b = document.querySelector('.sc-srcpick'); b?.classList.remove('open'); b?.setAttribute('aria-expanded', 'false'); }
  };
  setTimeout(() => { document.addEventListener('mousedown', PICK_CLOSE, true); document.addEventListener('keydown', PICK_CLOSE, true); }, 0);
  return panel;
}
// ---------------------------------------------------------------- Manage (1.8.10, his choice A): one clear table, plain-word buttons per row
let MAN_CLOSE = null;
function manage(ctx, st, groups) {
  const sc = st.scans; const ro = ctx.readOnly;
  const b = (label, fn, cls = '') => h('button', { type: 'button', class: 'btn sm ' + cls, disabled: ro, onClick: fn }, label);
  const row = (name, info, btns, cls = '') => h('tr', { class: cls }, h('td', { class: 'sc-mgname' }, name), h('td', { class: 'note' }, info), h('td', { class: 'sc-mgbtns' }, btns));
  const listRow = (l, indent) => row(h('span', { class: indent ? 'sc-mgin' : '' }, l.name), plural(l.items.length, 'stock'), [
    b('Rename', () => nameDialog(ctx, 'Rename list', l.name, (d, x) => A.renameScanList(d, l.id, x))), b('Move', () => moveListDialog(ctx, l)),
    h('button', { type: 'button', class: 'btn sm', disabled: !l.items.length, onClick: () => downloadOne(ctx, l) }, 'Download'),
    A.staleInList(st, l).length ? b(`Clean up ${A.staleInList(st, l).length}`, () => cleanUpDialog(ctx, l, new Set(A.staleInList(st, l))), 'sc-clean') : null,
    b('Delete', () => deleteListDialog(ctx, l), 'danger')]);
  const loose = sc.lists.filter((l) => !l.folder);
  const panel = h('div', { class: 'sc-manage card', role: 'dialog', 'aria-label': 'Manage scanners and lists', onClick: (e) => e.stopPropagation() },
    h('div', { class: 'sc-mghead' }, h('h3', null, 'Manage scanners and lists'), h('button', { type: 'button', class: 'sc-pclose', 'aria-label': 'Close', onClick: () => { V.manageOpen = false; ctx.redraw(); } }, '×')),
    h('table', { class: 'sc-mgt' }, h('tbody', null,
      h('tr', { class: 'sc-mgsec' }, h('td', { colspan: '3' }, 'Scanners')),
      groups.length ? groups.map((g) => row(g.scanner, plural(g.runs.length, 'scan'), [b('Rename', () => renameScannerDialog(ctx, g.scanner)), b('Delete', () => deleteScannerDialog(ctx, g.scanner), 'danger')])) : row(h('span', { class: 'note' }, 'No scanners yet'), '', []),
      (sc.compares || []).length ? [h('tr', { class: 'sc-mgsec' }, h('td', { colspan: '3' }, 'Saved comparisons')), sc.compares.map((c) => row(c.name, c.scanners.join(' + '), [b('Edit', () => compareDialog(ctx, c)), b('Delete', () => deleteCompareDialog(ctx, c), 'danger')]))] : null,
      h('tr', { class: 'sc-mgsec' }, h('td', { colspan: '2' }, 'Folders and lists'), h('td', { class: 'sc-mgbtns' }, b('+ Folder', () => newFolderDialog(ctx)), b('+ List', () => newListDialog(ctx, null)), sc.lists.length ? h('button', { type: 'button', class: 'btn sm', onClick: () => downloadManyDialog(ctx) }, 'Download several') : null)),
      sc.folders.map((f) => { const ls = sc.lists.filter((l) => l.folder === f.id); return [
        row(h('b', null, '▣ ' + f.name), plural(ls.length, 'list'), [b('Rename', () => nameDialog(ctx, 'Rename folder', f.name, (d, x) => A.renameScanFolder(d, f.id, x))), h('button', { type: 'button', class: 'btn sm', disabled: !ls.some((l) => l.items.length), onClick: () => downloadSections(ctx, f.name, ls) }, 'Download as one watchlist'), b('Delete', () => deleteFolderDialog(ctx, f, ls), 'danger')], 'sc-mgfolder'),
        ls.map((l) => listRow(l, true))]; }),
      loose.map((l) => listRow(l, false)),
      !sc.lists.length && !sc.folders.length ? row(h('span', { class: 'note' }, 'No lists yet'), '', []) : null)));
  if (MAN_CLOSE) { document.removeEventListener('mousedown', MAN_CLOSE, true); document.removeEventListener('keydown', MAN_CLOSE, true); }
  MAN_CLOSE = (e) => {
    if (!V.manageOpen || dialogOpen()) return;
    if (e.type === 'keydown' ? e.key === 'Escape' : !e.target.closest?.('.sc-manage, .sc-menu, .scrim')) { V.manageOpen = false; document.removeEventListener('mousedown', MAN_CLOSE, true); document.removeEventListener('keydown', MAN_CLOSE, true); document.querySelector('.sc-manage')?.remove(); }
  };
  setTimeout(() => { document.addEventListener('mousedown', MAN_CLOSE, true); document.addEventListener('keydown', MAN_CLOSE, true); }, 0);
  return panel;
}

// "⇄ Compare scanners…": the only place where he ticks anything
async function compareTickDialog(ctx, groups) {
  V.pickOpen = false;
  const boxes = groups.map((g) => [g.scanner, h('input', { type: 'checkbox' })]);
  const ok = await dialog({ title: 'Compare scanners', ok: 'Show common stocks', body: h('div', { style: { display: 'grid', gap: '10px' } },
    para('Which scanners? You will see the stocks found by all of them (their newest scans).', ''),
    h('div', { class: 'sc-cols' }, boxes.map(([n, b]) => h('label', null, b, ' ', n)))),
    onOk: () => (boxes.filter(([, b]) => b.checked).length >= 2 ? true : 'Tick at least 2 scanners.') });
  if (!ok) return ctx.redraw();
  openSrc(ctx, { kind: 'quick', scanners: boxes.filter(([, b]) => b.checked).map(([n]) => n) });
}

// ---------------------------------------------------------------- quick views + filter (shared by list and table)
function clearFilter() { V.f = SC.emptyFilter(); }
function setF(ctx, patch) { V.f = { ...V.f, ...patch }; ctx.redraw(); }
const SN = { all: 'Any status', new: 'Not decided', watch: 'Watching', near: 'Near buy', rej: 'Rejected' };
function filterExtras(ctx, cols) {
  const chips = []; const chip = (text, off) => h('span', { class: 'sc-fchip' }, text, h('button', { type: 'button', 'aria-label': 'Remove filter ' + text, onClick: () => { off(); ctx.redraw(); } }, '×'));
  if (V.f.status !== 'all') chips.push(chip('Status: ' + SN[V.f.status], () => { V.f = { ...V.f, status: 'all' }; }));
  if (V.f.q) chips.push(chip('Ticker has “' + V.f.q + '”', () => { V.f = { ...V.f, q: '' }; }));
  if (V.f.rsMin !== null && V.f.rsMin !== '') chips.push(chip('RS ≥ ' + V.f.rsMin, () => { V.f = { ...V.f, rsMin: null }; }));
  if (V.f.noEarn) chips.push(chip('No earnings ≤ 7 d', () => { V.f = { ...V.f, noEarn: false }; }));
  if (V.f.traded) chips.push(chip('Traded before', () => { V.f = { ...V.f, traded: false }; }));
  if (V.f.noOpen) chips.push(chip('No open positions', () => { V.f = { ...V.f, noOpen: false }; }));
  V.f.rules.forEach((ru, i) => chips.push(chip(`${ru.col} ${ru.op === 'has' ? 'has' : ru.op === '>=' ? '≥' : '≤'} ${ru.val}`, () => { V.f = { ...V.f, rules: V.f.rules.filter((_, j) => j !== i) }; })));
  if (!V.fOpen && !chips.length) return null;
  return h('div', { class: 'sc-filter' }, V.fOpen ? filterPanel(ctx, cols, SN) : null,
    chips.length ? h('div', { class: 'sc-fchips', 'aria-label': 'Filters that are on' }, chips, h('button', { type: 'button', class: 'linkish', onClick: () => { clearFilter(); ctx.redraw(); } }, 'Clear all')) : null);
}
function filterPanel(ctx, cols, SN) {
  const stSel = h('select', { 'aria-label': 'Status', onChange: (e) => setF(ctx, { status: e.target.value }) }, Object.entries(SN).map(([k, l]) => h('option', { value: k, selected: V.f.status === k }, l)));
  const rs = h('input', { type: 'number', min: '1', max: '99', value: V.f.rsMin ?? '', 'aria-label': 'RS at least', class: 'sc-num', onChange: (e) => setF(ctx, { rsMin: e.target.value === '' ? null : Math.min(99, Math.max(1, Math.round(Number(e.target.value)))) }) });
  const sw = (key, label) => h('label', { class: 'sc-sw' }, h('input', { type: 'checkbox', checked: V.f[key], onChange: (e) => setF(ctx, { [key]: e.target.checked }) }), ' ', label);
  const col = h('select', { 'aria-label': 'Column' }, cols.map((c) => h('option', { value: c }, c)));
  const op = h('select', { 'aria-label': 'Rule' }, h('option', { value: '>=' }, '≥ at least'), h('option', { value: '<=' }, '≤ at most'), h('option', { value: 'has' }, 'has text'));
  const val = h('input', { 'aria-label': 'Value', placeholder: '4 or 1B', class: 'sc-val' });
  const add = () => { const x = val.value.trim(); if (!x || !col.value) return toast('Choose a column and type a value.'); if (op.value !== 'has' && SC.numOf(x) === null) return toast('Type a number, for example 4, 10 or 1B.'); setF(ctx, { rules: [...V.f.rules, { col: col.value, op: op.value, val: x }] }); };
  val.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  return h('div', { class: 'sc-fpanel' },
    h('div', { class: 'sc-fline' }, h('label', { class: 'sc-sw' }, 'Status ', stSel), h('label', { class: 'sc-sw' }, 'RS at least ', rs)),
    h('div', { class: 'sc-fline' }, sw('noEarn', 'Hide earnings within 7 days'), sw('traded', 'Only stocks I traded before'), sw('noOpen', 'Hide my open positions')),
    cols.length ? h('div', { class: 'sc-fline' }, h('span', { class: 'note' }, 'Column rule'), col, op, val, h('button', { type: 'button', class: 'btn sm', onClick: add }, 'Add')) : null,
    h('div', { class: 'sc-fline end' }, h('button', { type: 'button', class: 'btn sm', onClick: () => { V.fOpen = false; ctx.redraw(); } }, 'Done')));
}
function selectBar(ctx, fr) {
  const n = V.ticked.size;
  return h('div', { class: 'sc-actbar sel' }, h('b', null, `${n} ticked`),
    h('button', { class: 'btn sm pri', disabled: !n || ctx.readOnly, onClick: () => addToListDialog(ctx, fr.rows.filter((r) => V.ticked.has(r.t)), () => { V.ticked = new Set(); }) }, 'Add ticked to…'),
    h('button', { class: 'linkish', onClick: () => { V.ticked = new Set(fr.rows.map((r) => r.t)); ctx.redraw(); } }, `Tick all ${fr.rows.length}`),
    n ? h('button', { class: 'linkish', onClick: () => { V.ticked = new Set(); ctx.redraw(); } }, 'Clear') : null);
}
function emptyRows(ctx, v, fr) {
  const q = SC.QUICK.find(([k]) => k === V.q)?.[1];
  return h('div', { class: 'empty' }, h('b', null, fr.total ? 'No stock matches your filter' : V.q === 'all' ? 'No stocks here' : `Nothing in “${q}”`),
    fr.total ? h('button', { class: 'btn sm', onClick: () => { clearFilter(); ctx.redraw(); } }, 'Clear all filters') : V.q !== 'all' ? h('button', { class: 'btn sm', onClick: () => { V.q = 'all'; ctx.redraw(); } }, 'Show all') : null);
}

// ---------------------------------------------------------------- Chart view: narrow list
function listPanel(ctx, st, v, fr, info, today) {
  const filtered = SC.filterCount(V.f) + (V.f.status !== 'all' ? 1 : 0) + (V.f.q ? 1 : 0);
  const top = h('div', { class: 'sc-lhd' }, h('span', { class: 'note' }, filtered ? h('b', { class: 'sc-filtered' }, `Showing ${fr.rows.length} of ${fr.total} · filtered`) : plural(fr.rows.length, 'stock')),
    h('button', { class: 'linkish', onClick: () => { V.selMode = !V.selMode; V.ticked = new Set(); ctx.redraw(); } }, V.selMode ? 'Done' : 'Select'));
  const parts = [top, h('div', { class: 'sc-lact' }, listToFinviz(ctx, v, fr))]; if (V.selMode) parts.push(selectBar(ctx, fr));
  if (!fr.rows.length) { parts.push(emptyRows(ctx, v, fr)); return h('section', { class: 'card sc-list' }, parts); }
  parts.push(h('div', { class: 'sc-lis', role: 'listbox', 'aria-label': 'Stocks' }, fr.rows.map((r) => {
    const x = info.get(r.t);
    return h('div', { class: 'sc-li' + (r.t === V.sel ? ' on' : '') + (r.mark?.st === 'rej' ? ' rej' : ''), role: 'option', 'aria-selected': String(r.t === V.sel), onClick: () => { V.sel = r.t; ctx.redraw(); } },
      V.selMode ? h('input', { type: 'checkbox', 'aria-label': 'Tick ' + r.t, checked: V.ticked.has(r.t), onClick: (e) => e.stopPropagation(), onChange: (e) => { if (e.target.checked) V.ticked.add(r.t); else V.ticked.delete(r.t); ctx.redraw(); } }) : null,
      h('div', { class: 'sc-lim' }, h('div', { class: 'sc-lit' }, h('b', null, r.t),
        v.kind === 'compare' && r.n ? h('span', { class: 'sc-tag ' + (r.n === v.N ? 'open' : ''), title: `Found in ${r.n} of ${v.N} scans` }, `${r.n}/${v.N}`) : null,
        r.isNew ? h('span', { class: 'sc-tag new' }, 'New today') : null, r.isDropped ? h('span', { class: 'sc-tag earn' }, 'Dropped') : null,
        x?.open ? h('span', { class: 'sc-tag open', title: 'You hold this stock now' }, '●') : null,
        r.earnings && r.earnings.days >= 0 && r.earnings.days <= 7 ? h('span', { class: 'sc-tag earn', title: 'Earnings ' + dmy(r.earnings.iso) }, `E ${r.earnings.days}d`) : null),
        h('div', { class: 'sc-lis2' }, statusText(st, r.mark))),
      h('span', { class: 'sc-lirs' + (r.rs !== null && r.rs >= 80 ? ' sc-strong' : ''), title: 'RS (scan)' }, r.rs ?? '–'),
      h('button', { type: 'button', class: 'sc-stbtn sm', 'aria-haspopup': 'menu', 'aria-label': `Status of ${r.t}`, disabled: ctx.readOnly, onClick: (e) => { e.stopPropagation(); V.sel = r.t; statusMenu(ctx, r, e.currentTarget, v); } }, '▾'));
  })), h('div', { class: 'note sc-foot' }, h('kbd', null, '↑'), h('kbd', null, '↓'), ' move · ', h('kbd', null, 'N'), h('kbd', null, 'W'), h('kbd', null, 'R'), h('kbd', null, 'L'), ' decide'));
  return h('section', { class: 'card sc-list' }, parts);
}

// ---------------------------------------------------------------- Chart view: chart + decision bar + key values
function chartPanel(ctx, st, v, r, info, today) {
  if (!r) return h('section', { class: 'card sc-chart' }, h('div', { class: 'empty' }, h('b', null, 'No stock selected'), h('span', null, 'Pick a stock in the list.')));
  const m = r.mark; const lists = SC.listsOf(st, r.t);
  const btn = (key, label, s) => h('button', { type: 'button', class: 'sc-sbtn ' + s + (m?.st === s ? ' on' : ''), 'aria-pressed': String(m?.st === s), disabled: ctx.readOnly, onClick: () => (s === 'rej' ? rejectDialog(ctx, r) : setStatus(ctx, r, s)) }, label, h('kbd', null, key));
  const keyCols = keyColsOf(st, v.cols);
  return h('section', { class: 'card sc-chart', 'aria-label': 'Chart of ' + r.t },
    h('div', { class: 'sc-chd' },
      h('div', { class: 'sc-cht' }, h('b', { class: 'sc-big' }, r.t), h('span', { class: 'note' }, (r.full?.includes(':') ? r.full.split(':')[0] : '') + (r.rs !== null ? ` · RS ${r.rs}` : '')),
        v.kind === 'compare' && r.n ? h('span', { class: 'note' }, ` · in ${r.n} of ${v.N}`) : null, ...marks(st, r, info, today),
        h('span', { class: 'sc-actnote note' }, m ? `· ${SC.STATUS[m.st]} since ${dmy(m.date)}${m.st === 'rej' && reasonNames(st, m) ? ' · ' + reasonNames(st, m) : ''}` : '', lists.length ? ` · in ${lists.map((l) => l.name).join(', ')}` : '')),
      h('a', { class: 'btn sm', href: fvUrl(r), target: '_blank', rel: 'noopener' }, 'Open in Finviz ↗')),
    h('div', { id: 'sc-chart-ph', class: 'sc-chart-ph', 'data-symbol': r.full?.includes(':') ? r.full : r.t }, h('span', { class: 'note' }, 'Loading the TradingView chart…')),
    h('div', { class: 'sc-act' },
      btn('W', 'Watching', 'watch'), btn('N', 'Near buy', 'near'), btn('R', 'Rejected', 'rej'),
      h('button', { type: 'button', class: 'sc-sbtn list', disabled: ctx.readOnly, onClick: () => addToListDialog(ctx, [r]) }, 'Add to list', h('kbd', null, 'L')),
      h('div', { class: 'sc-keys' }, keyCols.map((c) => h('span', null, h('span', { class: 'note' }, c + ' '), h('b', null, r.vals?.[c] || '–'))),
        v.cols.length ? h('button', { type: 'button', class: 'sc-iconbtn', 'aria-label': 'Choose the key values', title: 'Choose the key values', onClick: () => keyColsDialog(ctx, v.cols, keyCols) }, '⚙') : null)));
}
function keyColsOf(st, cols) {
  const saved = (st.scans.keyCols || []).filter((c) => cols.includes(c)); if (st.scans.keyCols) return saved;
  const out = []; for (const re of SC.KEY_DEFAULT) { const c = cols.find((x) => re.test(x) && !out.includes(x)); if (c) out.push(c); } return out;
}
function keyColsDialog(ctx, cols, shown) {
  const boxes = cols.map((c) => [c, h('input', { type: 'checkbox', checked: shown.includes(c) })]);
  dialog({ title: 'Key values under the chart', ok: 'Show', body: h('div', { class: 'sc-cols' }, para('Up to 6, from your scanner columns.', 'note'), boxes.map(([c, b]) => h('label', null, b, ' ', c))),
    onOk: () => { const p = boxes.filter(([, b]) => b.checked).map(([c]) => c); if (p.length > 6) return 'Choose 6 at most.'; const r = ctx.act((d) => A.setScanKeyCols(d, p), { label: 'key values', now: true }); return r.ok ? true : r.error; } });
}

// 1.8.14 (agreed 25-11-2026): the stocks the header counts (a list, Near buy, or a quick view after filters) → Finviz.
// "All in Finviz" opens his Custom screener table with only these stocks; "Copy tickers" for any other box. TJ cannot write
// to Finviz (its API only reads), so for the Advanced Charts side panel he saves that table as a screen himself.
function listToFinviz(ctx, v, fr) {
  const tickers = SC.finvizTickers(fr.rows.map((r) => r.t)); const none = !tickers.length;
  const copy = async () => {
    const text = tickers.join(',');
    try { await navigator.clipboard.writeText(text); toast(`${plural(tickers.length, 'ticker')} copied.`); }
    catch { dialog({ title: 'Copy the tickers', info: true, ok: 'Close', body: (() => { const t = h('textarea', { rows: '4', readonly: true, 'aria-label': 'Tickers' }); t.value = text; setTimeout(() => t.select(), 0); return t; })() }); }
  };
  const l = (v.kind === 'list' || v.kind === 'ready') && v.list ? v.list : null;
  return h('div', { class: 'sc-fvl' },
    none ? h('button', { type: 'button', class: 'btn sm', disabled: true }, 'All in Finviz ↗')
      : h('a', { class: 'btn sm', href: SC.finvizListUrl(tickers), target: '_blank', rel: 'noopener', title: `Open these ${plural(tickers.length, 'stock')} in your Finviz Custom table` }, 'All in Finviz ↗'),
    h('button', { type: 'button', class: 'btn sm', disabled: none, title: 'Copy the tickers, comma-separated', onClick: copy }, 'Copy tickers'),
    l ? h('button', { type: 'button', class: 'btn sm', 'aria-label': 'More', 'aria-haspopup': 'menu', title: 'More',
      onClick: (e) => popMenu(e.currentTarget, 'More', [{ label: 'Download for TradingView', fn: () => downloadOne(ctx, l) }]) }, '⋯') : null);
}

// ---------------------------------------------------------------- Table view (all columns, for screening by numbers)
function tablePanel(ctx, st, v, fr, info, today) {
  const shown = shownCols(st, v.cols); const filtered = SC.filterCount(V.f) + (V.f.status !== 'all' ? 1 : 0) + (V.f.q ? 1 : 0);
  const parts = [h('div', { class: 'sc-tbtop' }, h('span', { class: 'note' }, plural(fr.rows.length, 'stock')), h('div', { class: 'row' },
      h('button', { class: 'btn sm' + (V.selMode ? ' pri' : ''), onClick: () => { V.selMode = !V.selMode; V.ticked = new Set(); ctx.redraw(); } }, V.selMode ? 'Done selecting' : 'Select'),
      h('button', { class: 'btn sm', onClick: () => colsDialog(ctx, v.cols, shown) }, 'Columns'), listToFinviz(ctx, v, fr))),
    filtered ? h('div', { class: 'note sc-tbnote' }, h('b', { class: 'sc-filtered' }, `Showing ${fr.rows.length} of ${fr.total} · filtered`)) : null];
  if (V.selMode) parts.push(selectBar(ctx, fr));
  if (!fr.rows.length) { parts.push(emptyRows(ctx, v, fr)); return h('section', { class: 'card sc-mid' }, parts); }
  const head = h('tr', null, V.selMode ? h('th', { class: 'sc-tk' }, '') : null, h('th', null, 'Stock'), h('th', { class: 'r', title: 'RS (scan): strength over 3, 6 and 12 months, ranked 1–99 against every stock in the scans shown. Needs Perf % 3M, 6M and 1Y columns.' }, 'RS'),
    v.kind === 'compare' ? v.runs.map((x) => h('th', { class: 'sc-hit', title: `${x.scanner} · ${SC.runLabel(st, x, today)}` }, h('span', { class: 'sc-hitn' }, x.scanner), h('span', { class: 'sc-hitd' }, SC.runLabel(st, x, today)))) : null,
    shown.map((c) => h('th', { class: 'r' }, c)), h('th', null, 'Status'));
  const body = fr.rows.map((r) => h('tr', { class: 'sc-row' + (r.t === V.sel ? ' on' : '') + (r.mark?.st === 'rej' ? ' rej' : ''), onClick: () => { V.sel = r.t; ctx.redraw(); }, onDblclick: () => { V.view = 'chart'; ctx.redraw(); } },
    V.selMode ? h('td', { class: 'sc-tk', onClick: (e) => e.stopPropagation() }, h('input', { type: 'checkbox', 'aria-label': 'Tick ' + r.t, checked: V.ticked.has(r.t), onChange: (e) => { if (e.target.checked) V.ticked.add(r.t); else V.ticked.delete(r.t); ctx.redraw(); } })) : null,
    h('td', null, h('div', { class: 'sc-sym' }, h('b', null, r.t), r.isNew ? h('span', { class: 'sc-tag new' }, 'New today') : null, r.isDropped ? h('span', { class: 'sc-tag earn' }, 'Dropped') : null,
      SC.listsOf(st, r.t).length ? h('span', { class: 'sc-tag list', title: 'In your lists: ' + SC.listsOf(st, r.t).map((l) => l.name).join(', ') }, '≡ ' + SC.listsOf(st, r.t).length) : null, ...marks(st, r, info, today))),
    h('td', { class: 'r' + (r.rs !== null && r.rs >= 80 ? ' sc-strong' : '') }, r.rs ?? '–'),
    r.hits && v.kind === 'compare' ? r.hits.map((x) => h('td', { class: 'sc-hit' + (x ? ' yes' : '') }, x ? '●' : '○')) : null,
    shown.map((c) => h('td', { class: 'r' }, r.vals?.[c] || '–')),
    h('td', { class: 'sc-stcell' }, h('button', { type: 'button', class: 'sc-stbtn', 'aria-haspopup': 'menu', 'aria-label': `Status of ${r.t}`, disabled: ctx.readOnly, onClick: (e) => { e.stopPropagation(); V.sel = r.t; statusMenu(ctx, r, e.currentTarget, v); } }, statusText(st, r.mark), h('span', { class: 'sc-caret', 'aria-hidden': 'true' }, '▾')))));
  parts.push(h('div', { class: 'sc-tw' }, h('table', { class: 'sc-t' }, h('thead', null, head), h('tbody', null, body))),
    h('div', { class: 'note sc-foot' }, 'Double-click a row to see its chart.'));
  return h('section', { class: 'card sc-mid' }, parts);
}
function shownCols(st, cols) {
  const saved = (st.scans?.showCols || []).filter((c) => cols.includes(c)); if (saved.length) return saved;
  const want = [/^adr/i, /sector/i, /^price$/i, /^float\s*%|float %/i, /earning/i]; const out = [];
  for (const re of want) { const c = cols.find((x) => re.test(x) && !out.includes(x)); if (c) out.push(c); }
  return out.length ? out : cols.slice(0, 4);
}
function colsDialog(ctx, cols, shown) {
  if (!cols.length) return dialog({ title: 'No columns', info: true, body: para('These stocks have no scanner columns. Scans copied with TJ Collect bring every column you see in TradingView.', '') });
  const boxes = cols.map((c) => [c, h('input', { type: 'checkbox', checked: shown.includes(c) })]);
  dialog({ title: 'Columns to show', ok: 'Show', body: h('div', { class: 'sc-cols' }, para('Up to 8. All columns stay saved with each scan; this only chooses what you see.', 'note'), boxes.map(([c, b]) => h('label', null, b, ' ', c))),
    onOk: () => { const p = boxes.filter(([, b]) => b.checked).map(([c]) => c); if (p.length > 8) return 'Choose 8 columns at most.'; const r = ctx.act((d) => A.setScanCols(d, p), { label: 'scan columns', now: true }); return r.ok ? true : r.error; } });
}

// ---------------------------------------------------------------- marks, status
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
    const rs = x.closed.map((t) => C.rMultiple(t)).filter((q) => q !== null); const sum = rs.reduce((a, b) => a + b, 0n);
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
function statusMenu(ctx, r, anchor, v) {
  const cur = r.mark?.st || null; const l = v?.kind === 'list' ? v.list : null;
  popMenu(anchor, `Status of ${r.t}`, [
    { label: 'Watching', key: 'W', cls: 'watch', on: cur === 'watch', fn: () => setStatus(ctx, r, 'watch') },
    { label: 'Near buy', key: 'N', cls: 'near', on: cur === 'near', fn: () => setStatus(ctx, r, 'near') },
    { label: 'Rejected…', key: 'R', cls: 'rej', on: cur === 'rej', fn: () => rejectDialog(ctx, r) },
    { label: 'Add to list…', key: 'L', cls: 'sep', fn: () => addToListDialog(ctx, [r]) },
    l ? { label: `Move to another list…`, fn: () => moveItemDialog(ctx, l, { t: r.t }) } : null,
    l ? { label: `Remove from ${l.name}…`, cls: 'rej', fn: () => removeItem(ctx, l, { t: r.t }, SC.listsOf(ctx.store.state, r.t).filter((o) => o.id !== l.id)) } : null,
    cur ? { label: 'Not decided', cls: 'none', fn: () => { const res = ctx.act((d) => A.clearScanMark(d, r.t), { label: `${r.t} not decided`, now: true }); if (!res.ok) toast(res.error); ctx.redraw(); } } : null]);
}
function setStatus(ctx, r, status, reasons = [], other = '') {
  const res = ctx.act((d) => A.setScanMark(d, r.t, { status, reasons, other, date: ctx.today() }), { label: `${r.t} ${SC.STATUS[status].toLowerCase()}`, now: true });
  if (!res.ok) return toast(res.error);
  const i = LAST.rows.findIndex((x) => x.t === r.t); const next = LAST.rows.slice(i + 1).find((x) => !x.mark) || LAST.rows.find((x) => !x.mark && x.t !== r.t);
  if (next && !r.mark) V.sel = next.t;
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

// ---------------------------------------------------------------- scanners and comparisons
async function renameScannerDialog(ctx, name) {
  const inp = h('input', { value: name, 'aria-label': 'Scanner name', maxlength: '60' }); setTimeout(() => inp.select(), 0);
  let to = null;
  await dialog({ title: `Rename ${name}`, ok: 'Rename', body: h('div', { style: { display: 'grid', gap: '8px' } }, field('Name', inp), para('Use the same name as in TradingView, so TJ Collect files new scans under it.', 'note')),
    onOk: () => { const r = ctx.act((d) => A.renameScanner(d, name, inp.value), { label: 'rename scanner', now: true }); if (r.ok) to = inp.value.trim(); return r.ok ? true : r.error; } });
  if (to && V.src?.kind === 'scanner' && V.src.name === name) V.src = { ...V.src, name: to }; ctx.redraw();
}
async function deleteScannerDialog(ctx, name) {
  const n = SC.scannerRuns(ctx.store.state, name).length;
  const ok = await dialog({ title: `Delete ${name} and its ${plural(n, 'scan')}?`, ok: 'Delete', danger: true, body: para('Everything moves to the Trash for 15 days, so you can restore it. Your statuses on the stocks and your lists stay.', '') });
  if (!ok) return; const r = ctx.act((d) => A.deleteScanner(d, name), { label: 'delete scanner', now: true });
  if (r.ok) toast(`${name} moved to the Trash.`, 'Undo', () => ctx.store.undo()); else toast(r.error); ctx.redraw();
}
async function deleteRunDialog(ctx, run) {
  const ok = await dialog({ title: `Delete the ${run.scanner} scan of ${dmy(run.date)}?`, ok: 'Delete', danger: true, body: para('It moves to the Trash for 15 days. Your statuses on the stocks stay.', '') });
  if (!ok) return; const r = ctx.act((d) => A.deleteScanRun(d, run.id), { label: 'delete scan', now: true }); if (r.ok) { V.src = { kind: 'scanner', name: run.scanner }; toast('Scan moved to the Trash.', 'Undo', () => ctx.store.undo()); } ctx.redraw();
}
async function compareDialog(ctx, c) {
  const names = SC.runsByScanner(ctx.store.state).map((g) => g.scanner);
  const boxes = names.map((n) => [n, h('input', { type: 'checkbox', checked: !!c?.scanners.includes(n) })]);
  const nm = h('input', { value: c?.name || '', maxlength: '60', 'aria-label': 'Name', placeholder: 'Leave empty to use the scanner names' });
  let made = null;
  await dialog({ title: c ? `Edit ${c.name}` : 'New comparison', ok: c ? 'Save' : 'Create', body: h('div', { style: { display: 'grid', gap: '10px' } },
    para('Tick 2 or more scanners. Every day it uses the newest scan of each, so after you collect you only click it.', 'note'),
    h('div', { class: 'sc-cols' }, boxes.map(([n, b]) => h('label', null, b, ' ', n))), field('Name', nm)),
    onOk: () => { const pick = boxes.filter(([, b]) => b.checked).map(([n]) => n); const name = nm.value.trim() || pick.join(' + ').slice(0, 60);
      const r = ctx.act((d) => (c ? A.editScanCompare(d, c.id, name, pick) : A.addScanCompare(d, name, pick)), { label: c ? 'edit comparison' : 'new comparison', now: true });
      if (r.ok && !c) made = r.data.id; return r.ok ? true : r.error; } });
  if (made) openSrc(ctx, { kind: 'compare', id: made }); else ctx.redraw();
}
async function deleteCompareDialog(ctx, c) {
  const ok = await dialog({ title: `Delete the comparison ${c.name}?`, ok: 'Delete', danger: true, body: para('Only the comparison goes (to the Trash for 15 days). Your scans, statuses and lists stay.', '') });
  if (!ok) return; const r = ctx.act((d) => A.deleteScanCompare(d, c.id), { label: 'delete comparison', now: true }); if (r.ok) toast(`${c.name} moved to the Trash.`, 'Undo', () => ctx.store.undo()); ctx.redraw();
}

// ---------------------------------------------------------------- add to list (L, menu, decision bar, Select)
async function addToListDialog(ctx, rows, after) {
  if (ctx.readOnly || !rows.length) return;
  const sc = ctx.store.state.scans; const choice = { id: null }; const opts = [];
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
      body: h('div', { class: 'sc-dup' }, rows.length > 1 ? h('ul', { class: 'sc-ul' }, lines) : null, h('label', null, keep, ' Keep in both'), h('label', null, rem, ` Remove from ${names.length === 1 ? names[0] : 'those lists'}`)) });
    if (!go) return; if (rem.checked) removeFrom = [...elsewhere.keys()];
  }
  const res = ctx.act((d) => A.addToScanList(d, target, rows.map((r) => ({ t: r.t, full: r.full || r.t })), { removeFrom, date: ctx.today() }), { label: 'add to ' + tName, now: true });
  if (!res.ok) return toast(res.error);
  after?.(); ctx.redraw();
  toast(res.data.added ? `${plural(res.data.added, 'stock')} added to ${tName}.` : `Already in ${tName}.`, 'Undo', () => ctx.store.undo());
}

// ---------------------------------------------------------------- folders and lists
async function nameDialog(ctx, title, value, act) {
  const inp = h('input', { value, maxlength: '60', 'aria-label': 'Name' }); setTimeout(() => inp.select(), 0);
  await dialog({ title, ok: 'Save', body: field('Name', inp), onOk: () => { const r = ctx.act((d) => act(d, inp.value), { label: title.toLowerCase(), now: true }); return r.ok ? true : r.error; } });
  ctx.redraw();
}
async function newFolderDialog(ctx) {
  const inp = h('input', { maxlength: '60', 'aria-label': 'Folder name', placeholder: 'Swing December' }); setTimeout(() => inp.focus(), 0);
  await dialog({ title: 'New folder', ok: 'Create', body: h('div', { style: { display: 'grid', gap: '8px' } }, field('Name', inp), para('A folder becomes one watchlist in TradingView; its lists become the sections.', 'note')),
    onOk: () => { const r = ctx.act((d) => A.addScanFolder(d, inp.value), { label: 'new folder', now: true }); return r.ok ? true : r.error; } });
  ctx.redraw();
}
async function newListDialog(ctx, folder) {
  const sc = ctx.store.state.scans;
  const inp = h('input', { maxlength: '60', 'aria-label': 'List name', placeholder: 'Tier A' }); setTimeout(() => inp.focus(), 0);
  const sel = h('select', { 'aria-label': 'Folder' }, h('option', { value: '' }, 'No folder'), sc.folders.map((f) => h('option', { value: f.id, selected: f.id === folder }, f.name)));
  let made = null;
  await dialog({ title: 'New list', ok: 'Create', body: h('div', { style: { display: 'grid', gap: '8px' } }, field('Name', inp), field('Folder', sel)),
    onOk: () => { const r = ctx.act((d) => A.addScanList(d, inp.value, sel.value || null), { label: 'new list', now: true }); if (r.ok) made = r.data.id; return r.ok ? true : r.error; } });
  if (made) openSrc(ctx, { kind: 'list', id: made }); else ctx.redraw();
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
  if (!others.length) return toast('Make another list first (+ List under Sources).');
  const sel = h('select', { 'aria-label': 'To list' }, others.map((o) => h('option', { value: o.id }, (o.folder ? sc.folders.find((f) => f.id === o.folder)?.name + ' › ' : '') + o.name)));
  await dialog({ title: `Move ${x.t}`, ok: 'Move', body: field('To list', sel), onOk: () => { const r = ctx.act((d) => A.moveScanItems(d, l.id, sel.value, [x.t], { date: ctx.today() }), { label: 'move ' + x.t, now: true }); return r.ok ? true : r.error; } });
  ctx.redraw();
}
async function cleanUpDialog(ctx, l, stale) {
  const ok = await dialog({ title: `Clean up ${l.name}?`, ok: 'Remove them', body: h('div', { style: { display: 'grid', gap: '8px' } }, para('These stocks were rejected or bought since you added them:', ''), h('b', null, [...stale].join(', ')), para('They leave this list only. Undo brings them back.', 'note')) });
  if (!ok) return; const r = ctx.act((d) => A.cleanUpScanLists(d, [l.id]), { label: 'clean up ' + l.name, now: true }); if (r.ok) toast(`${plural(r.data.n, 'stock')} removed.`, 'Undo', () => ctx.store.undo()); ctx.redraw();
}

// ---------------------------------------------------------------- downloads (TradingView: watchlist name → Import list…)
const importHint = 'In TradingView: click the watchlist name → Import list… and pick the file from your Downloads.';
const noExch = (lists) => { const n = [...new Set(lists.flatMap((l) => l.items).filter((x) => !(x.full || '').includes(':')).map((x) => x.t))]; return n.length ? ` ${n.length} without exchange (${n.slice(0, 5).join(', ')}${n.length > 5 ? '…' : ''}): TradingView may skip them.` : ''; };
function downloadOne(ctx, l) {
  if (!l.items.length) return toast('This list is empty.');
  const name = `${SC.safeFileName(l.name)} ${dmy(ctx.today())}.txt`;
  download(name, new Blob([SC.tradingViewList(l.items)], { type: 'text/plain' })); toast(`Saved “${name}”. ${importHint}` + noExch([l]), null, null, 9000);
}
function downloadSections(ctx, title, lists) {
  const withItems = lists.filter((l) => l.items.length); if (!withItems.length) return toast('These lists are empty.');
  const name = `${SC.safeFileName(title)} ${dmy(ctx.today())}.txt`;
  download(name, new Blob([SC.tradingViewSections(withItems)], { type: 'text/plain' }));
  toast(`Saved “${name}”: one watchlist with ${plural(withItems.length, 'section')}. ${importHint}` + noExch(withItems), null, null, 9000);
}
async function downloadManyDialog(ctx) {
  const sc = ctx.store.state.scans; const ready = SC.readyLists(ctx.store.state);
  const all = [...ready, ...sc.lists]; const boxes = all.map((l) => [l, h('input', { type: 'checkbox' })]);
  const one = h('input', { type: 'radio', name: 'sc-dlm', checked: true }); const sep = h('input', { type: 'radio', name: 'sc-dlm' });
  const ok = await dialog({ title: 'Download lists for TradingView', ok: 'Download', body: h('div', { style: { display: 'grid', gap: '10px' } },
    h('div', { class: 'sc-cols' }, boxes.map(([l, b]) => h('label', null, b, ' ', l.name, h('span', { class: 'note' }, ` · ${l.items.length}`)))),
    h('div', { class: 'sc-dup' }, h('label', null, one, ' One watchlist, each list a section'), h('label', null, sep, ' Separate files, one watchlist each'))),
    onOk: () => (boxes.some(([, b]) => b.checked) ? true : 'Tick at least one list.') });
  if (!ok) return; const pick = boxes.filter(([, b]) => b.checked).map(([l]) => l);
  if (one.checked) return downloadSections(ctx, pick.length === 1 ? pick[0].name : 'TJ lists', pick);
  const withItems = pick.filter((l) => l.items.length); if (!withItems.length) return toast('These lists are empty.');
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
  if (p.source === 'finviz' && p.fv) {
    const prev = A.finvizRunFor(ctx.store.state, scanner, date, p.fv.key);
    if (prev && !(prev.fvPages || []).includes(p.fv.page)) {
      const res = ctx.act((d) => A.joinFinvizPage(d, prev.id, { cols: p.cols, rows: p.rows, page: p.fv.page, shown: p.shown }), { label: `${scanner} page ${p.fv.page}`, now: true });
      if (!res.ok) return toast(res.error);
      V.src = { kind: 'scanner', name: scanner, run: prev.id }; V.q = 'all'; V.sel = null; ctx.redraw();
      const r = res.data.run; const pages = r.shown ? Math.ceil(r.shown / 20) : null; const left = pages ? [...Array(pages).keys()].map((i) => i + 1).filter((n) => !r.fvPages.includes(n)) : [];
      return toast(`${scanner}: page ${p.fv.page} joined · ${r.rows.length}${r.shown ? ' of ' + r.shown : ''} stocks.` + (left.length ? ` Still missing page ${left.slice(0, 6).join(', ')}${left.length > 6 ? '…' : ''}.` : r.shown ? ' All pages in.' : ''), 'Undo', () => ctx.store.undo(), 8000);
    }
  }
  let replace = false;
  if (A.scanRunExists(ctx.store.state, scanner, date)) {
    const keep = h('input', { type: 'radio', name: 'sc-dup', value: 'keep' }); const rep = h('input', { type: 'radio', name: 'sc-dup', value: 'replace', checked: true });
    const ok = await dialog({ title: `${scanner} was already added ${date === today ? 'today' : 'on ' + dmy(date)}`, ok: 'Add', body: h('div', { class: 'sc-dup' },
      h('label', null, rep, ' Replace that scan with this one'), h('label', null, keep, ' Keep both (New today and Dropped today then compare the two)'), para('Your statuses on the stocks stay either way.', 'note')) });
    if (!ok) return; replace = rep.checked;
  }
  const res = ctx.act((d) => A.addScanRun(d, { scanner, date, cols: p.cols, rows: p.rows, shown: p.shown, fv: p.fv || null }, { replace, today }), { label: 'scan ' + scanner, now: true });
  if (!res.ok) return toast(res.error);
  V.src = { kind: 'scanner', name: scanner, run: res.data.run.id }; V.q = 'all'; V.sel = null; ctx.redraw();
  const miss = p.source === 'finviz' && p.shown && p.rows.length < p.shown ? ` Page ${p.fv.page} of ${Math.ceil(p.shown / 20)}: collect the next pages on Finviz the same way, they join this scan.` : p.shown && p.rows.length < p.shown ? ` TradingView showed ${p.shown}; scroll to the bottom of the list and collect again to get all.` : '';
  toast(`${scanner}: ${plural(p.rows.length, 'stock')} added.` + miss, 'Undo', () => ctx.store.undo(), miss ? 9000 : 5000);
}

// ---------------------------------------------------------------- 1.8.10 Finviz Elite: his screeners through his Google helper
// The helper's address and the shared secret live only in this browser (asked once per computer). The Finviz key lives only in
// his Google helper. The data file keeps the screeners' names and filters.
const HELPER_KEY = 'tj-fv-helper';
const helperGet = () => { try { return JSON.parse(localStorage.getItem(HELPER_KEY) || 'null'); } catch { return null; } };
const helperSet = (x) => { try { localStorage.setItem(HELPER_KEY, JSON.stringify(x)); return true; } catch { return false; } };
// 1.8.11: one "connection code" (helper address + secret) moves the connection to another computer, with no change in Google
export const connCode = (x) => 'TJFV1.' + btoa(JSON.stringify({ u: x.url, s: x.secret }));
export function readConnCode(text) {
  const t = String(text || '').trim(); if (!t.startsWith('TJFV1.')) return null;
  try { const o = JSON.parse(atob(t.slice(6))); if (/^https:\/\/script\.google(usercontent)?\.com\//.test(o.u) && typeof o.s === 'string' && o.s.length >= 16) return { url: o.u, secret: o.s }; } catch { /* not a code */ }
  return null;
}
const newSecret = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, '');
async function fvFetch(helper, q) {
  const url = helper.url + (helper.url.includes('?') ? '&' : '?') + 'secret=' + encodeURIComponent(helper.secret) + '&q=' + encodeURIComponent(q);
  let res; try { res = await fetch(url, { redirect: 'follow' }); } catch { return { ok: false, error: 'The helper could not be reached. Check its address, and that it is deployed for "Anyone".' }; }
  let j; try { j = await res.json(); } catch { return { ok: false, error: 'The helper did not answer properly. Check that you deployed it as a Web app.' }; }
  if (!j.ok) return { ok: false, error: j.error === 'Wrong secret' ? 'The secret in the helper does not match. Copy the helper code again from here.' : `Finviz answered with an error (${j.code || j.error}). Check the key in the helper.` };
  return SC.finvizCsvToScan(j.csv);
}
async function helperDialog(ctx) {
  const cur = helperGet() || { url: '', secret: newSecret() };
  const url = h('input', { value: cur.url, placeholder: 'https://script.google.com/macros/s/…/exec', 'aria-label': 'Helper address' });
  const code = SC.HELPER_CODE.replace('PASTE_THE_SECRET_FROM_TRADE_JOURNAL_HERE', cur.secret);
  const copy = h('button', { type: 'button', class: 'btn sm pri', onClick: async () => { try { await navigator.clipboard.writeText(code); toast('Helper code copied. Paste it in Google Apps Script.'); } catch { box.hidden = false; box.select(); } } }, 'Copy the helper code');
  const box = h('textarea', { rows: '6', readonly: true, hidden: true, 'aria-label': 'Helper code' }); box.value = code;
  let saved = false; let other = false;
  const have = helperGet();
  const copyConn = have ? h('div', { class: 'sc-getbtn' }, h('div', null, h('b', null, 'Another computer?'), para('Copy this connection code and paste it there under “Already set up on another computer?”. Keep it private, like a password.', 'note')),
    h('button', { type: 'button', class: 'btn sm', onClick: async () => { try { await navigator.clipboard.writeText(connCode(have)); toast('Connection code copied.'); } catch { toast('Copy did not work in this browser.'); } } }, 'Copy connection code')) : null;
  const otherBtn = have ? null : h('button', { type: 'button', class: 'linkish', onClick: () => { other = true; document.querySelector('.scrim .dlg-foot .btn:not(.pri)')?.click(); } }, 'Already set up on another computer? Connect to your helper');
  const ok0 = await dialog({ title: 'Connect your Finviz Elite', ok: 'Save', body: h('div', { style: { display: 'grid', gap: '10px' } }, otherBtn, copyConn,
    para('Finviz does not let websites read its files directly, so a small helper in your own Google account fetches them for Trade Journal. Your Finviz key stays in that helper.', ''),
    h('div', { class: 'sc-getbtn' }, h('div', null, h('b', null, '1. The helper code'), para('Already contains this computer\'s secret. You add only your Finviz key.', 'note')), copy), box,
    field('2. Helper address (the Web app address from Google)', url),
    para('The address and secret are kept only in this browser. On another computer you connect once more (same helper, new code copy).', 'note')),
    onOk: () => { const u = url.value.trim(); if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(u)) return 'Paste the Web app address from Google Apps Script (it starts with https://script.google.com/).'; saved = helperSet({ url: u, secret: cur.secret }); return saved ? true : 'This browser does not allow saving it.'; } });
  if (!ok0 && other) {
    // 1.8.12: two ways — the connection code, or the helper address + the secret straight from his Apps Script (no other computer needed)
    const box2 = h('textarea', { rows: '2', 'aria-label': 'Connection code', placeholder: 'TJFV1.…' });
    const u2 = h('input', { 'aria-label': 'Helper address', placeholder: 'https://script.google.com/macros/s/…/exec' });
    const s2 = h('input', { 'aria-label': 'Secret', placeholder: 'the text between the quotes in TJ_SECRET', autocomplete: 'off' });
    setTimeout(() => box2.focus(), 0);
    await dialog({ title: 'Connect to your helper', ok: 'Connect', body: h('div', { style: { display: 'grid', gap: '10px' } },
      h('div', { class: 'sc-getbtn sc-conn' }, h('div', { style: { display: 'grid', gap: '6px', width: '100%' } }, h('b', null, 'Either: the connection code'), para('From a computer where Finviz already works: ⟳ Finviz → Helper settings → Copy connection code.', 'note'), box2)),
      h('div', { class: 'sc-getbtn sc-conn' }, h('div', { style: { display: 'grid', gap: '6px', width: '100%' } }, h('b', null, 'Or: address and secret from your Google helper'),
        para('In script.google.com → TJ helper: the secret is the text between the quotes in the line const TJ_SECRET = "…" (not the Finviz key). The address is under Deploy → Manage deployments → Web app URL.', 'note'),
        field('Helper address', u2), field('Secret (TJ_SECRET)', s2)))),
      onOk: () => {
        const c = box2.value.trim() ? readConnCode(box2.value) : null;
        if (box2.value.trim() && !c) return 'That is not a connection code from Trade Journal.';
        let x = c;
        if (!x) {
          const u = u2.value.trim(); const sec = s2.value.trim().replace(/^['"]|['"]$/g, '');
          if (!u && !sec) return 'Paste the connection code, or the address and the secret.';
          if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(u)) return 'The address should start with https://script.google.com/';
          if (sec.length < 16 || /PASTE_/.test(sec)) return 'That does not look like the secret. Copy the text between the quotes in the TJ_SECRET line.';
          x = { url: u, secret: sec };
        }
        saved = helperSet(x); return saved ? true : 'This browser does not allow saving it.'; } });
    if (saved) toast('Connected. This computer uses the same helper now.');
  }
  return saved;
}
async function screenDialog(ctx, x) {
  const nm = h('input', { value: x?.name || '', maxlength: '60', 'aria-label': 'Name', placeholder: 'Breakout' });
  const ad = h('input', { value: '', 'aria-label': 'Finviz screener address', placeholder: x ? 'Leave empty to keep the same filters' : 'https://elite.finviz.com/screener?v=141&f=…' });
  setTimeout(() => (x ? nm : ad).focus(), 0); let res = null;
  await dialog({ title: x ? `Edit ${x.name}` : 'Add a Finviz screener', ok: 'Save', body: h('div', { style: { display: 'grid', gap: '10px' } },
    field('Screener address (copy it from the browser bar on Finviz)', ad), field('Name in Trade Journal', nm),
    para('Use the Performance view (or a table view) on Finviz before you copy the address: Performance gives RS. Your key is never needed here.', 'note')),
    onOk: () => { const r = ctx.act((d) => (x ? A.editFvScreen(d, x.id, nm.value, ad.value) : A.addFvScreen(d, nm.value, ad.value)), { label: x ? 'edit screener' : 'add screener', now: true }); if (!r.ok) return r.error; res = r.data; return true; } });
  if (res?.warn) toast(res.warn, null, null, 9000); else if (res && !x && !res.perf) toast('Saved. Tip: the Performance view gives RS.', null, null, 6000);
  return res;
}
async function fvGetDialog(ctx) {
  if (ctx.readOnly) return;
  if (!helperGet()) { const ok = await helperDialog(ctx); if (!ok) return; }
  const st = ctx.store.state; const screens = st.scans.fvScreens || [];
  if (!screens.length) { const r = await screenDialog(ctx, null); if (!r) return; return fvGetDialog(ctx); }
  const today = ctx.today();
  // his choice B (23-11-2026): nothing pre-ticked; he ticks what he wants each time
  const boxes = screens.map((x) => [x, h('input', { type: 'checkbox', 'aria-label': 'Get ' + x.name })]);
  const go = h('span'); const upd = () => { const n = boxes.filter(([, b]) => b.checked).length; go.textContent = n ? `${n} ticked` : 'Tick the screeners you want'; };
  boxes.forEach(([, b]) => b.addEventListener('change', upd)); upd();
  let action = null;
  const rowEl = ([x, b]) => h('div', { class: 'sc-fvrow' }, h('label', null, b, ' ', h('b', null, x.name)), h('span', { class: 'note' }, x.last ? 'last: ' + (x.last === today ? 'today' : dmy(x.last)) : 'never fetched'),
    h('button', { type: 'button', class: 'sc-micon', 'aria-label': 'Edit ' + x.name, title: 'Edit', onClick: () => { action = { k: 'edit', x }; document.querySelector('.scrim .dlg-foot .btn:not(.pri)')?.click(); } }, '✎'),
    h('button', { type: 'button', class: 'sc-micon del', 'aria-label': 'Delete ' + x.name, title: 'Delete', onClick: () => { action = { k: 'del', x }; document.querySelector('.scrim .dlg-foot .btn:not(.pri)')?.click(); } }, '🗑'));
  const ok = await dialog({ title: 'Get scans from Finviz', ok: 'Get ticked', body: h('div', { style: { display: 'grid', gap: '8px' } },
    h('div', { class: 'sc-fvlist' }, boxes.map(rowEl)), h('div', { class: 'note' }, go),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn sm', onClick: () => { action = { k: 'add' }; document.querySelector('.scrim .dlg-foot .btn:not(.pri)')?.click(); } }, '+ Add screener'),
      h('button', { type: 'button', class: 'linkish', onClick: () => { action = { k: 'helper' }; document.querySelector('.scrim .dlg-foot .btn:not(.pri)')?.click(); } }, 'Helper settings'))),
    onOk: () => (boxes.some(([, b]) => b.checked) ? true : 'Tick at least one screener.') });
  if (!ok) {
    if (action?.k === 'add') { await screenDialog(ctx, null); return fvGetDialog(ctx); }
    if (action?.k === 'edit') { await screenDialog(ctx, action.x); return fvGetDialog(ctx); }
    if (action?.k === 'helper') { await helperDialog(ctx); return fvGetDialog(ctx); }
    if (action?.k === 'del') { const y = await dialog({ title: `Delete the screener ${action.x.name}?`, ok: 'Delete', danger: true, body: para('Only its saved address in Trade Journal goes. Its scans stay.', '') }); if (y) ctx.act((d) => A.deleteFvScreen(d, action.x.id), { label: 'delete screener', now: true }); return fvGetDialog(ctx); }
    return;
  }
  const pick = boxes.filter(([, b]) => b.checked).map(([x]) => x); const helper = helperGet(); const done = []; const failed = [];
  for (let i = 0; i < pick.length; i++) {
    const x = pick[i]; toast(`Getting ${x.name} (${i + 1} of ${pick.length})…`, null, null, 20000);
    const r = await fvFetch(helper, x.q);
    if (!r.ok) { failed.push(`${x.name}: ${r.error}`); continue; }
    if (!r.rows.length) { failed.push(`${x.name}: no stocks today`); ctx.act((d) => A.markFvFetched(d, x.id, today), { label: 'fetched', now: true, noUndo: true }); continue; }
    const res = ctx.act((d) => { const a = A.addScanRun(d, { scanner: x.name, date: today, cols: r.cols, rows: r.rows, shown: r.rows.length }, { replace: true, today }); if (a.ok) A.markFvFetched(d, x.id, today); return a; }, { label: 'Finviz ' + x.name, now: true });
    if (res.ok) done.push(`${x.name} ${r.rows.length}`); else failed.push(`${x.name}: ${res.error}`);
  }
  if (done.length) { V.src = { kind: 'scanner', name: pick.find((x) => done.some((d) => d.startsWith(x.name + ' '))).name }; V.q = 'all'; V.sel = null; }
  ctx.redraw();
  if (failed.length) dialog({ title: done.length ? 'Some screeners did not come' : 'Nothing came from Finviz', info: true, body: h('div', { style: { display: 'grid', gap: '6px' } }, done.length ? para('Got: ' + done.join(' · '), '') : null, h('ul', { class: 'sc-ul' }, failed.map((f) => h('li', null, f)))) });
  else toast(`Got from Finviz: ${done.join(' · ')}.`, null, null, 7000);
}
