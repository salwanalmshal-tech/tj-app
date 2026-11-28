// Scans tab — 1.8.17 redesign. Agreed with him 25-11-2026 (releases/scans-simplify-decisions.md), his test fixes A1–A7 and the v2
// fixes (27-11-2026, releases/scans-preview-v2-feedback.md), and the later Scans ideas he chose 27-11-2026 (releases/new-look-NOT-chosen.md;
// preview https://claude.ai/artifact/LEKWP4zbRBctY8mAmCqDut), all in TJ's own look:
// - the chart takes most of the screen; next to it ONE stock panel with four tabs Scans · Compare · My lists · Status (drag a tab to move it);
// - one concept everywhere: each tab shows ONE scanner / comparison / list / status, picked with its name ▾; the same head in every tab
//   ([Name ▾ + count line] [day ▾] … ✎ 🗑 + — the icons show when the mouse is on the head); Status ▾ · Select · Finviz ↗ the same way;
// - stocks: status line · ticker · tags · RS (status word and ▼ when the mouse is on them); ▼ = statuses as pills + Add to list ›;
// - a scanner's stocks can be dragged into his own order (A4, saved in his file); lists keep sections, dragged like before;
// - Filter is a small panel (RS, Price, Sector, Earnings, + Add a filter: any column of his Finviz exports); chips under the head;
// - Ctrl + K quick jump; ⤢ full-size chart; TJ remembers the tab, picks, width and view on this computer (never in his data file).
// Rejected stocks are hidden in scans and lists ("3 rejected hidden"); every stock with a status is in the Status tab.
// Keys: ↑ ↓ move (the chart follows), Enter opens Finviz, Ctrl+V pastes a scan, Ctrl+K quick jump, ? keys. No status keys (his choice).
import { h, dialog, para, toast, download, dmy, field } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';
import * as A from '../actions.js';
import * as SC from '../scans.js';
import { STATUS_COLORS } from '../model.js';

const V = { tab: 'scans', tabs: ['scans', 'compare', 'lists', 'status'], pick: { scans: null, compare: null, status: null }, list: null, sel: null, view: 'chart', pw: 400, focus: false,
  f: SC.emptyFilter(), fOpen: false, fAdded: [], earnN: 7, stHide: new Set(), q: 'all', selMode: false, ticked: new Set(), showRej: {}, part: {}, day: {} };
let CTX = null;
let LAST = { rows: [], focus: null, shown: 0, total: 0, built: [] };
let FETCHING = false;
const isTyping = (el) => !!el && (el.closest?.('input, textarea, select, [contenteditable="true"]'));
const dialogOpen = () => !!document.querySelector('.scrim, .sc-menu');
const menuHidden = () => { try { return localStorage.getItem('tj-scans-nomenu') === '1'; } catch { return false; } };
// 1.8.10: his Finviz Elite chart page (daily, his 1h1v layout, his screener in the sidebar); only the ticker changes. Finviz writes BRK.B as BRK-B.
const fvUrl = (r) => 'https://elite.finviz.com/charts?t=' + encodeURIComponent(SC.finvizTicker(r.t)) + '&p=d&l=1h1v&sidebar=screener&screener=154772492'; // 154772492 = his W1-1M screen
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const COLOR_NAME = { blue: 'Blue', green: 'Green', amber: 'Amber', red: 'Red', grey: 'Grey' };
const dot = (color) => h('i', { class: 'sc-dot c-' + (STATUS_COLORS.includes(color) ? color : 'grey'), 'aria-hidden': 'true' });

// ---------------------------------------------------------------- keys and paste (only on the Scans tab)
if (typeof document !== 'undefined') {
  document.addEventListener('paste', (e) => {
    if (!CTX || CTX.route !== 'scans' || isTyping(e.target) || dialogOpen()) return;
    const text = e.clipboardData?.getData('text') ?? ''; if (!text.trim()) return;
    e.preventDefault(); takePaste(CTX, text);
  });
  document.addEventListener('keydown', (e) => {
    if (!CTX || CTX.route !== 'scans' || dialogOpen()) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); quickJump(CTX); return; }
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key; const rows = LAST.rows; if (k === '?') { e.preventDefault(); keysHelp(); return; } if (!rows.length || V.view !== 'chart') return;
    const i = Math.max(0, rows.findIndex((x) => x.key === V.sel?.key && x.r.t === V.sel?.t));
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); const j = Math.min(rows.length - 1, Math.max(0, i + (k === 'ArrowDown' ? 1 : -1))); V.sel = { t: rows[j].r.t, key: rows[j].key }; remember(); CTX.redraw(); return; }
    if (k === 'Enter') { const cur = rows[i]; if (cur) { e.preventDefault(); window.open(fvUrl(cur.r), '_blank', 'noopener'); } }
  });
  // short hover tips (his wish v2 #3): after a short pause, gone after about 2 seconds
  let tipEl = null; let tipT1 = null; let tipT2 = null;
  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest?.('.scans [data-tip], .sc-menu [data-tip], .sc-fpop [data-tip]'); clearTimeout(tipT1); clearTimeout(tipT2); tipEl?.remove(); tipEl = null;
    if (!el || !el.dataset.tip || document.body.classList.contains('sc-dragging') || !CTX || CTX.route !== 'scans') return;
    tipT1 = setTimeout(() => {
      if (!el.isConnected) return; tipEl = h('div', { class: 'sc-tip', role: 'tooltip' }, el.dataset.tip); document.body.append(tipEl);
      const r = el.getBoundingClientRect(); const w = tipEl.offsetWidth;
      tipEl.style.left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + 'px';
      tipEl.style.top = (r.top - tipEl.offsetHeight - 8 < 0 ? r.bottom + 8 : r.top - tipEl.offsetHeight - 8) + 'px';
      tipT2 = setTimeout(() => { tipEl?.remove(); tipEl = null; }, 2000);
    }, 450);
  });
  document.addEventListener('pointerdown', () => { clearTimeout(tipT1); tipEl?.remove(); tipEl = null; }, true);
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
  if (!ph || !CTX || CTX.route !== 'scans' || document.querySelector('.sc-dragging')) { if (!ph || !CTX || CTX.route !== 'scans') HOST.style.display = 'none'; return; }
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

// ---------------------------------------------------------------- sections of the three tabs
// A section = one scanner, comparison, list section or status. Its stocks come from SC.sourceView.
const folded = (st, key, dflt = false) => { const f = key in LOCAL_FOLD ? LOCAL_FOLD[key] : st.scans.fold?.[key]; return f === undefined ? dflt : !!f; };
function scanKeys(st) {
  const sc = st.scans; const groups = SC.runsByScanner(st);
  const all = [...groups.map((g) => 'S:' + g.scanner), ...(sc.compares || []).map((c) => 'C:' + c.id)];
  const have = new Set(all); const out = (sc.order || []).filter((k) => have.has(k));
  for (const k of all) if (!out.includes(k)) out.push(k);
  return out;
}
function currentList(st) {
  const fs = st.scans.folders || []; if (!fs.length) return null;
  if (!fs.some((f) => f.id === V.list)) { let saved = null; try { saved = localStorage.getItem('tj-scans-list'); } catch { /* fine */ } V.list = fs.some((f) => f.id === saved) ? saved : fs[0].id; }
  return fs.find((f) => f.id === V.list);
}

function emptyState(ctx) {
  // 1.8.10: both sources (TradingView and Finviz)
  const src = (name, btn, how) => h('div', { class: 'sc-getbtn' }, h('div', null, h('b', null, name), para(how, 'note')), btn);
  return h('section', { class: 'card sc-empty' }, h('h2', null, 'Start with your first scan'),
    h('ol', null,
      h('li', null, h('b', null, 'Get your Finviz scanners: '), 'click ⟳ Get from Finviz Elite below.'),
      h('li', null, h('b', null, 'Or put a TJ Collect button on your bookmarks bar. '), 'Drag the button for the site you scan on onto the bar (show the bar with Ctrl + Shift + B):',
        h('div', { class: 'sc-emptysrc' },
          src('TradingView', dragButton(), 'Copies the scanner rows with every column you see.'),
          src('Finviz', dragButton(true), 'Copies the 20 stocks of the page you see; collect page 2, 3 … the same way and they join one scan.'))),
      h('li', null, h('b', null, 'Come back here and press Ctrl + V. '), 'Each screener becomes a scanner in the Scans tab.')),
    h('div', { class: 'row' }, h('button', { class: 'btn pri', disabled: ctx.readOnly, onClick: () => fvGetDialog(ctx) }, '⟳ Get from Finviz Elite'), h('button', { class: 'btn', onClick: () => pasteFromButton(ctx) }, 'Paste a scan'), h('span', { class: 'note' }, 'You can also paste plain tickers, for example NVDA, AAPL, WMT.')));
}
function dragButton(fv = false) {
  return h('a', { class: 'sc-drag' + (fv ? ' fv' : ''), href: fv ? SC.collectFvHref() : SC.collectHref(), draggable: 'true', title: 'Drag me to your bookmarks bar', onClick: (e) => { e.preventDefault(); toast('Drag this button onto your bookmarks bar. Clicking it here does nothing.'); } }, fv ? 'TJ Collect Finviz' : 'TJ Collect');
}
function collectHelp() {
  dialog({ title: 'Get the TJ Collect buttons', info: true, body: h('div', { style: { display: 'grid', gap: '12px' } },
    para('Drag a button onto your bookmarks bar (show the bar with Ctrl + Shift + B). Then click it on your scanner page and press Ctrl + V here.', ''),
    h('div', { class: 'sc-getbtn' }, h('div', null, h('b', null, 'TradingView'), para('On a TradingView screener: copies the scanner rows, every column you see, the name and the date.', 'note')), dragButton()),
    h('div', { class: 'sc-getbtn' }, h('div', null, h('b', null, 'Finviz'), para('On a Finviz screener: copies the 20 stocks of the page you see, with the columns of your view. Collect page 2, 3 … the same way: they join the same scan.', 'note')), dragButton(true)),
    para('If dragging does not work, right-click a button, choose Copy link, and paste it as the address of a new bookmark.', 'note')) });
}
function keysHelp() {
  const k = (key, what) => h('div', { class: 'sc-key' }, h('kbd', null, key), h('span', null, what));
  dialog({ title: 'Keys in Scans', info: true, body: h('div', { style: { display: 'grid', gap: '8px' } },
    k('↑ ↓', 'Move through the stocks (the chart follows)'), k('Enter', 'Open the stock in Finviz'), k('Ctrl + K', 'Quick jump to a scanner, list, status or stock'), k('Ctrl + V', 'Add a scan from TJ Collect'), k('Esc', 'Close a menu or window'), k('?', 'This list'),
    para('The keys work only on this tab and never while you type in a box.', 'note')) });
}

// ---------------------------------------------------------------- small pop-up menu (items: {label, fn, on, cls, color, head, right})
let MENU_EL = null;
function closeMenu() { MENU_EL?.remove(); MENU_EL = null; document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', escKey, true); window.removeEventListener('scroll', closeMenu, true); }
const outside = (e) => { if (MENU_EL && !MENU_EL.contains(e.target)) closeMenu(); };
const escKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } };
function popMenu(anchor, label, items) {
  closeMenu();
  MENU_EL = h('div', { class: 'sc-menu', role: 'menu', 'aria-label': label }, items.filter(Boolean).map((it) => it.head ? h('div', { class: 'sc-mhead2' }, it.head)
    : h('button', { type: 'button', role: 'menuitem', class: 'sc-mi ' + (it.cls || '') + (it.on ? ' on' : ''), disabled: !!it.disabled, onClick: (e) => { e.stopPropagation(); closeMenu(); it.fn(); } },
      h('span', null, it.color ? dot(it.color) : null, it.label), it.right ? h('span', { class: 'note' }, it.right) : null)));
  document.body.append(MENU_EL);
  const b = anchor.getBoundingClientRect(); const m = MENU_EL.getBoundingClientRect();
  const left = Math.max(8, Math.min(b.right - m.width, innerWidth - m.width - 8));
  const top = b.bottom + 4 + m.height > innerHeight - 8 ? Math.max(8, b.top - m.height - 4) : b.bottom + 4;
  Object.assign(MENU_EL.style, { left: left + 'px', top: top + 'px' });
  MENU_EL.querySelector('.sc-mi')?.focus();
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', escKey, true); window.addEventListener('scroll', closeMenu, true); }, 0);
}
// a menu with its own content (stock menu, Status ▾, Columns); keepPos = redraw it in the same place (pages inside one menu)
function openPop(anchor, label, build, keepPos = false) {
  const old = keepPos && MENU_EL ? { l: MENU_EL.style.left, t: MENU_EL.style.top } : null;
  closeMenu();
  MENU_EL = h('div', { class: 'sc-menu', role: 'menu', 'aria-label': label }); build(MENU_EL); document.body.append(MENU_EL);
  if (old && old.l) Object.assign(MENU_EL.style, { left: old.l, top: old.t, animation: 'none' });
  else { const b = anchor.getBoundingClientRect(); const m = MENU_EL.getBoundingClientRect();
    Object.assign(MENU_EL.style, { left: Math.max(8, Math.min(b.right - m.width, innerWidth - m.width - 8)) + 'px', top: (b.bottom + 4 + m.height > innerHeight - 8 ? Math.max(8, b.top - m.height - 4) : b.bottom + 4) + 'px' }); }
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', escKey, true); window.addEventListener('scroll', closeMenu, true); }, 0);
}

// ---------------------------------------------------------------- drag and drop (1.8.17: the same feel as the Open positions cards)
// Pointer based: the item lifts after a 5 px move, a placeholder keeps its place, neighbours slide (FLIP), the drop place follows
// the middle of the lifted item. Works across containers (a stock from one section to another). A short click still clicks.
const DRAG_PX = 5; const SLIDE = 'transform 220ms cubic-bezier(.2,.8,.2,1)';
let BLOCK_CLICK = false;
if (typeof document !== 'undefined') document.addEventListener('click', (e) => { if (BLOCK_CLICK) { e.stopPropagation(); e.preventDefault(); } }, true);
// el: what lifts. opts: { zones: () => [container elements], items: (zone) => [child elements], onDrop(zone, beforeEl) }
function draggable(el, handle, opts) {
  if (CTX?.readOnly) return;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input, select, a, textarea')) return;
    const d = { x0: e.clientX, y0: e.clientY, pid: e.pointerId, on: false };
    const slide = (zones, change) => {
      const kids = zones.flatMap((z) => opts.items(z)); const before = new Map(kids.map((k) => [k, k.getBoundingClientRect()]));
      change();
      for (const k of kids) { const a = before.get(k), b = k.getBoundingClientRect(); const dy = a.top - b.top; if (!dy) continue;
        k.style.transition = 'none'; k.style.transform = `translateY(${dy}px)`; requestAnimationFrame(() => requestAnimationFrame(() => { k.style.transition = SLIDE; k.style.transform = ''; })); }
    };
    const begin = (ev) => {
      const r = el.getBoundingClientRect(); d.on = true; d.dy = ev.clientY - r.top; d.dx = ev.clientX - r.left; d.h = r.height;
      d.ph = h('div', { class: 'sc-ph', style: { height: r.height + 'px' } }); el.parentNode.insertBefore(d.ph, el);
      Object.assign(el.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', zIndex: '1000', pointerEvents: 'none' });
      el.classList.add('sc-lifted'); document.body.append(el); document.body.classList.add('sc-dragging');
      if (HOST) HOST.style.pointerEvents = 'none';
    };
    const move = (ev) => {
      if (ev.pointerId !== d.pid) return;
      if (!d.on) { if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < DRAG_PX) return; begin(ev); }
      ev.preventDefault(); el.style.left = ev.clientX - d.dx + 'px'; el.style.top = ev.clientY - d.dy + 'px';
      const scroller = d.ph.closest('.sc-lis'); if (scroller) { const sr = scroller.getBoundingClientRect(); if (ev.clientY < sr.top + 30) scroller.scrollTop -= 12; else if (ev.clientY > sr.bottom - 30) scroller.scrollTop += 12; }
      const cy = ev.clientY - d.dy + d.h / 2; const zones = opts.zones();
      const zone = zones.find((z) => { const r = z.getBoundingClientRect(); return ev.clientX >= r.left - 20 && ev.clientX <= r.right + 20 && cy >= r.top - 6 && cy <= r.bottom + 6; });
      if (!zone) return;
      const items = opts.items(zone).filter((k) => k !== d.ph);
      // 1.8.17 fix (his test: drag jumped back and forth): use where a stock WILL be, not where it is while it slides
      const next = items.find((k) => { const r = k.getBoundingClientRect(); const ty = new DOMMatrixReadOnly(getComputedStyle(k).transform === 'none' ? undefined : getComputedStyle(k).transform).m42; return cy < r.top - ty + r.height / 2; }) || null;
      const end = zone.querySelector(':scope > .sc-dzend');
      const target = next || end;
      if ((target && d.ph.nextSibling === target && d.ph.parentNode === zone) || (!target && d.ph.parentNode === zone && !d.ph.nextSibling)) return;
      slide(zones, () => (target ? zone.insertBefore(d.ph, target) : zone.append(d.ph)));
    };
    const up = (ev) => {
      if (ev.pointerId !== d.pid) return;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (!d.on) return;
      BLOCK_CLICK = true; setTimeout(() => { BLOCK_CLICK = false; }, 0);
      const r = d.ph.getBoundingClientRect(); el.style.transition = 'left 180ms ease, top 180ms ease'; el.style.left = r.left + 'px'; el.style.top = r.top + 'px';
      setTimeout(() => {
        document.body.classList.remove('sc-dragging'); if (HOST) HOST.style.pointerEvents = '';
        if (!d.ph.isConnected || !d.ph.parentNode) { el.remove(); CTX?.redraw(); return; } // the screen was redrawn during the drag: drop nothing
        const zone = d.ph.parentNode; let next = d.ph.nextSibling; while (next && !opts.items(zone).includes(next)) next = next.nextSibling;
        el.remove(); opts.onDrop(zone, next);
      }, 190);
    };
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });
}

// ---------------------------------------------------------------- the top bar
// 1.8.17 (agreed 27-11-2026, preview https://claude.ai/artifact/LEKWP4zbRBctY8mAmCqDut): ⇤ · … · [Filter · Chart/Table · ⟳ Finviz]
// (shown when the mouse is on the bar, kept while they are in use) · Find · ⋯
function toolbar(ctx, st) {
  const nF = SC.filterCount(V.f);
  const q = h('input', { type: 'search', class: 'sc-q', value: V.f.q, placeholder: 'Find', 'aria-label': 'Find a ticker', 'data-keep': 'sc-q',
    onInput: (e) => { V.f = { ...V.f, q: e.target.value }; ctx.redraw(); const el = document.querySelector('[data-keep="sc-q"]'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } } });
  const hidden = menuHidden();
  const keep = V.fOpen || nF || V.view === 'table' || FETCHING;
  return h('div', { class: 'sc-tool' },
    h('button', { type: 'button', class: 'sc-ibtn', 'aria-label': hidden ? 'Show the program menu' : 'Hide the program menu', 'data-tip': hidden ? 'Show the program menu' : 'Hide the program menu for a bigger chart', onClick: () => { try { localStorage.setItem('tj-scans-nomenu', hidden ? '0' : '1'); } catch { /* fine */ } ctx.redraw(); } }, hidden ? '⇥' : '⇤'),
    h('span', { class: 'spacer' }),
    h('div', { class: 'sc-hovtools' + (keep ? ' keep' : '') },
      h('button', { type: 'button', class: 'btn sm sc-fbtn' + (V.fOpen || nF ? ' active' : ''), 'aria-expanded': String(V.fOpen), onClick: (e) => { e.stopPropagation(); toggleFilter(ctx, e.currentTarget); } }, nF ? `Filter · ${nF}` : 'Filter'),
      h('div', { class: 'seg sc-pages', role: 'group', 'aria-label': 'View' }, [['chart', 'Chart'], ['table', 'Table']].map(([k, l]) => h('button', { type: 'button', class: V.view === k ? 'on' : '', 'aria-pressed': String(V.view === k), onClick: () => { V.view = k; remember(); ctx.redraw(); } }, l))),
      h('button', { class: 'btn sm pri' + (FETCHING ? ' sc-busy' : ''), disabled: ctx.readOnly, 'data-tip': 'Get your Finviz Elite screeners', onClick: () => fvGetDialog(ctx) }, '⟳ Finviz')),
    q,
    h('button', { class: 'btn sm', 'aria-label': 'More', 'aria-haspopup': 'menu', 'data-tip': 'More', onClick: (e) => { e.stopPropagation(); popMenu(e.currentTarget, 'More', [
      { label: 'Get the newest scans', disabled: ctx.readOnly, fn: () => fvGetDialog(ctx) },
      { label: 'Paste a scan', right: 'Ctrl+V', disabled: ctx.readOnly, fn: () => pasteFromButton(ctx) },
      { label: 'Quick jump', right: 'Ctrl+K', fn: () => quickJump(ctx) },
      { label: 'Keyboard keys', right: '?', fn: () => keysHelp() },
      { label: 'TJ Collect buttons', cls: 'sep', fn: () => collectHelp() },
      V.tabs.join() !== TABS0.join() ? { label: 'Reset the tab order', cls: 'sep', fn: () => { V.tabs = [...TABS0]; remember(); ctx.redraw(); toast('The tabs are back in the first order.'); } } : null]); } }, '⋯'));
}

// ---------------------------------------------------------------- what the open tab shows (one scanner / comparison / list / status at a time)
const TABS0 = ['scans', 'compare', 'lists', 'status'];
const TABN = { scans: 'Scans', compare: 'Compare', lists: 'My lists', status: 'Status' };
const scannerNames = (st) => scanKeys(st).filter((k) => k.startsWith('S:')).map((k) => k.slice(2));
const shortName = (n) => (String(n).includes('-') ? String(n).split('-')[0].trim() : String(n)).slice(0, 14); // "W1-1M" → "W1" (his wish: short names in Compare)
function curScanner(st) { const L = scannerNames(st); return L.includes(V.pick.scans) ? V.pick.scans : L[0] || null; }
function curCompare(st) { const L = st.scans.compares || []; return L.find((c) => c.id === V.pick.compare) || L[0] || null; }
function curStatus(st) { const L = SC.statusesOf(st); return L.find((s) => s.id === V.pick.status) || L[0]; }
// the statuses the rows may have (Status ▾ hides some); null = all
function shownStatuses(st) { if (!V.stHide.size) return null; return new Set([...SC.statusesOf(st).map((s) => s.id), 'none'].filter((id) => !V.stHide.has(id))); }
// rows of one section after New / Dropped, the comparison part, Rejected hiding and the filter
function sectionRows(st, s, v) {
  let base = v.rows;
  if (s.kind === 'scanner' || s.kind === 'compare') {
    if (s.kind === 'compare') base = SC.quickRows(v, V.part[s.cmp.id] || 'inall');
    if (V.q === 'new' && v.hasNewDrop) base = base.filter((r) => r.isNew);
    if (V.q === 'dropped') base = v.hasNewDrop ? v.dropped.map((r) => ({ ...r, isDropped: true })) : [];
  }
  let rej = 0;
  if (s.kind !== 'status' && !V.showRej[s.key]) { const keep = base.filter((r) => !r.rej); rej = base.length - keep.length; base = keep; }
  const stShow = s.kind === 'status' ? null : shownStatuses(st);
  const fr = SC.applyFilter(base, V.f, { cols: v.cols, statuses: stShow, statusOf: (r) => r.mark?.st || 'none' });
  return { rows: fr.rows, rej, noData: fr.noData, total: base.length };
}
// the sections of the open tab: one for Scans / Compare / Status, one per section of the open list
function sectionsOf(st) {
  const sc = st.scans;
  if (V.tab === 'scans') { const n = curScanner(st); return n ? [{ key: 'S:' + n, kind: 'scanner', name: n, title: n, src: { kind: 'scanner', name: n, run: V.day['S:' + n] }, open: true }] : []; }
  if (V.tab === 'compare') { const c = curCompare(st); return c ? [{ key: 'C:' + c.id, kind: 'compare', title: c.name, cmp: c, src: { kind: 'compare', id: c.id, date: V.day['C:' + c.id] }, open: true }] : []; }
  if (V.tab === 'lists') { const f = currentList(st); if (!f) return []; return sc.lists.filter((l) => l.folder === f.id).map((l) => ({ key: 'L:' + l.id, kind: 'list', title: l.name, list: l, src: { kind: 'list', id: l.id }, open: !folded(st, 'L:' + l.id) })); }
  const s = curStatus(st); return [{ key: 'T:' + s.id, kind: 'status', title: s.name, status: s, src: { kind: 'status', id: s.id }, open: true }];
}

// ---------------------------------------------------------------- page
export function render(ctx) {
  CTX = ctx; const st = ctx.store.state; const today = ctx.today(); const sc = st.scans;
  restore();
  for (const id of [...V.stHide]) if (id !== 'none' && !SC.statusOf(st, id)) V.stHide.delete(id);
  document.body.classList.toggle('tj-nomenu', menuHidden());
  const anything = sc.runs.length || (sc.lists || []).length || (sc.folders || []).length || Object.keys(sc.marks || {}).length;
  if (!anything) return h('div', { class: 'scans' }, h('header', { class: 'pg-head sc-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'Trade'), h('h1', null, 'Scans')),
    h('div', { class: 'sc-headbtns' }, h('button', { class: 'btn sm', onClick: () => keysHelp() }, 'Keys ?'))), emptyState(ctx));
  const secs = sectionsOf(st); const flat = []; const built = []; let total = 0;
  for (const s of secs) {
    const v = SC.sourceView(st, s.src, today); s.v = v;
    if (!s.open) { built.push({ s, rows: [], rej: 0, noData: 0, total: v.rows.length }); continue; }
    const x = sectionRows(st, s, v); built.push({ s, ...x }); total += x.total;
    for (const r of x.rows) flat.push({ r, key: s.key, s });
  }
  let cur = flat.find((x) => x.key === V.sel?.key && x.r.t === V.sel?.t) || (V.sel?.t ? flat.find((x) => x.r.t === V.sel.t) : null) || flat.find((x) => x.key === V.sel?.key) || flat[0] || null;
  if (cur) V.sel = { t: cur.r.t, key: cur.key };
  LAST = { rows: flat, focus: cur, shown: new Set(flat.map((x) => x.r.t)).size, total, built };
  const info = tradeInfo(st);
  const main = V.view === 'table' ? tablePanel(ctx, st, built, cur, info, today) : [chartPanel(ctx, st, cur, info, today), resizer(), panel(ctx, st, built, flat, info, today)];
  if (V.view === 'chart' && cur) setTimeout(() => showChart(cur.r.full && cur.r.full.includes(':') ? cur.r.full : cur.r.t), 0); else setTimeout(placeChart, 0);
  setTimeout(() => { placeChart(); document.querySelector('.sc-li.on')?.scrollIntoView({ block: 'nearest' }); if (FPOP) fillFilter(ctx); }, 0);
  remember();
  return h('div', { class: 'scans full' }, toolbar(ctx, st),
    h('div', { class: 'sc-body ' + V.view + (V.focus && V.view === 'chart' ? ' focus' : '') }, main));
}

// ---------------------------------------------------------------- remembered per computer (his wish: TJ opens where he was; never in his data file)
const PLACE_KEY = 'tj-scans-place'; let RESTORED = false;
function restore() {
  if (RESTORED) return; RESTORED = true;
  try { const o = JSON.parse(localStorage.getItem(PLACE_KEY) || 'null'); if (!o) return;
    if (TABS0.includes(o.tab)) V.tab = o.tab; if (Array.isArray(o.tabs) && o.tabs.length === 4 && TABS0.every((k) => o.tabs.includes(k))) V.tabs = o.tabs;
    if (o.view === 'chart' || o.view === 'table') V.view = o.view; if (o.pick && typeof o.pick === 'object') V.pick = { ...V.pick, ...o.pick };
    if (typeof o.pw === 'number') V.pw = o.pw; V.focus = !!o.focus; if (o.sel && typeof o.sel.t === 'string') V.sel = o.sel;
  } catch { /* fine */ }
}
function remember() { try { localStorage.setItem(PLACE_KEY, JSON.stringify({ tab: V.tab, tabs: V.tabs, view: V.view, pick: V.pick, pw: V.pw, focus: V.focus, sel: V.sel })); } catch { /* fine */ } }

// ---------------------------------------------------------------- panel width (drag the line between the chart and the list; his wish, v2 #1)
function resizer() {
  return h('div', { class: 'sc-rsz', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Change the width of the list', 'data-tip': 'Drag to change the width',
    onPointerdown: (e) => {
      e.preventDefault(); const sx = e.clientX; const w0 = V.pw; const body = e.currentTarget.parentElement; const bar = e.currentTarget; bar.classList.add('go');
      const max = Math.round(body.getBoundingClientRect().width * 0.6);
      const mv = (ev) => { V.pw = Math.max(300, Math.min(max, w0 + (sx - ev.clientX))); const p = body.querySelector('.sc-panel'); if (p) p.style.flexBasis = V.pw + 'px'; placeChart(); };
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); document.body.style.cursor = ''; bar.classList.remove('go'); remember(); placeChart(); };
      document.body.style.cursor = 'col-resize'; addEventListener('pointermove', mv); addEventListener('pointerup', up);
    } });
}

// ---------------------------------------------------------------- the stock panel: tabs, the same head everywhere, the stocks
const LOCAL_FOLD = {}; // read-only window: folding works on screen only
function fold(ctx, key, isFolded) { if (ctx.readOnly) LOCAL_FOLD[key] = isFolded; else ctx.act((d) => A.setScanFold(d, key, isFolded), { label: 'fold', noUndo: true }); ctx.redraw(); }
function tabsBar(ctx) {
  const bar = h('div', { class: 'sc-tabs', role: 'tablist', 'aria-label': 'What to show' });
  for (const k of V.tabs) {
    const b = h('button', { type: 'button', role: 'tab', class: V.tab === k ? 'on' : '', 'aria-selected': String(V.tab === k), 'data-k': k }, TABN[k]);
    b.addEventListener('pointerdown', (e) => tabDrag(ctx, e, b, bar));
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTab(ctx, k); } });
    bar.append(b);
  }
  return bar;
}
function openTab(ctx, k) { if (V.tab === k) return; V.tab = k; if (k === 'lists' || k === 'status') V.q = 'all'; V.ticked = new Set(); V.sel = null; remember(); ctx.redraw(); }
// click opens the tab; dragging it sideways moves it (his wish: the tabs can be moved; ⋯ → Reset the tab order)
function tabDrag(ctx, e, b, bar) {
  if (e.button !== 0) return;
  const sx = e.clientX; let on = false; const tabs = [...bar.querySelectorAll('button')]; const w = b.getBoundingClientRect().width; const i0 = tabs.indexOf(b); let to = i0;
  const move = (ev) => {
    const dx = ev.clientX - sx;
    if (!on) { if (Math.abs(dx) < 6) return; on = true; b.classList.add('lift'); }
    const lim = Math.max(-i0 * w, Math.min((tabs.length - 1 - i0) * w, dx)); b.style.transform = `translateX(${lim}px)`; to = Math.round(i0 + lim / w);
    tabs.forEach((t, i) => { if (t === b) return; let s = 0; if (i0 < to && i > i0 && i <= to) s = -w; if (i0 > to && i < i0 && i >= to) s = w; t.style.transform = s ? `translateX(${s}px)` : ''; });
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    if (!on) return openTab(ctx, b.dataset.k);
    const k = V.tabs.splice(i0, 1)[0]; V.tabs.splice(to, 0, k); remember(); ctx.redraw();
    if (to !== i0) toast(`Moved ${TABN[k]}. You can reset the order in ⋯.`);
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}
// [Name ▾ + count line] [day ▾] [↺ Sort by RS] … ✎ 🗑 +  (the icons show when the mouse is on the head)
function pickHead(ctx, st, built) {
  const ro = ctx.readOnly; const b = built[0]; const v = b?.s.v;
  const pick = (label, items, curId, onPick, tip, extra) => h('button', { type: 'button', class: 'sc-pick', 'aria-haspopup': 'menu', 'data-tip': tip,
    onClick: (e) => { e.stopPropagation(); popMenu(e.currentTarget, tip, [...items.map((x) => ({ label: x.name, color: x.color, right: x.n != null ? String(x.n) : '', on: x.id === curId, fn: () => onPick(x.id) })), ...(extra || [])]); } },
    h('span', { class: 'sc-pickn' }, label), h('span', { class: 'sc-car', 'aria-hidden': 'true' }, '▾'));
  const icon = (sym, tip, fn, cls = '') => (ro ? null : h('button', { type: 'button', class: 'sc-hi ' + cls, 'aria-label': tip, 'data-tip': tip, onClick: (e) => { e.stopPropagation(); fn(e.currentTarget); } }, sym));
  const n = LAST.shown;
  const cnt = h('span', { class: 'sc-cnum', 'data-tip': 'Stocks shown' }, `${n} stock${n === 1 ? '' : 's'}`);
  let left; let day = null; let reset = null; let icons = [];
  if (V.tab === 'scans') {
    const name = curScanner(st);
    left = pick(name, scannerNames(st).map((x) => ({ id: x, name: x, n: SC.scannerRuns(st, x)[0]?.rows.length ?? 0 })), name, (x) => { V.pick.scans = x; V.q = 'all'; V.sel = null; remember(); ctx.redraw(); }, 'Choose the scanner');
    if (v?.picker) day = dayButton(v.picker, (x) => { V.day['S:' + name] = x; V.q = 'all'; ctx.redraw(); }, 'Scan day');
    if (v?.own && !ro) reset = h('button', { type: 'button', class: 'sc-reset', 'data-tip': 'Back to the normal order (by RS)', onClick: () => { const r = ctx.act((d) => A.setScannerOwnOrder(d, name, null), { label: 'sort ' + name + ' by RS', now: true }); if (!r.ok) toast(r.error); ctx.redraw(); } }, '↺ Sort by RS');
    icons = [icon('✎', 'Rename', (el) => renameInline(ctx, el, name, (d, x) => A.renameScanner(d, name, x), (x) => { V.pick.scans = x; if (V.day['S:' + name]) { V.day['S:' + x] = V.day['S:' + name]; delete V.day['S:' + name]; } })),
      icon('🗑', 'Delete', (el) => popMenu(el, 'Delete', [v?.run ? { label: `Delete this day (${SC.runLabel(st, v.run, ctx.today())})…`, cls: 'rej', fn: () => deleteRunDialog(ctx, v.run) } : null, { label: 'Delete the scanner…', cls: 'rej', fn: () => deleteScannerDialog(ctx, name) }]), 'del'),
      icon('+', 'Add', (el) => addMenu(ctx, el))];
  } else if (V.tab === 'compare') {
    const c = curCompare(st);
    left = pick(c.name, (st.scans.compares || []).map((x) => ({ id: x.id, name: x.name })), c.id, (x) => { V.pick.compare = x; V.q = 'all'; V.sel = null; remember(); ctx.redraw(); }, 'Choose the comparison');
    if (v?.picker) day = dayButton(v.picker, (x) => { V.day['C:' + c.id] = x; V.q = 'all'; ctx.redraw(); }, 'Each scanner’s newest scan on or before this day');
    icons = [icon('✎', 'Change', () => compareDialog(ctx, c)), icon('🗑', 'Delete', () => deleteCompareDialog(ctx, c), 'del'), icon('+', 'New comparison', () => compareDialog(ctx, null))];
  } else if (V.tab === 'lists') {
    const f = currentList(st); const secs = st.scans.lists.filter((l) => l.folder === f.id);
    left = pick(f.name, st.scans.folders.map((x) => ({ id: x.id, name: x.name, n: new Set(st.scans.lists.filter((l) => l.folder === x.id).flatMap((l) => l.items.map((y) => y.t))).size })), f.id,
      (x) => { V.list = x; try { localStorage.setItem('tj-scans-list', x); } catch { /* fine */ } V.sel = null; ctx.redraw(); }, 'Choose the list',
      [ro ? null : { label: '+ New list', cls: 'sep', fn: () => newListDialog(ctx) }, { label: 'Download for TradingView', cls: ro ? 'sep' : '', disabled: !secs.some((l) => l.items.length), fn: () => downloadSections(ctx, f.name, secs) }]);
    icons = [icon('✎', 'Rename', (el) => renameInline(ctx, el, f.name, (d, x) => A.renameScanFolder(d, f.id, x))), icon('🗑', 'Delete', () => deleteFolderDialog(ctx, f, secs), 'del'),
      icon('+', 'New section or list', (el) => popMenu(el, 'Add', [{ label: 'New section', fn: () => newSectionDialog(ctx, null, null, f.id) }, { label: 'New list', fn: () => newListDialog(ctx) }]))];
  } else {
    const s = curStatus(st);
    const counts = {}; for (const m of Object.values(st.scans.marks || {})) counts[m.st] = (counts[m.st] || 0) + 1;
    left = pick(h('span', { class: 'sc-stname c-' + s.color }, dot(s.color), s.name), SC.statusesOf(st).map((x) => ({ id: x.id, name: x.name, color: x.color, n: counts[x.id] || 0 })), s.id, (x) => { V.pick.status = x; V.sel = null; remember(); ctx.redraw(); }, 'Choose the status');
    icons = [icon('●', 'Colour', (el) => popMenu(el, 'Colour', STATUS_COLORS.map((c) => ({ label: COLOR_NAME[c], color: c, on: s.color === c, fn: () => { const r = ctx.act((d) => A.setStatusColor(d, s.id, c), { label: 'colour', now: true }); if (!r.ok) toast(r.error); ctx.redraw(); } }))), 'col c-' + s.color),
      icon('✎', 'Rename', (el) => renameInline(ctx, el, s.name, (d, x) => A.renameStatus(d, s.id, x))), s.rej ? null : icon('🗑', 'Delete', () => deleteStatusDialog(ctx, s), 'del'), icon('+', 'New status', () => newStatusDialog(ctx))];
  }
  // the count line: N stocks · N new · N dropped (a click shows only those; again shows all)
  const cap = h('div', { class: 'sc-cap' }, cnt);
  if ((V.tab === 'scans' || V.tab === 'compare') && v?.hasNewDrop) {
    const base = V.tab === 'compare' ? SC.quickRows(v, V.part[b.s.cmp.id] || 'inall') : v.rows;
    const nNew = base.filter((r) => r.isNew && !r.rej).length; const nDrop = v.dropped.length;
    const cl = (k, text, tip) => h('button', { type: 'button', class: 'sc-cl' + (V.q === k ? ' on' : ''), 'aria-pressed': String(V.q === k), 'data-tip': tip, onClick: () => { V.q = V.q === k ? 'all' : k; ctx.redraw(); } }, text);
    cap.append(' · ', cl('new', `${nNew} new`, 'Show only the stocks that are new in this scan'), ' · ', cl('dropped', `${nDrop} dropped`, 'Stocks that left since the scan before'));
  }
  return h('div', { class: 'sc-phead2' }, h('div', { class: 'sc-pk' }, left, cap), day, reset, h('span', { class: 'spacer' }), h('span', { class: 'sc-hov' }, icons));
}
function dayButton(picker, onPick, tip) {
  const cur = picker.options.find((o) => o.value === picker.value) || picker.options[0];
  const lab = (o) => o.label.replace(/ · \d+$/, '').replace(/^today/, 'Today');
  if (picker.options.length < 2) return h('span', { class: 'sc-day1', 'data-tip': tip }, lab(cur));
  return h('button', { type: 'button', class: 'sc-dayb', 'aria-haspopup': 'menu', 'data-tip': tip, onClick: (e) => { e.stopPropagation(); popMenu(e.currentTarget, tip, [{ head: 'Scan day' }, ...picker.options.map((o) => ({ label: lab(o), on: o.value === picker.value, fn: () => onPick(o.value) }))]); } }, lab(cur), h('span', { class: 'sc-car', 'aria-hidden': 'true' }, '▾'));
}
// ✎ turns the name into a box: Enter saves, Esc or a click outside without change cancels
function renameInline(ctx, btn, cur, act, after) {
  const head = btn.closest('.sc-phead2'); const pk = head?.querySelector('.sc-pick'); if (!pk) return;
  const inp = h('input', { class: 'sc-rnm', value: cur, maxlength: '60', 'aria-label': 'New name' }); let done = false;
  const finish = (save) => { if (done) return; done = true; const x = inp.value.trim();
    if (save && x && x !== cur) { const r = ctx.act((d) => act(d, x), { label: 'rename ' + cur, now: true }); if (!r.ok) { toast(r.error); ctx.redraw(); return; } after?.(x); ctx.redraw(); toast(`Renamed to ${x}.`, 'Undo', () => ctx.store.undo()); } else ctx.redraw(); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
  inp.addEventListener('blur', () => finish(true));
  pk.replaceWith(inp); inp.focus(); inp.select();
}
function panel(ctx, st, built, flat, info, today) {
  const ro = ctx.readOnly;
  const p = h('section', { class: 'card sc-list sc-panel', style: { flexBasis: V.pw + 'px' } }, tabsBar(ctx));
  const empty = (b1, b2) => h('div', { class: 'empty' }, h('b', null, b1), h('span', null, b2));
  if (V.tab === 'compare' && !built.length) { p.append(h('div', { class: 'sc-phead2' }, h('span', { class: 'spacer' }), ro ? null : h('button', { type: 'button', class: 'sc-hi', 'aria-label': 'New comparison', 'data-tip': 'New comparison', onClick: () => compareDialog(ctx, null) }, '+')), empty('No comparisons yet', SC.runsByScanner(st).length >= 2 ? 'Click + to compare 2 or more scanners.' : 'You need scans from 2 scanners first.')); return p; }
  if (V.tab === 'scans' && !built.length) { p.append(h('div', { class: 'sc-phead2' }, h('span', { class: 'spacer' }), ro ? null : h('button', { type: 'button', class: 'sc-hi', 'aria-label': 'Add', 'data-tip': 'Add', onClick: (e) => addMenu(ctx, e.currentTarget) }, '+')), empty('No scanners yet', 'Click ⟳ Finviz, or paste a scan with Ctrl + V.')); return p; }
  if (V.tab === 'lists' && !currentList(st)) { p.append(h('div', { class: 'sc-phead2' }, h('span', { class: 'spacer' }), ro ? null : h('button', { type: 'button', class: 'sc-hi', 'aria-label': 'New list', 'data-tip': 'New list', onClick: () => newListDialog(ctx) }, '+')), empty('No lists yet', 'Click + to make your first list and its sections.')); return p; }
  p.append(pickHead(ctx, st, built));
  // Status ▾ · Select · Finviz ↗ (shown when the mouse is on the head; kept while Select is on or some statuses are hidden)
  const ticked = flat.filter((x) => V.ticked.has(x.r.t)).map((x) => x.r.t);
  const tickers = SC.finvizTickers(V.selMode ? ticked : flat.map((x) => x.r.t));
  const nHid = V.stHide.size; const nAll = SC.statusesOf(st).length + 1;
  p.append(h('div', { class: 'sc-subrow' + (V.selMode || nHid ? ' keep' : '') }, h('span', { class: 'spacer' }),
    V.tab !== 'status' ? h('button', { type: 'button', class: 'sc-qp' + (nHid ? ' on' : ''), 'aria-haspopup': 'menu', 'data-tip': 'Show stocks by status', onClick: (e) => { e.stopPropagation(); statusShowMenu(ctx, e.currentTarget); } }, nHid ? `Status · ${nAll - nHid} of ${nAll}` : 'Status', h('span', { class: 'sc-car', 'aria-hidden': 'true' }, '▾')) : null,
    h('button', { type: 'button', class: 'sc-qp' + (V.selMode ? ' on' : ''), 'data-tip': 'Tick stocks to open only those in Finviz', onClick: () => { V.selMode = !V.selMode; V.ticked = new Set(); ctx.redraw(); } }, V.selMode ? 'Done' : 'Select'),
    tickers.length ? h('a', { class: 'sc-qp', href: SC.finvizListUrl(tickers), target: '_blank', rel: 'noopener', 'data-tip': V.selMode ? 'Open only the ticked stocks in Finviz' : `Open the ${plural(tickers.length, 'stock')} shown in Finviz` }, 'Finviz' + (V.selMode ? ' ' + tickers.length : '') + ' ↗')
      : h('button', { type: 'button', class: 'sc-qp', disabled: true, 'data-tip': V.selMode ? 'Tick some stocks first' : 'No stocks shown' }, 'Finviz ↗')));
  if (V.selMode) p.append(selectBar(ctx, st, flat));
  const chips = chipRow(ctx, st); if (chips) p.append(chips);
  const b0 = built[0];
  if (V.tab === 'compare' && b0) {
    const v = b0.s.v; const N = v.N || 0;
    if (v.missing?.length && N < 2) p.append(h('div', { class: 'note sc-sub' }, 'No scans yet for: ' + v.missing.join(', ')));
    else { const pb = (k, label) => (k === 'some' && N < 3) ? null : h('button', { type: 'button', class: (V.part[b0.s.cmp.id] || 'inall') === k ? 'on' : '', 'aria-pressed': String((V.part[b0.s.cmp.id] || 'inall') === k), onClick: () => { V.part[b0.s.cmp.id] = k; ctx.redraw(); } }, label, h('span', { class: 'sc-n' }, SC.quickRows(v, k).filter((r) => !r.rej).length));
      p.append(h('div', { class: 'sc-parts2' }, pb('inall', 'In all'), pb('some', 'In some'), pb('one', 'Only one'))); }
  }
  const secs = h('div', { class: 'sc-lis sc-secs', role: 'listbox', 'aria-label': 'Stocks' });
  if (V.tab === 'lists') for (const b of built) secs.append(listBlock(ctx, st, b, info, secs));
  else for (const b of built) secs.append(stockZone(ctx, st, b, info));
  p.append(secs);
  return p;
}
// one scanner / comparison / status: its stocks (a scanner's stocks can be dragged into his own order, A4)
function stockZone(ctx, st, b, info) {
  const s = b.s; const v = s.v;
  const zone = h('div', { class: 'sc-dz', 'data-kind': s.kind, 'data-id': s.key });
  for (const r of b.rows) zone.append(stockRow(ctx, st, r, s, info, zone));
  if (!b.rows.length) zone.append(h('div', { class: 'note sc-none' }, b.total ? 'No stock matches your filter.' : V.q === 'new' ? 'No new stocks.' : V.q === 'dropped' ? 'Nothing dropped.' : 'No stocks.'));
  if (b.noData) zone.append(h('div', { class: 'note sc-none' }, `${plural(b.noData, 'stock')} ${b.noData === 1 ? 'has' : 'have'} no data for this filter.`));
  if (b.rej || V.showRej[s.key]) zone.append(h('button', { type: 'button', class: 'sc-rejline', onClick: () => { V.showRej[s.key] = !V.showRej[s.key]; ctx.redraw(); } }, V.showRej[s.key] ? 'Hide rejected' : `${b.rej} rejected hidden`));
  zone.append(h('div', { class: 'sc-dzend' }));
  void v; return zone;
}
// a section of the open list: quiet capital head (fold, name, count, ⋯), dragged by its head; stocks dragged in and between sections
function listBlock(ctx, st, b, info, secsEl) {
  const s = b.s; const v = s.v; const ro = ctx.readOnly;
  const count = v.rows.filter((r) => !r.rej).length;
  const toggle = () => fold(ctx, s.key, s.open);
  const head = h('div', { class: 'sc-sec2', onClick: (e) => { if (!e.target.closest('button, select, input')) toggle(); } },
    h('button', { type: 'button', class: 'sc-fold', 'aria-expanded': String(s.open), 'aria-label': (s.open ? 'Fold ' : 'Open ') + s.title, onClick: toggle }, s.open ? '▾' : '▸'),
    h('b', { class: 'sc-sect' }, s.title), h('span', { class: 'sc-cnt', 'data-tip': 'Stocks in this section' }, String(count)), h('span', { class: 'spacer' }),
    ro ? null : h('button', { type: 'button', class: 'sc-more', 'aria-label': 'More for ' + s.title, 'data-tip': 'More', onClick: (e) => { e.stopPropagation(); sectionMenu(ctx, st, s, e.currentTarget); } }, '⋯'));
  const el = h('div', { class: 'sc-block', 'data-key': s.key }, head);
  draggable(el, head, { zones: () => [secsEl], items: (z) => [...z.querySelectorAll(':scope > .sc-block, :scope > .sc-ph')],
    onDrop: (zone, next) => { const r = ctx.act((d) => A.placeSection(d, s.list.id, s.list.folder, next?.dataset.key?.slice(2) || null), { label: 'move section', now: true }); if (!r.ok) toast(r.error); ctx.redraw(); } });
  if (!s.open) return el;
  const zone = h('div', { class: 'sc-dz', 'data-kind': 'list', 'data-id': s.list.id });
  for (const r of b.rows) zone.append(stockRow(ctx, st, r, s, info, zone));
  if (!b.rows.length) zone.append(h('div', { class: 'note sc-none' }, b.total ? 'No stock matches your filter.' : 'No stocks yet.'));
  if (b.noData) zone.append(h('div', { class: 'note sc-none' }, `${plural(b.noData, 'stock')} ${b.noData === 1 ? 'has' : 'have'} no data for this filter.`));
  if (b.rej || V.showRej[s.key]) zone.append(h('button', { type: 'button', class: 'sc-rejline', onClick: () => { V.showRej[s.key] = !V.showRej[s.key]; ctx.redraw(); } }, V.showRej[s.key] ? 'Hide rejected' : `${b.rej} rejected hidden`));
  zone.append(h('div', { class: 'sc-dzend' }, ro ? null : h('input', { class: 'sc-addin', placeholder: '+ Add ticker (e.g. NVDA, AAPL)', 'aria-label': 'Add tickers to ' + s.title, onKeydown: (e) => { if (e.key !== 'Enter') return; addTyped(ctx, s.list, e.target.value); } })));
  el.append(zone);
  return el;
}
function addTyped(ctx, l, text) {
  const raw = String(text).toUpperCase().split(/[\s,;]+/).filter(Boolean); const good = raw.filter((t) => SC.validSymbol(t)); const bad = raw.filter((t) => !SC.validSymbol(t));
  if (!good.length) return toast(bad.length ? `Not a ticker: ${bad.slice(0, 5).join(', ')}` : 'Type a ticker, for example NVDA.');
  const r = ctx.act((d) => A.addToScanList(d, l.id, good.map((t) => ({ t, full: SC.fullOf(ctx.store.state, SC.tickerOf(t)) || t })), { date: ctx.today() }), { label: 'add to ' + l.name, now: true });
  if (!r.ok) return toast(r.error);
  ctx.redraw(); setTimeout(() => document.querySelector(`.sc-dz[data-id="${l.id}"] .sc-addin`)?.focus(), 0);
  toast((r.data.added ? `${plural(r.data.added, 'stock')} added to ${l.name}.` : `Already in ${l.name}.`) + (bad.length ? ` Not tickers: ${bad.slice(0, 5).join(', ')}.` : ''), 'Undo', () => ctx.store.undo());
}
// one stock: status line · ticker · tags · (status word and ▼ when the mouse is on it) · RS
function stockRow(ctx, st, r, s, info, zone) {
  const m = r.mark; const ss = m ? SC.statusOf(st, m.st) : null; const x = info.get(r.t);
  const on = V.sel?.key === s.key && V.sel?.t === r.t; const v = s.v;
  let inTag = null;
  if (s.kind === 'compare' && r.hits && (V.part[s.cmp.id] || 'inall') !== 'inall') { const names = v.runs.filter((_, i) => r.hits[i]).map((y) => y.scanner); inTag = h('span', { class: 'sc-tag in', 'data-tip': 'In ' + names.join(', ') }, names.map(shortName).join(' · ')); }
  const el = h('div', { class: 'sc-li sc-row1' + (on ? ' on' : '') + (r.rej ? ' rej' : ''), role: 'option', 'aria-selected': String(on), 'data-t': r.t,
    onClick: (e) => { if (e.target.closest('input')) return; if (V.selMode) { tick(ctx, r.t); return; } V.sel = { t: r.t, key: s.key }; remember(); ctx.redraw(); } },
    V.selMode ? h('input', { type: 'checkbox', class: 'sc-ck', 'aria-label': 'Tick ' + r.t, checked: V.ticked.has(r.t), onClick: (e) => e.stopPropagation(), onChange: () => tick(ctx, r.t) }) : null,
    h('span', { class: 'sc-flag c-' + (ss ? ss.color : 'none'), 'data-tip': ss ? 'Status: ' + ss.name : null }),
    h('b', { class: 'sc-tkr' }, r.t), inTag,
    r.isNew ? h('span', { class: 'sc-tag new', 'data-tip': 'New in this scan' }, 'New') : null, r.isDropped ? h('span', { class: 'sc-tag drop', 'data-tip': 'Left since the scan before' }, 'Dropped') : null,
    x?.open ? h('span', { class: 'sc-tag open', 'data-tip': 'You hold this stock now' }, '●') : null,
    r.earnings && r.earnings.days >= 0 && r.earnings.days <= 7 ? h('span', { class: 'sc-tag earn', 'data-tip': `Earnings in ${r.earnings.days} days (${dmy(r.earnings.iso)})` }, `E ${r.earnings.days}d`) : null,
    h('span', { class: 'sc-sp' }),
    ss && s.kind !== 'status' ? h('span', { class: 'sc-stw c-' + ss.color }, ss.name) : null,
    h('span', { class: 'sc-lirs' + (r.rs !== null && r.rs >= 80 ? ' sc-strong' : ''), 'data-tip': 'RS: strength vs the market (1–99)' }, r.rs ?? '–'),
    h('button', { type: 'button', class: 'sc-dd', 'aria-haspopup': 'menu', 'aria-label': `Status and lists of ${r.t}`, 'data-tip': 'Status and lists', disabled: ctx.readOnly, onClick: (e) => { e.stopPropagation(); V.sel = { t: r.t, key: s.key }; stockMenu(ctx, [r], e.currentTarget, s); } }, '▼'));
  if (V.selMode || ctx.readOnly) return el;
  if (s.kind === 'list') draggable(el, el, { zones: () => [...document.querySelectorAll('.sc-dz[data-kind="list"]')], items: (z) => [...z.querySelectorAll(':scope > .sc-li, :scope > .sc-ph')],
    onDrop: (zn, next) => { const to = zn.dataset.id; const res = ctx.act((d) => A.placeScanItem(d, s.list.id, to, r.t, next?.dataset.t || null, { date: ctx.today() }), { label: 'move ' + r.t, now: true }); if (!res.ok) toast(res.error); ctx.redraw(); } });
  if (s.kind === 'scanner' && !r.isDropped && !r.rej) draggable(el, el, { zones: () => [zone], items: (z) => [...z.querySelectorAll(':scope > .sc-li, :scope > .sc-ph')],
    onDrop: (zn, next) => {
      // his own order (A4): every stock of this scan in the new order; the ones the filter hides keep their place
      const now = v.rows.filter((y) => !y.rej).map((y) => y.t); const all = now.filter((t) => t !== r.t);
      const at = next?.dataset.t ? all.indexOf(next.dataset.t) : -1; all.splice(at < 0 ? all.length : at, 0, r.t);
      if (all.join() === now.join()) { ctx.redraw(); return; } // dropped back in its place: nothing saved, the RS order stays (review 28-11-2026)
      const res = ctx.act((d) => A.setScannerOwnOrder(d, s.name, all), { label: 'move ' + r.t, now: true }); if (!res.ok) toast(res.error); ctx.redraw();
    } });
  return el;
}
function tick(ctx, t) { if (V.ticked.has(t)) V.ticked.delete(t); else V.ticked.add(t); ctx.redraw(); }
function selectBar(ctx, st, flat) {
  const n = V.ticked.size; const rows = []; const seen = new Set(); for (const x of flat) if (V.ticked.has(x.r.t) && !seen.has(x.r.t)) { seen.add(x.r.t); rows.push(x.r); }
  return h('div', { class: 'sc-actbar sel' }, h('b', null, `${n} ticked`),
    h('button', { class: 'btn sm', disabled: !n || ctx.readOnly, onClick: (e) => { e.stopPropagation(); stockMenu(ctx, rows, e.currentTarget, null, () => { V.ticked = new Set(); }); } }, 'Status / list ▾'),
    h('button', { class: 'linkish', onClick: () => { V.ticked = new Set(flat.map((x) => x.r.t)); ctx.redraw(); } }, `Tick all ${new Set(flat.map((x) => x.r.t)).size}`),
    n ? h('button', { class: 'linkish', onClick: () => { V.ticked = new Set(); ctx.redraw(); } }, 'Clear') : null);
}
// Status ▾ (show by status): one click shows or hides a status; Rejected stays hidden in scans and lists unless shown
function statusShowMenu(ctx, anchor) {
  const st = ctx.store.state;
  openPop(anchor, 'Show by status', (m) => {
    m.classList.add('sc-smenu');
    m.append(h('div', { class: 'sc-smh' }, h('b', null, 'Show'), h('span', { class: 'spacer' }), V.stHide.size ? h('button', { type: 'button', class: 'linkish', onClick: () => { V.stHide.clear(); ctx.redraw(); statusShowMenu(ctx, document.querySelector('.sc-subrow .sc-qp') || anchor); } }, 'Show all') : null));
    m.append(h('div', { class: 'sc-pills' }, [...SC.statusesOf(st).map((x) => [x.id, x.name, x.color]), ['none', 'No status', 'none']].map(([id, n, col]) => {
      const on = !V.stHide.has(id);
      return h('button', { type: 'button', class: 'sc-pill c-' + col + (on ? ' on' : ''), 'aria-pressed': String(on), onClick: () => { if (on) V.stHide.add(id); else V.stHide.delete(id); ctx.redraw(); statusShowMenu(ctx, document.querySelector('.sc-subrow .sc-qp') || anchor); } }, id !== 'none' ? dot(col) : null, n);
    })));
    m.append(h('div', { class: 'note sc-mnote' }, 'Rejected stays hidden in scans and lists unless you show it.'));
  }, true);
}

// ---------------------------------------------------------------- + and ⋯ menus
function addMenu(ctx, anchor) {
  return popMenu(anchor, 'Add', [
    { label: 'Get scans from Finviz', right: '⟳ Finviz', fn: () => fvGetDialog(ctx) },
    { label: 'Paste a scan', right: 'Ctrl+V', fn: () => pasteFromButton(ctx) }]);
}
function sectionMenu(ctx, st, s, anchor) {
  const l = s.list; const stale = A.staleInList(st, l); return popMenu(anchor, s.title, [
    { label: 'Rename', fn: () => nameDialog(ctx, `Rename ${l.name}`, l.name, (d, x) => A.renameScanList(d, l.id, x)) },
    stale.length ? { label: `Clean up ${stale.length}…`, fn: () => cleanUpDialog(ctx, l, new Set(stale)) } : null,
    { label: 'Download for TradingView', disabled: !l.items.length, fn: () => downloadOne(ctx, l) },
    { label: 'Delete…', cls: 'rej', fn: () => deleteListDialog(ctx, l) }]);
}

// ---------------------------------------------------------------- chart view: chart + key values
function chartPanel(ctx, st, cur, info, today) {
  if (!cur) return h('section', { class: 'card sc-chart' }, h('div', { class: 'empty' }, h('b', null, 'No stock selected'), h('span', null, 'Pick a stock in the list.')));
  const r = cur.r; const v = cur.s.v; const m = r.mark; const ss = m ? SC.statusOf(st, m.st) : null; const lists = SC.listsOf(st, r.t);
  const keyCols = keyColsOf(st, v.cols); const priceCol = v.cols.find((c) => /^price$/i.test(c)); const price = priceCol ? r.vals?.[priceCol] : '';
  return h('section', { class: 'card sc-chart', 'aria-label': 'Chart of ' + r.t },
    h('div', { class: 'sc-chd' },
      h('div', { class: 'sc-cht' }, h('b', { class: 'sc-big' }, r.t), price ? h('span', { class: 'sc-px' }, price) : null,
        // the rest shows when the mouse is on the head (his wish: minimal)
        h('span', { class: 'sc-chmore' }, h('span', { class: 'note' }, (r.full?.includes(':') ? r.full.split(':')[0] + ' · ' : '') + (r.rs !== null ? `RS ${r.rs}` : '')),
          cur.s.kind === 'compare' && r.n ? h('span', { class: 'note' }, ` · in ${r.n} of ${v.N}`) : null, ...marks(st, r, info, today),
          ss ? h('span', { class: 'sc-stw big c-' + ss.color }, dot(ss.color), ss.name) : null,
          h('span', { class: 'sc-actnote note' }, m ? `since ${dmy(m.date)}${ss?.rej && reasonNames(st, m) ? ' · ' + reasonNames(st, m) : ''}` : '', lists.length ? ` · in ${lists.map((l) => l.name).join(', ')}` : ''))),
      h('div', { class: 'row sc-chbtns', style: { gap: '6px' } },
        h('button', { type: 'button', class: 'btn sm', 'data-tip': V.focus ? 'Show the list again' : 'Full-size chart', 'aria-label': V.focus ? 'Show the list again' : 'Full-size chart', onClick: () => toggleFocus(ctx) }, V.focus ? '⤡' : '⤢'),
        h('button', { type: 'button', class: 'btn sm', 'data-tip': 'Add to one of your lists', 'aria-label': 'Add ' + r.t + ' to a list', disabled: ctx.readOnly, onClick: (e) => { e.stopPropagation(); stockMenu(ctx, [r], e.currentTarget, null, null, 'lists'); } }, '+'),
        h('a', { class: 'btn sm', href: fvUrl(r), target: '_blank', rel: 'noopener' }, 'Open in Finviz ↗'))),
    h('div', { id: 'sc-chart-ph', class: 'sc-chart-ph', 'data-symbol': r.full?.includes(':') ? r.full : r.t }, h('span', { class: 'note' }, 'Loading the TradingView chart…')),
    h('div', { class: 'sc-keys' }, keyCols.map((c) => h('span', null, h('span', { class: 'note' }, c + ' '), h('b', null, r.vals?.[c] || '–'))),
      v.cols.length ? h('button', { type: 'button', class: 'sc-iconbtn', 'aria-label': 'Choose the key values', 'data-tip': 'Choose the key values', onClick: () => keyColsDialog(ctx, v.cols, keyCols) }, '⚙') : null));
}
// full-size chart: the list slides away (his wish; the chart is TradingView's own frame, so a button does it instead of a double-click)
function toggleFocus(ctx) { V.focus = !V.focus; remember(); ctx.redraw(); toast(V.focus ? 'Full-size chart. Click ⤡ to bring the list back.' : 'The list is back.'); }
function keyColsOf(st, cols) {
  const saved = (st.scans.keyCols || []).filter((c) => cols.includes(c)); if (st.scans.keyCols) return saved;
  const out = []; for (const re of SC.KEY_DEFAULT) { const c = cols.find((x) => re.test(x) && !out.includes(x)); if (c) out.push(c); } return out;
}
function keyColsDialog(ctx, cols, shown) {
  const boxes = cols.map((c) => [c, h('input', { type: 'checkbox', checked: shown.includes(c) })]);
  dialog({ title: 'Key values under the chart', ok: 'Show', body: h('div', { class: 'sc-cols' }, para('Up to 6, from your scanner columns. They also come first in Filter.', 'note'), boxes.map(([c, b]) => h('label', null, b, ' ', c))),
    onOk: () => { const p = boxes.filter(([, b]) => b.checked).map(([c]) => c); if (p.length > 6) return 'Choose 6 at most.'; const r = ctx.act((d) => A.setScanKeyCols(d, p), { label: 'key values', now: true }); return r.ok ? true : r.error; } });
}

// ---------------------------------------------------------------- Table view: the same head, the same picks
function tablePanel(ctx, st, built, cur, info, today) {
  const wrap = h('section', { class: 'card sc-mid sc-tbl' });
  if (!built.length) { wrap.append(tabsBar(ctx), h('div', { class: 'empty' }, h('b', null, 'Nothing to show'), h('span', null, V.tab === 'compare' ? 'Click + in Chart view to make a comparison.' : V.tab === 'lists' ? 'Make a list first.' : 'Get a scan first.'))); return wrap; }
  const cols = SC.filterableCols([...new Set(built.flatMap((b) => (b.s.open ? b.s.v.cols : [])))]); const shown = shownCols(st, cols);
  const isCmp = V.tab === 'compare' && built[0]; const part = isCmp ? (V.part[built[0].s.cmp.id] || 'inall') : null; const v0 = built[0].s.v;
  const head = pickHead(ctx, st, built);
  const flat = built.flatMap((b) => b.rows.map((r) => ({ r, key: b.s.key, s: b.s })));
  const tickers = SC.finvizTickers(V.selMode ? flat.filter((x) => V.ticked.has(x.r.t)).map((x) => x.r.t) : flat.map((x) => x.r.t));
  const nHid = V.stHide.size; const nAll = SC.statusesOf(st).length + 1;
  head.append(...[
    isCmp ? h('div', { class: 'sc-parts2 inline' }, [['inall', 'In all'], ['some', 'In some'], ['one', 'Only one']].filter(([k]) => !(k === 'some' && (v0.N || 0) < 3)).map(([k, l]) => h('button', { type: 'button', class: part === k ? 'on' : '', onClick: () => { V.part[built[0].s.cmp.id] = k; ctx.redraw(); } }, l))) : null,
    h('span', { class: 'sc-ttools' + (V.selMode || nHid ? ' keep' : '') },
      V.tab !== 'status' ? h('button', { type: 'button', class: 'sc-qp' + (nHid ? ' on' : ''), onClick: (e) => { e.stopPropagation(); statusShowMenu(ctx, e.currentTarget); } }, nHid ? `Status · ${nAll - nHid} of ${nAll}` : 'Status', h('span', { class: 'sc-car' }, '▾')) : null,
      h('button', { type: 'button', class: 'sc-qp' + (V.selMode ? ' on' : ''), onClick: () => { V.selMode = !V.selMode; V.ticked = new Set(); ctx.redraw(); } }, V.selMode ? 'Done' : 'Select'),
      h('button', { type: 'button', class: 'sc-qp', 'aria-haspopup': 'menu', onClick: (e) => { e.stopPropagation(); columnsMenu(ctx, e.currentTarget, cols, shown); } }, 'Columns'),
      tickers.length ? h('a', { class: 'sc-qp', href: SC.finvizListUrl(tickers), target: '_blank', rel: 'noopener' }, 'All in Finviz ↗') : null)].filter(Boolean));
  wrap.append(tabsBar(ctx), head);
  if (V.selMode) wrap.append(selectBar(ctx, st, flat));
  const chips = chipRow(ctx, st); if (chips) wrap.append(chips);
  const inCol = isCmp && part !== 'inall';
  const span = 3 + shown.length + (V.selMode ? 1 : 0) + (inCol ? 1 : 0);
  const tb = h('tbody');
  for (const b of built) {
    if (V.tab === 'lists') tb.append(h('tr', { class: 'sc-tsec' }, h('td', { colspan: String(span) }, b.s.title, h('span', { class: 'sc-cnt' }, String(b.rows.length)))));
    for (const r of b.rows) {
      const m = r.mark; const ss = m ? SC.statusOf(st, m.st) : null; const names = inCol && r.hits ? b.s.v.runs.filter((_, i) => r.hits[i]).map((y) => shortName(y.scanner)).join(' · ') : '';
      tb.append(h('tr', { class: 'sc-row' + (r.t === cur?.r.t ? ' on' : '') + (r.rej ? ' rej' : ''), onClick: (e) => { if (e.target.closest('button, input')) return; if (V.selMode) { tick(ctx, r.t); return; } V.sel = { t: r.t, key: b.s.key }; ctx.redraw(); }, onDblclick: () => { V.sel = { t: r.t, key: b.s.key }; V.view = 'chart'; remember(); ctx.redraw(); } },
        V.selMode ? h('td', { class: 'sc-tk' }, h('input', { type: 'checkbox', 'aria-label': 'Tick ' + r.t, checked: V.ticked.has(r.t), onChange: () => tick(ctx, r.t) })) : null,
        h('td', null, h('div', { class: 'sc-sym' }, h('span', { class: 'sc-flag c-' + (ss ? ss.color : 'none') }), h('b', null, r.t), r.isNew ? h('span', { class: 'sc-tag new' }, 'New') : null, r.isDropped ? h('span', { class: 'sc-tag drop' }, 'Dropped') : null, ...marks(st, r, info, today))),
        inCol ? h('td', { class: 'sc-tin' }, names) : null,
        h('td', { class: 'r' + (r.rs !== null && r.rs >= 80 ? ' sc-strong' : '') }, r.rs ?? '–'),
        shown.map((c) => h('td', { class: 'r' }, r.vals?.[c] || '–')),
        h('td', { class: 'sc-stcell' }, h('button', { type: 'button', class: 'sc-stbtn', 'aria-haspopup': 'menu', 'aria-label': `Status of ${r.t}`, disabled: ctx.readOnly, onClick: (e) => { e.stopPropagation(); V.sel = { t: r.t, key: b.s.key }; stockMenu(ctx, [r], e.currentTarget, b.s); } }, statusText(st, r.mark), h('span', { class: 'sc-caret', 'aria-hidden': 'true' }, '▾')))));
    }
  }
  if (!flat.length) tb.append(h('tr', null, h('td', { colspan: String(span), class: 'sc-tempty' }, SC.filterCount(V.f) ? 'No stocks match the filter.' : 'No stocks here.')));
  const thead = h('tr', null, V.selMode ? h('th', { class: 'sc-tk' }, '') : null, h('th', null, 'Stock'), inCol ? h('th', null, 'In') : null,
    h('th', { class: 'r', 'data-tip': 'RS: strength over 3, 6 and 12 months, ranked 1–99 against every stock in the scans shown.' }, 'RS'), shown.map((c) => h('th', { class: 'r' }, c)), h('th', null, 'Status'));
  wrap.append(h('div', { class: 'sc-tw' }, h('table', { class: 'sc-t' }, h('thead', null, thead), tb)), h('div', { class: 'note sc-foot' }, 'Double-click a row to see its chart.'));
  return wrap;
}
function shownCols(st, cols) {
  const saved = (st.scans?.showCols || []).filter((c) => cols.includes(c)); if (saved.length) return saved;
  const want = [/^adr/i, /sector/i, /^price$/i, /^float\s*%|float %/i, /earning/i]; const out = [];
  for (const re of want) { const c = cols.find((x) => re.test(x) && !out.includes(x)); if (c) out.push(c); }
  return out.length ? out : cols.slice(0, 4);
}
// Columns: a switch per column (up to 8 shown; all columns stay saved with each scan)
function columnsMenu(ctx, anchor, cols, shown) {
  if (!cols.length) return dialog({ title: 'No columns', info: true, body: para('These stocks have no scanner columns. Scans from Finviz or TJ Collect bring every column of your view.', '') });
  openPop(anchor, 'Columns', (m) => {
    m.classList.add('sc-cmenu');
    m.append(h('div', { class: 'sc-smh' }, h('b', null, 'Columns'), h('span', { class: 'spacer' }), h('span', { class: 'note' }, 'up to 8')));
    const list = h('div', { class: 'sc-cmlist' });
    for (const c of cols) {
      const on = shown.includes(c);
      list.append(h('label', { class: 'sc-mi sc-csw' }, h('span', null, c), h('span', { class: 'spacer' }), h('span', { class: 'sc-sw' }, h('input', { type: 'checkbox', checked: on, disabled: ctx.readOnly,
        onChange: (e) => { const next = e.target.checked ? [...shown, c] : shown.filter((x) => x !== c); if (next.length > 8) { e.target.checked = false; toast('Choose 8 columns at most.'); return; }
          const r = ctx.act((d) => A.setScanCols(d, next), { label: 'scan columns', now: true }); if (!r.ok) { toast(r.error); return; } ctx.redraw(); columnsMenu(ctx, document.querySelector('.sc-ttools .sc-qp[aria-haspopup]') || anchor, cols, next); } }), h('i'))));
    }
    m.append(list);
  }, true);
}

// ---------------------------------------------------------------- Filter (A5, agreed 27-11-2026): a small panel under the Filter button
// Fixed rows RS, Price, Sector, Earnings; + Add a filter offers every column of his Finviz exports (not tied to what is open,
// not tied to the table's Columns). It works while he types; chips under the list head show what is on.
let FPOP = null; let FPAGE = 'main'; let FANCHOR = null;
function toggleFilter(ctx, anchor) {
  if (FPOP) return closeFilter(ctx);
  closeMenu(); FPAGE = 'main'; V.fOpen = true; FANCHOR = anchor;
  FPOP = h('div', { class: 'sc-fpop', role: 'dialog', 'aria-label': 'Filter' }); document.body.append(FPOP);
  fillFilter(ctx); placeFilter();
  setTimeout(() => { document.addEventListener('mousedown', fOutside, true); document.addEventListener('keydown', fEsc, true); }, 0);
  ctx.redraw();
}
const fOutside = (e) => { if (FPOP && !FPOP.contains(e.target) && !e.target.closest('.sc-fbtn, .sc-menu')) closeFilter(CTX); };
const fEsc = (e) => { if (e.key === 'Escape' && FPOP && !document.querySelector('.sc-menu')) { e.stopPropagation(); closeFilter(CTX); } };
function closeFilter(ctx) { FPOP?.remove(); FPOP = null; V.fOpen = false; document.removeEventListener('mousedown', fOutside, true); document.removeEventListener('keydown', fEsc, true); ctx?.redraw(); }
function placeFilter() {
  const a = document.querySelector('.sc-fbtn') || FANCHOR; if (!FPOP || !a) return; const r = a.getBoundingClientRect();
  FPOP.style.top = r.bottom + 8 + 'px'; FPOP.style.left = Math.max(8, Math.min(innerWidth - FPOP.offsetWidth - 8, r.right - FPOP.offsetWidth + 40)) + 'px';
}
const FIXED = (c) => /^(price|sector)$/i.test(c);
// values TJ has seen in a column, in all his scans (for "choose" filters)
function seenValues(st, c) { const out = new Set(); for (const r of st.scans.runs) { const i = (r.cols || []).indexOf(c); if (i < 0) continue; for (const x of r.rows) { const v = String(x.v?.[i] ?? '').trim(); if (v) out.add(v); } } return [...out].sort().slice(0, 60); }
function setF(ctx, patch) { V.f = { ...V.f, ...patch }; ctx.redraw(); }
function setCol(ctx, c, x) { const cols = { ...V.f.cols }; if (x) cols[c] = x; else delete cols[c]; setF(ctx, { cols }); }
function fillFilter(ctx) {
  if (!FPOP) return; const st = ctx.store.state; const f = V.f;
  const keepK = document.activeElement && FPOP.contains(document.activeElement) ? document.activeElement.dataset.k : null; const pos = document.activeElement?.selectionStart;
  const all = SC.allScanCols(st); const priceC = all.find((c) => /^price$/i.test(c)); const sectorC = all.find((c) => /^sector$/i.test(c));
  const kinds = SC.colKinds(LAST.built?.flatMap((b) => b.s.v.rows) || [], all);
  const box = (k, val, ph, on, cls = '') => h('input', { class: 'sc-fi ' + cls + (val !== null && val !== undefined && val !== '' ? ' has' : ''), 'data-k': k, value: val ?? '', placeholder: ph, inputmode: cls === 'date' ? null : 'decimal', type: cls === 'date' ? 'date' : 'text', 'aria-label': k, onInput: (e) => on(e.target.value.trim()) });
  const row = (label, ctl, del) => h('div', { class: 'sc-frow2' }, h('div', { class: 'sc-fl' }, label, del ? h('button', { type: 'button', class: 'sc-fdel', 'aria-label': 'Remove this filter', 'data-tip': 'Remove this filter', onClick: del }, '×') : null), h('div', { class: 'sc-fc' }, ctl));
  const rng = (k, x, set, kind) => h('div', { class: 'sc-frng' }, box(k + '.a', kind === 'date' ? x?.from : x?.min, kind === 'date' ? 'from' : 'min', (v) => set(kind === 'date' ? { ...(x || {}), from: v } : { ...(x || {}), min: v }), kind === 'date' ? 'date' : ''), h('span', null, '–'),
    box(k + '.b', kind === 'date' ? x?.to : x?.max, kind === 'date' ? 'to' : 'max', (v) => set(kind === 'date' ? { ...(x || {}), to: v } : { ...(x || {}), max: v }), kind === 'date' ? 'date' : ''));
  const pills = (c, vals, cur) => h('div', { class: 'sc-fpills' }, h('button', { type: 'button', class: 'sc-fp' + (!cur ? ' on' : ''), onClick: () => setCol(ctx, c, null) }, 'Any'),
    vals.map((v) => h('button', { type: 'button', class: 'sc-fp' + (cur === v ? ' on' : ''), onClick: () => setCol(ctx, c, cur === v ? null : { is: v }) }, v)));
  let body;
  if (FPAGE === 'add') {
    const q = h('input', { class: 'sc-fsearch', 'data-k': 'search', placeholder: 'Search your Finviz columns…', 'aria-label': 'Search columns' });
    const list = h('div', { class: 'sc-flist' });
    const draw = () => {
      const t = q.value.trim().toLowerCase(); const kids = []; const groups = {};
      for (const c of all) { if (FIXED(c) || (t && !c.toLowerCase().includes(t))) continue; const g = SC.filterColInfo(c, kinds).group; (groups[g] ||= []).push(c); }
      for (const g of ['Descriptive', 'Fundamental', 'Technical', 'Other']) { if (!groups[g]) continue; kids.push(h('div', { class: 'sc-fgh' }, g));
        for (const c of groups[g]) { const used = V.fAdded.includes(c) || f.cols?.[c]; const k = SC.filterColInfo(c, kinds).kind;
          kids.push(h('button', { type: 'button', class: 'sc-fli' + (used ? ' used' : ''), onClick: () => { if (!used) V.fAdded = [...V.fAdded, c]; FPAGE = 'main'; fillFilter(ctx); placeFilter(); } }, h('span', null, c), h('span', { class: 'sc-fk' }, used ? '✓ added' : { list: 'choose', date: 'dates', num: 'from – to' }[k]))); } }
      list.replaceChildren(...(kids.length ? kids : [h('div', { class: 'note sc-fnone' }, all.length ? 'No column with that name in your exports.' : 'Your scans have no columns to filter on yet.')]));
    };
    q.addEventListener('input', draw); draw();
    body = [h('div', { class: 'sc-fhead' }, h('button', { type: 'button', class: 'sc-fback', 'aria-label': 'Back', onClick: () => { FPAGE = 'main'; fillFilter(ctx); placeFilter(); } }, '‹'), h('b', null, 'Add a filter')), q, list];
    setTimeout(() => q.focus(), 0);
  } else {
    const rows = [row('RS', rng('rs', { min: f.rsMin, max: f.rsMax }, (y) => setF(ctx, { rsMin: y.min === '' || y.min === undefined ? null : y.min, rsMax: y.max === '' || y.max === undefined ? null : y.max })))];
    if (priceC) rows.push(row('Price', rng('price', f.cols?.[priceC], (y) => setCol(ctx, priceC, SC.colActive(y) ? y : null))));
    if (sectorC) rows.push(row('Sector', pills(sectorC, seenValues(st, sectorC), f.cols?.[sectorC]?.is)));
    const on = f.earnDays !== null && f.earnDays !== undefined && f.earnDays !== '';
    rows.push(row('Earnings', h('label', { class: 'sc-fsw' }, h('span', { class: 'sc-sw' }, h('input', { type: 'checkbox', checked: on, onChange: (e) => setF(ctx, { earnDays: e.target.checked ? (V.earnN || 7) : null }) }), h('i')),
      h('span', null, 'Hide if earnings are within'), box('earn', on ? f.earnDays : (V.earnN || 7), '7', (v) => { V.earnN = v || 7; if (on) setF(ctx, { earnDays: v === '' ? null : v }); }, 'tiny'), h('span', null, 'days'))));
    const extra = [...new Set([...V.fAdded, ...Object.keys(f.cols || {}).filter((c) => !FIXED(c))])].filter((c) => all.includes(c) || f.cols?.[c]);
    for (const c of extra) {
      const k = SC.filterColInfo(c, kinds).kind; const x = f.cols?.[c]; const del = () => { V.fAdded = V.fAdded.filter((y) => y !== c); setCol(ctx, c, null); };
      if (k === 'list') rows.push(row(c, pills(c, seenValues(st, c), x?.is), del));
      else rows.push(row(c, rng('c:' + c, x, (y) => setCol(ctx, c, SC.colActive(y) ? y : (y.from !== undefined || y.to !== undefined ? { from: y.from ?? '', to: y.to ?? '' } : { min: y.min ?? '', max: y.max ?? '' })), k), del));
    }
    const n = SC.filterCount(f);
    body = [h('div', { class: 'sc-fhead' }, h('b', null, 'Filter'), h('span', { class: 'sc-fcount' }, h('b', null, String(LAST.shown ?? 0)), ` of ${LAST.total ?? 0} stocks`), h('span', { class: 'spacer' }),
        n ? h('button', { type: 'button', class: 'linkish', onClick: () => { V.f = { ...SC.emptyFilter(), q: V.f.q }; V.fAdded = []; ctx.redraw(); } }, 'Clear all') : null),
      h('div', { class: 'sc-frows' }, rows),
      h('button', { type: 'button', class: 'sc-fadd', onClick: () => { FPAGE = 'add'; fillFilter(ctx); placeFilter(); } }, '+ Add a filter', h('span', { class: 'note' }, 'any column from your Finviz exports'))];
  }
  FPOP.replaceChildren(...body);
  if (keepK) { const el = FPOP.querySelector(`[data-k="${CSS.escape(keepK)}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* date box */ } } }
}
// the filters that are on, as chips under the list head (× takes one off; grey = not in what you see now, so it is ignored)
function chipRow(ctx, st) {
  const chips = []; const f = V.f; const has = (x) => x !== null && x !== undefined && x !== '';
  const cols = new Set((LAST.built || []).flatMap((b) => b.s.v?.cols || []));
  const chip = (text, off, grey = false) => h('span', { class: 'sc-fchip' + (grey ? ' grey' : ''), 'data-tip': grey ? 'Not in what you see now: it is ignored here' : 'Remove this filter' }, text, h('button', { type: 'button', 'aria-label': 'Remove filter ' + text, onClick: () => { off(); ctx.redraw(); } }, '×'));
  if (has(f.rsMin) || has(f.rsMax)) chips.push(chip(has(f.rsMin) && has(f.rsMax) ? `RS ${f.rsMin}–${f.rsMax}` : has(f.rsMin) ? `RS ≥ ${f.rsMin}` : `RS ≤ ${f.rsMax}`, () => { V.f = { ...V.f, rsMin: null, rsMax: null }; }));
  if (has(f.earnDays)) chips.push(chip(`No earnings ≤ ${f.earnDays} d`, () => { V.f = { ...V.f, earnDays: null }; }));
  for (const [c, x] of Object.entries(f.cols || {})) {
    if (!SC.colActive(x)) continue; const grey = !cols.has(c);
    const t = x.is !== undefined ? (/^sector$/i.test(c) ? x.is : `${c}: ${x.is}`) : x.from !== undefined || x.to !== undefined ? `${c} ${has(x.from) ? dmy(x.from) : '…'}–${has(x.to) ? dmy(x.to) : '…'}` : has(x.min) && has(x.max) ? `${c} ${x.min}–${x.max}` : has(x.min) ? `${c} ≥ ${x.min}` : `${c} ≤ ${x.max}`;
    chips.push(chip(grey ? t + ' (not here)' : t, () => { const cc = { ...V.f.cols }; delete cc[c]; V.f = { ...V.f, cols: cc }; }, grey));
  }
  if (!chips.length) return null;
  void st; return h('div', { class: 'sc-fchips', 'aria-label': 'Filters that are on' }, chips, chips.length > 1 ? h('button', { type: 'button', class: 'linkish', onClick: () => { V.f = { ...SC.emptyFilter(), q: V.f.q }; V.fAdded = []; ctx.redraw(); } }, 'Clear all') : null);
}

// ---------------------------------------------------------------- quick jump (Ctrl + K): a scanner, comparison, list, status or stock
function quickJump(ctx) {
  if (document.querySelector('.sc-qj')) return; const st = ctx.store.state;
  const go = (fn) => () => { fn(); V.sel = V.sel?.t && V.view ? V.sel : null; remember(); ctx.redraw(); };
  const stocks = [...new Set([...st.scans.runs.flatMap((r) => r.rows.map((x) => SC.tickerOf(x.s))), ...st.scans.lists.flatMap((l) => l.items.map((x) => x.t)), ...Object.keys(st.scans.marks || {})])].sort();
  const items = [
    ...scannerNames(st).map((n) => ({ k: 'Scanner', n, go: go(() => { V.tab = 'scans'; V.pick.scans = n; V.q = 'all'; V.sel = null; }) })),
    ...(st.scans.compares || []).map((c) => ({ k: 'Comparison', n: c.name, go: go(() => { V.tab = 'compare'; V.pick.compare = c.id; V.q = 'all'; V.sel = null; }) })),
    ...st.scans.folders.map((f) => ({ k: 'List', n: f.name, go: go(() => { V.tab = 'lists'; V.list = f.id; try { localStorage.setItem('tj-scans-list', f.id); } catch { /* fine */ } V.sel = null; }) })),
    ...SC.statusesOf(st).map((s) => ({ k: 'Status', n: s.name, go: go(() => { V.tab = 'status'; V.pick.status = s.id; V.sel = null; }) })),
    ...stocks.map((t) => ({ k: 'Stock', n: t, go: () => { jumpToStock(ctx, t); } })),
  ];
  let hit = 0; let shown = [];
  const inp = h('input', { class: 'sc-qj-in', placeholder: 'Jump to a scanner, list, status or stock…', 'aria-label': 'Quick jump' });
  const list = h('div', { class: 'sc-qj-list', role: 'listbox' });
  const draw = () => { const q = inp.value.trim().toLowerCase(); shown = (q ? items.filter((x) => x.n.toLowerCase().includes(q)) : items.filter((x) => x.k !== 'Stock')).slice(0, 8); hit = Math.min(hit, Math.max(0, shown.length - 1));
    list.replaceChildren(...(shown.length ? shown.map((x, i) => h('div', { class: 'sc-qj-it' + (i === hit ? ' on' : ''), role: 'option', onClick: () => pick(x) }, h('span', null, x.n), h('span', { class: 'note' }, x.k))) : [h('div', { class: 'note sc-qj-none' }, 'Nothing found.')])); };
  const back = h('div', { class: 'scrim sc-qj', onClick: (e) => { if (e.target === back) back.remove(); } }, h('div', { class: 'sc-qj-box' }, inp, list));
  const pick = (x) => { back.remove(); x.go(); };
  inp.addEventListener('input', () => { hit = 0; draw(); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); back.remove(); } else if (e.key === 'ArrowDown') { e.preventDefault(); hit = Math.min(shown.length - 1, hit + 1); draw(); } else if (e.key === 'ArrowUp') { e.preventDefault(); hit = Math.max(0, hit - 1); draw(); } else if (e.key === 'Enter' && shown[hit]) pick(shown[hit]); });
  document.body.append(back); draw(); inp.focus();
}
// a stock: the open tab if it is there, else the first scanner, list or status that has it
function jumpToStock(ctx, t) {
  const st = ctx.store.state; const today = ctx.today();
  const inView = (LAST.rows || []).find((x) => x.r.t === t); if (inView) { V.sel = { t, key: inView.key }; V.view = 'chart'; remember(); ctx.redraw(); return; }
  for (const n of scannerNames(st)) { const v = SC.sourceView(st, { kind: 'scanner', name: n }, today); if (v.rows.some((r) => r.t === t)) { V.tab = 'scans'; V.pick.scans = n; V.q = 'all'; delete V.day['S:' + n]; V.sel = { t, key: 'S:' + n }; if (v.rows.find((r) => r.t === t)?.rej) V.showRej['S:' + n] = true; V.view = 'chart'; remember(); ctx.redraw(); return; } }
  const l = st.scans.lists.find((x) => x.items.some((y) => y.t === t)); if (l) { V.tab = 'lists'; V.list = l.folder; V.sel = { t, key: 'L:' + l.id }; V.view = 'chart'; remember(); ctx.redraw(); return; }
  const m = st.scans.marks?.[t]; if (m) { V.tab = 'status'; V.pick.status = m.st; V.sel = { t, key: 'T:' + m.st }; V.view = 'chart'; remember(); ctx.redraw(); return; }
  toast(`${t} is not in a scan, list or status now.`);
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
  const s = m ? SC.statusOf(st, m.st) : null;
  if (!s) return h('span', { class: 'sc-st new' }, 'No status');
  const reasons = s.rej ? reasonNames(st, m) : '';
  return h('span', { class: 'sc-stw c-' + s.color, title: `${s.name} on ${dmy(m.date)}${reasons ? ' · ' + reasons : ''}` }, dot(s.color), s.name, reasons ? h('span', { class: 'sc-why' }, ' · ' + reasons) : null);
}
const reasonNames = (st, m) => [...(m.reasons || []).map((id) => st.rejects.find((x) => x.id === id)?.name).filter(Boolean), m.other || ''].filter(Boolean).join(', ');
// the ▼ on a stock (or Select): head, his statuses as one-click pills, "Add to list ›" (a page inside the same menu), Remove from this section
function stockMenu(ctx, rows, anchor, s, after, page = null, openList = null) {
  const st = ctx.store.state; const one = rows.length === 1 ? rows[0] : null; const cur = one?.mark?.st || null;
  openPop(anchor, one ? `Status and lists of ${one.t}` : `${rows.length} stocks`, (m) => {
    m.classList.add('sc-smenu');
    if (page === 'lists') return listPage(ctx, m, rows, anchor, s, after, openList);
    const priceCol = one ? Object.keys(one.vals || {}).find((c) => /^price$/i.test(c)) : null;
    m.append(h('div', { class: 'sc-smh' }, h('b', null, one ? one.t : plural(rows.length, 'stock')), one && priceCol && one.vals[priceCol] ? h('span', { class: 'note' }, one.vals[priceCol]) : null, h('span', { class: 'spacer' }), one && one.rs !== null ? h('span', { class: 'note' }, 'RS ' + one.rs) : null));
    m.append(h('div', { class: 'sc-mhead2' }, 'Status'));
    m.append(h('div', { class: 'sc-pills' }, [...SC.statusesOf(st).map((x) => [x.id, x.name + (x.rej ? '…' : ''), x.color, x]), ['', 'None', 'none', null]].map(([id, n, col, x]) => {
      const on = one ? (cur || '') === id : false;
      return h('button', { type: 'button', class: 'sc-pill c-' + col + (on ? ' on' : ''), 'aria-pressed': String(on), onClick: () => {
        closeMenu(); if (on) return;
        if (!id) { if (rows.some((r) => r.mark)) { clearStatus(ctx, rows); after?.(); } return; }
        setStatus(ctx, rows, x.id); after?.();
      } }, id ? dot(col) : null, n);
    })));
    const inLists = one ? SC.listsOf(st, one.t).length : 0;
    m.append(h('button', { type: 'button', class: 'sc-mi sep', onClick: (e) => { e.stopPropagation(); stockMenu(ctx, rows, anchor, s, after, 'lists'); } }, h('span', null, 'Add to list'), h('span', { class: 'note' }, (inLists ? `in ${inLists} ` : '') + '›')));
    if (s?.kind === 'list' && one) m.append(h('button', { type: 'button', class: 'sc-mi rej', onClick: () => { closeMenu(); const r = ctx.act((d) => A.removeFromScanList(d, s.list.id, [one.t]), { label: `remove ${one.t}`, now: true }); if (r.ok) toast(`${one.t} removed from ${s.list.name}.`, 'Undo', () => ctx.store.undo()); else toast(r.error); ctx.redraw(); } }, `Remove from ${s.list.name}`));
  }, !!page || openList !== null);
}
// A3 (agreed 27-11-2026): his lists, each with ›; a list opens with its sections (✓ where the stock is already) and + New section; + New list
function listPage(ctx, m, rows, anchor, s, after, openId) {
  const sc = ctx.store.state.scans; const one = rows.length === 1 ? rows[0] : null;
  m.append(h('div', { class: 'sc-smh' }, h('button', { type: 'button', class: 'sc-mback', 'aria-label': 'Back', onClick: (e) => { e.stopPropagation(); stockMenu(ctx, rows, anchor, s, after); } }, '‹'), h('b', null, `Add ${one ? one.t : plural(rows.length, 'stock')} to`)));
  for (const f of sc.folders) {
    const secs = sc.lists.filter((l) => l.folder === f.id); const open = f.id === openId; const inAny = secs.some((l) => rows.every((r) => l.items.some((y) => y.t === SC.tickerOf(r.t))));
    m.append(h('button', { type: 'button', class: 'sc-mi list' + (open ? ' open' : ''), 'aria-expanded': String(open), onClick: (e) => { e.stopPropagation(); stockMenu(ctx, rows, anchor, s, after, 'lists', open ? '' : f.id); } },
      h('span', null, h('span', { class: 'sc-chev', 'aria-hidden': 'true' }, open ? '▾ ' : '▸ '), f.name), inAny ? h('span', { class: 'sc-ok' }, '✓') : null));
    if (!open) continue;
    for (const l of secs) { const has = rows.every((r) => l.items.some((y) => y.t === SC.tickerOf(r.t)));
      m.append(h('button', { type: 'button', class: 'sc-mi sub', onClick: () => { closeMenu(); addToSection(ctx, l, rows, after); } }, h('span', null, l.name), has ? h('span', { class: 'sc-ok' }, '✓') : h('span', { class: 'note' }, String(l.items.length)))); }
    m.append(h('button', { type: 'button', class: 'sc-mi sub add', onClick: () => { closeMenu(); newSectionDialog(ctx, rows, after, f.id); } }, '+ New section'));
  }
  m.append(h('button', { type: 'button', class: 'sc-mi sep add', onClick: () => { closeMenu(); newListDialog(ctx, rows, after); } }, '+ New list'));
}

function nextAfter(rows) { const gone = new Set(rows.map((r) => r.t)); const i = LAST.rows.findIndex((x) => x.key === V.sel?.key && x.r.t === V.sel?.t); const n = LAST.rows.slice(i + 1).find((x) => !gone.has(x.r.t)) || LAST.rows.find((x) => !gone.has(x.r.t)); return n ? { t: n.r.t, key: n.key } : null; }
function setStatus(ctx, rows, id) {
  const st = ctx.store.state; const s = SC.statusOf(st, id); if (!s) return;
  if (s.rej) return rejectDialog(ctx, rows);
  const res = ctx.act((d) => { for (const r of rows) { const x = A.setScanMark(d, r.t, { status: id, date: ctx.today() }); if (!x.ok) return x; } return { ok: true }; }, { label: `${rows.length === 1 ? rows[0].t : rows.length + ' stocks'} → ${s.name}`, now: true });
  if (!res.ok) return toast(res.error);
  ctx.redraw(); toast(`${rows.length === 1 ? rows[0].t : plural(rows.length, 'stock')} → ${s.name}.`, 'Undo', () => ctx.store.undo());
}
function clearStatus(ctx, rows) {
  const res = ctx.act((d) => { let n = 0; for (const r of rows) if (A.clearScanMark(d, r.t).ok) n++; return n ? { ok: true } : { ok: false, error: 'No status to take away.' }; }, { label: 'no status', now: true });
  if (!res.ok) return toast(res.error); ctx.redraw(); toast(`${rows.length === 1 ? rows[0].t : plural(rows.length, 'stock')}: no status.`, 'Undo', () => ctx.store.undo());
}
// Rejected (1.8.17, his rules): reasons optional; a typed "Other" reason → asked once whether to add it to the chips
function rejectDialog(ctx, rows) {
  if (ctx.readOnly || !rows.length) return;
  const st = ctx.store.state; const rej = SC.statusesOf(st).find((x) => x.rej); if (!rej) return;
  const m = rows.length === 1 && rows[0].mark?.st === rej.id ? rows[0].mark : null; const on = new Set(m?.reasons || []);
  const chips = st.rejects.filter((x) => !x.archived || on.has(x.id)).map((x) => { const b = h('button', { type: 'button', class: 'sc-chip' + (on.has(x.id) ? ' on' : ''), 'aria-pressed': String(on.has(x.id)), onClick: () => { if (on.has(x.id)) on.delete(x.id); else on.add(x.id); b.classList.toggle('on'); b.setAttribute('aria-pressed', String(on.has(x.id))); } }, x.name); return b; });
  const other = h('input', { value: m?.other || '', placeholder: 'Other reason (optional)', 'aria-label': 'Other reason', maxlength: '120' });
  const name = rows.length === 1 ? rows[0].t : plural(rows.length, 'stock');
  dialog({ title: `Reject ${name}`, ok: 'Reject', body: h('div', { style: { display: 'grid', gap: '10px' } }, h('div', { class: 'sc-chips' }, chips), field('Other', other), para('All optional.', 'note')),
    onOk: () => {
      const next = nextAfter(rows); const o = other.value.trim();
      const res = ctx.act((d) => { for (const r of rows) { const x = A.setScanMark(d, r.t, { status: rej.id, reasons: [...on], other: o, date: ctx.today() }); if (!x.ok) return x; } return { ok: true }; }, { label: `reject ${name}`, now: true });
      if (!res.ok) return res.error;
      if (V.sel && rows.some((r) => r.t === V.sel.t) && V.tab !== 'status') V.sel = next;
      ctx.redraw();
      if (o && !st.rejects.some((x) => x.name.toLowerCase() === o.toLowerCase())) setTimeout(() => askAddReason(ctx, rows, o), 0);
      else toast(`${name} rejected.`, 'Undo', () => ctx.store.undo());
      return true;
    } });
}
async function askAddReason(ctx, rows, o) {
  const ok = await dialog({ title: `Add “${o}” to your reject reasons?`, ok: 'Add reason', cancel: 'Not now', body: para('It becomes a chip you can click next time. You can rename or archive it in Lists → Reject reasons.', '') });
  if (!ok) return toast(`${rows.length === 1 ? rows[0].t : plural(rows.length, 'stock')} rejected.`, 'Undo', () => ctx.store.undo());
  const res = ctx.act((d) => { const a = A.addListItem(d, 'rejects', o); if (!a.ok) return a;
    for (const r of rows) { const m = d.scans.marks[SC.tickerOf(r.t)]; if (m && m.other === o) { m.reasons = [...new Set([...(m.reasons || []), a.data.id])]; m.other = ''; } } return a; }, { label: 'add reason', now: true });
  if (!res.ok) return toast(res.error); ctx.redraw(); toast(`“${o}” added to your reject reasons.`, 'Undo', () => ctx.store.undo());
}


// ---------------------------------------------------------------- add to a list (▼ on a stock, + above the chart, Select)
function addToSection(ctx, l, rows, after) {
  const res = ctx.act((d) => A.addToScanList(d, l.id, rows.map((r) => ({ t: r.t, full: r.full || r.t })), { date: ctx.today() }), { label: 'add to ' + l.name, now: true });
  if (!res.ok) return toast(res.error); after?.(); ctx.redraw();
  toast(res.data.added ? `${plural(res.data.added, 'stock')} added to ${l.name}.` : `Already in ${l.name}.`, 'Undo', () => ctx.store.undo());
}

// ---------------------------------------------------------------- lists, sections, statuses (dialogs)
async function nameDialog(ctx, title, value, act) {
  const inp = h('input', { value, maxlength: '60', 'aria-label': 'Name' }); setTimeout(() => inp.select(), 0);
  await dialog({ title, ok: 'Save', body: field('Name', inp), onOk: () => { const r = ctx.act((d) => act(d, inp.value), { label: title.toLowerCase(), now: true }); return r.ok ? true : r.error; } });
  ctx.redraw();
}
async function newListDialog(ctx, rows, after) {
  const inp = h('input', { maxlength: '60', 'aria-label': 'List name', placeholder: 'Swing ideas' }); const sec = h('input', { maxlength: '60', 'aria-label': 'First section', value: 'WATCH' }); setTimeout(() => inp.focus(), 0);
  let made = null;
  await dialog({ title: 'New list', ok: 'Create', body: h('div', { style: { display: 'grid', gap: '8px' } }, field('Name', inp), field('First section', sec)),
    onOk: () => { const r = ctx.act((d) => { const f = A.addScanFolder(d, inp.value); if (!f.ok) return f; const l = A.addScanList(d, sec.value || 'WATCH', f.data.id); if (!l.ok) return l;
      if (rows?.length) A.addToScanList(d, l.data.id, rows.map((x) => ({ t: x.t, full: x.full || x.t })), { date: ctx.today() }); return { ok: true, data: f.data }; }, { label: 'new list', now: true });
      if (r.ok) made = r.data.id; return r.ok ? true : r.error; } });
  if (made) { V.list = made; try { localStorage.setItem('tj-scans-list', made); } catch { /* fine */ } if (!rows) V.tab = 'lists'; after?.(); }
  ctx.redraw();
}
async function newSectionDialog(ctx, rows, after, folderId = null) {
  const st = ctx.store.state; const f = st.scans.folders.find((x) => x.id === folderId) || currentList(st); if (!f) return newListDialog(ctx, rows, after);
  const inp = h('input', { maxlength: '60', 'aria-label': 'Section name', placeholder: 'CLOSE WATCHING' }); setTimeout(() => inp.focus(), 0);
  const sel = h('select', { 'aria-label': 'In list' }, st.scans.folders.map((x) => h('option', { value: x.id, selected: x.id === f.id }, x.name)));
  await dialog({ title: 'New section', ok: 'Create', body: h('div', { style: { display: 'grid', gap: '8px' } }, field('Name', inp), st.scans.folders.length > 1 ? field('In list', sel) : null),
    onOk: () => { const r = ctx.act((d) => { const l = A.addScanList(d, inp.value, sel.value); if (!l.ok) return l; if (rows?.length) A.addToScanList(d, l.data.id, rows.map((x) => ({ t: x.t, full: x.full || x.t })), { date: ctx.today() }); return l; }, { label: 'new section', now: true });
      if (r.ok) { after?.(); toast(rows?.length ? `${plural(rows.length, 'stock')} added to ${inp.value.trim()}.` : `Section ${inp.value.trim()} made.`); } return r.ok ? true : r.error; } });
  ctx.redraw();
}
async function deleteListDialog(ctx, l) {
  const ok = await dialog({ title: `Delete the section ${l.name}?`, ok: 'Delete', danger: true, body: para(`Its ${plural(l.items.length, 'stock')} leave this section only. It moves to the Trash for ${A.trashText(ctx.store.state)}.`, '') });
  if (!ok) return; const r = ctx.act((d) => A.deleteScanList(d, l.id), { label: 'delete section', now: true }); if (r.ok) toast(`${l.name} moved to the Trash.`, 'Undo', () => ctx.store.undo()); ctx.redraw();
}
async function deleteFolderDialog(ctx, f, ls) {
  const ok = await dialog({ title: `Delete the list ${f.name}?`, ok: 'Delete', danger: true, body: para(ls.length ? `Its ${plural(ls.length, 'section')} (${ls.map((l) => l.name).join(', ')}) go with it. Everything moves to the Trash for ${A.trashText(ctx.store.state)}.` : 'It is empty. It moves to the Trash for ' + A.trashText(ctx.store.state) + '.', '') });
  if (!ok) return; const r = ctx.act((d) => A.deleteScanFolder(d, f.id), { label: 'delete list', now: true }); if (r.ok) { V.list = null; toast(`${f.name} moved to the Trash.`, 'Undo', () => ctx.store.undo()); } ctx.redraw();
}
async function cleanUpDialog(ctx, l, stale) {
  const ok = await dialog({ title: `Clean up ${l.name}?`, ok: 'Remove them', body: h('div', { style: { display: 'grid', gap: '8px' } }, para('These stocks were rejected or bought since you added them:', ''), h('b', null, [...stale].join(', ')), para('They leave this section only. Undo brings them back.', 'note')) });
  if (!ok) return; const r = ctx.act((d) => A.cleanUpScanLists(d, [l.id]), { label: 'clean up ' + l.name, now: true }); if (r.ok) toast(`${plural(r.data.n, 'stock')} removed.`, 'Undo', () => ctx.store.undo()); ctx.redraw();
}
async function newStatusDialog(ctx) {
  const inp = h('input', { maxlength: '60', 'aria-label': 'Status name', placeholder: 'Earnings play' }); setTimeout(() => inp.focus(), 0);
  const col = h('select', { 'aria-label': 'Colour' }, STATUS_COLORS.map((c) => h('option', { value: c, selected: c === 'amber' }, COLOR_NAME[c])));
  await dialog({ title: 'New status', ok: 'Create', body: h('div', { style: { display: 'grid', gap: '8px' } }, field('Name', inp), field('Colour', col)),
    onOk: () => { const r = ctx.act((d) => A.addStatus(d, inp.value, col.value), { label: 'new status', now: true }); return r.ok ? true : r.error; } });
  ctx.redraw();
}
async function deleteStatusDialog(ctx, x) {
  const n = Object.values(ctx.store.state.scans.marks || {}).filter((m) => m.st === x.id).length;
  const ok = await dialog({ title: `Delete the status ${x.name}?`, ok: 'Delete', danger: true, body: para(`${n ? `Its ${plural(n, 'stock')} will have no status. ` : ''}It moves to the Trash for ${A.trashText(ctx.store.state)}, so you can restore it with its stocks.`, '') });
  if (!ok) return; V.stHide.delete(x.id); const r = ctx.act((d) => A.deleteStatus(d, x.id), { label: 'delete status', now: true }); if (r.ok) toast(`${x.name} moved to the Trash.`, 'Undo', () => ctx.store.undo()); else toast(r.error); ctx.redraw();
}

// ---------------------------------------------------------------- scanners and comparisons
async function deleteScannerDialog(ctx, name) {
  const n = SC.scannerRuns(ctx.store.state, name).length;
  const ok = await dialog({ title: `Delete ${name} and its ${plural(n, 'scan')}?`, ok: 'Delete', danger: true, body: para('Everything moves to the Trash for ' + A.trashText(ctx.store.state) + ', so you can restore it. Your statuses on the stocks and your lists stay.', '') });
  if (!ok) return; const r = ctx.act((d) => A.deleteScanner(d, name), { label: 'delete scanner', now: true });
  if (r.ok) toast(`${name} moved to the Trash.`, 'Undo', () => ctx.store.undo()); else toast(r.error); ctx.redraw();
}
async function deleteRunDialog(ctx, run) {
  const ok = await dialog({ title: `Delete the ${run.scanner} scan of ${dmy(run.date)}?`, ok: 'Delete', danger: true, body: para('It moves to the Trash for ' + A.trashText(ctx.store.state) + '. Your statuses on the stocks stay.', '') });
  if (!ok) return; const r = ctx.act((d) => A.deleteScanRun(d, run.id), { label: 'delete scan', now: true }); if (r.ok) { delete V.day['S:' + run.scanner]; toast('Scan moved to the Trash.', 'Undo', () => ctx.store.undo()); } ctx.redraw();
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
  if (made) focusKey(ctx, 'C:' + made); else ctx.redraw();
}
async function deleteCompareDialog(ctx, c) {
  const ok = await dialog({ title: `Delete the comparison ${c.name}?`, ok: 'Delete', danger: true, body: para('Only the comparison goes (to the Trash for ' + A.trashText(ctx.store.state) + '). Your scans, statuses and lists stay.', '') });
  if (!ok) return; const r = ctx.act((d) => A.deleteScanCompare(d, c.id), { label: 'delete comparison', now: true }); if (r.ok) toast(`${c.name} moved to the Trash.`, 'Undo', () => ctx.store.undo()); ctx.redraw();
}


// open one scanner / comparison (after a paste, a Finviz fetch, a new comparison)
function focusKey(ctx, key, run = null) {
  V.q = 'all'; V.sel = null;
  if (key.startsWith('S:')) { V.tab = 'scans'; V.pick.scans = key.slice(2); if (run) V.day[key] = run; else delete V.day[key]; }
  if (key.startsWith('C:')) { V.tab = 'compare'; V.pick.compare = key.slice(2); }
  remember(); ctx.redraw();
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
      focusKey(ctx, 'S:' + scanner, prev.id);
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
  focusKey(ctx, 'S:' + scanner, res.data.run.id);
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
    para('Use the Performance view (or a table view) on Finviz before you copy the address: Performance gives RS. Your key is never needed here.', 'note'),
    para('Changed columns or filters in Finviz? Paste the new address here. Trade Journal keeps using the address it saved.', 'note')), // 1.8.15 (agreed 25-11-2026; his test: Finviz changes do not reach TJ by themselves)
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
  FETCHING = true; ctx.redraw(); // the ⟳ turns while it fetches
  for (let i = 0; i < pick.length; i++) {
    const x = pick[i]; toast(`Getting ${x.name} (${i + 1} of ${pick.length})…`, null, null, 20000);
    const r = await fvFetch(helper, x.q);
    if (!r.ok) { failed.push(`${x.name}: ${r.error}`); continue; }
    if (!r.rows.length) { failed.push(`${x.name}: no stocks today`); ctx.act((d) => A.markFvFetched(d, x.id, today), { label: 'fetched', now: true, noUndo: true }); continue; }
    const res = ctx.act((d) => { const a = A.addScanRun(d, { scanner: x.name, date: today, cols: r.cols, rows: r.rows, shown: r.rows.length }, { replace: true, today }); if (a.ok) A.markFvFetched(d, x.id, today); return a; }, { label: 'Finviz ' + x.name, now: true });
    if (res.ok) done.push(`${x.name} ${r.rows.length}`); else failed.push(`${x.name}: ${res.error}`);
  }
  FETCHING = false;
  if (done.length) focusKey(ctx, 'S:' + pick.find((x) => done.some((d) => d.startsWith(x.name + ' '))).name); else ctx.redraw();
  if (failed.length) dialog({ title: done.length ? 'Some screeners did not come' : 'Nothing came from Finviz', info: true, body: h('div', { style: { display: 'grid', gap: '6px' } }, done.length ? para('Got: ' + done.join(' · '), '') : null, h('ul', { class: 'sc-ul' }, failed.map((f) => h('li', null, f)))) });
  else toast(`Got from Finviz: ${done.join(' · ')}.`, null, null, 7000);
}
