// Scans tab — 1.8.17 redesign (agreed with him 25-11-2026, releases/scans-simplify-decisions.md): the chart takes most of the
// screen; next to it ONE stock panel with three tabs — Scans (each scanner / comparison a section), My lists (lists with
// sections, like the TradingView watchlist) and Status (his own statuses, each a colour). Sections fold (▾/▸) and are dragged
// by their head; stocks in My lists and Status are dragged too (smooth, like the Open positions cards). Rejected stocks are
// hidden in scans and lists ("3 rejected hidden"); every stock with a status is always in the Status tab.
// Top bar: New today · Dropped today · Status ▾ · Find · Filter (Finviz style) · Chart/Table · ⟳ Finviz · ⋯.
// Keys: ↑ ↓ move (the chart follows), Enter opens Finviz, Ctrl+V pastes a scan. No status keys (his choice).
import { h, dialog, para, toast, download, dmy, field } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';
import * as A from '../actions.js';
import * as SC from '../scans.js';
import { STATUS_COLORS } from '../model.js';

const V = { tab: 'scans', list: null, sel: null, view: 'chart', f: SC.emptyFilter(), fOpen: false, stF: new Set(), q: 'all', selMode: false, ticked: new Set(), showRej: {}, part: {}, day: {} };
let CTX = null;
let LAST = { rows: [], focus: null };

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
    if (!CTX || CTX.route !== 'scans' || isTyping(e.target) || dialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key; const rows = LAST.rows; if (k === '?') { e.preventDefault(); keysHelp(); return; } if (!rows.length) return;
    const i = Math.max(0, rows.findIndex((x) => x.key === V.sel?.key && x.r.t === V.sel?.t));
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); const j = Math.min(rows.length - 1, Math.max(0, i + (k === 'ArrowDown' ? 1 : -1))); V.sel = { t: rows[j].r.t, key: rows[j].key }; CTX.redraw(); return; }
    if (k === 'Enter') { const cur = rows[i]; if (cur) { e.preventDefault(); window.open(fvUrl(cur.r), '_blank', 'noopener'); } }
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
function sectionsOf(st, today) {
  const sc = st.scans;
  if (V.tab === 'scans') return scanKeys(st).map((key) => {
    if (key.startsWith('S:')) { const name = key.slice(2); return { key, kind: 'scanner', name, title: name, src: { kind: 'scanner', name, run: V.day[key] }, open: !folded(st, key) }; }
    const c = (sc.compares || []).find((x) => 'C:' + x.id === key); return { key, kind: 'compare', title: c.name, cmp: c, src: { kind: 'compare', id: c.id }, open: !folded(st, key, true) };
  });
  if (V.tab === 'lists') { const f = currentList(st); if (!f) return []; return sc.lists.filter((l) => l.folder === f.id).map((l) => ({ key: 'L:' + l.id, kind: 'list', title: l.name, list: l, src: { kind: 'list', id: l.id }, open: !folded(st, 'L:' + l.id) })); }
  return SC.statusesOf(st).map((s) => ({ key: 'T:' + s.id, kind: 'status', title: s.name, status: s, src: { kind: 'status', id: s.id }, open: !folded(st, 'T:' + s.id, !!s.rej) }));
}
// the stocks one section shows, after New today / Dropped today, the comparison part, Rejected hiding and the filter
function sectionRows(st, s, v) {
  let base = v.rows;
  if (s.kind === 'scanner' || s.kind === 'compare') {
    if (s.kind === 'compare') base = SC.quickRows(v, V.part[s.cmp.id] || 'inall');
    if (V.q === 'new' && v.hasNewDrop) base = base.filter((r) => r.isNew);
    if (V.q === 'dropped') base = v.hasNewDrop ? v.dropped.map((r) => ({ ...r, isDropped: true })) : [];
  }
  let rej = 0;
  if (s.kind !== 'status' && !V.showRej[s.key]) { const keep = base.filter((r) => !r.rej); rej = base.length - keep.length; base = keep; }
  const fr = SC.applyFilter(base, V.f, { cols: v.cols, statuses: V.stF.size ? V.stF : null, statusOf: (r) => r.mark?.st || 'none' });
  return { rows: fr.rows, rej, noData: fr.noData, total: base.length };
}

// ---------------------------------------------------------------- page
export function render(ctx) {
  CTX = ctx; const st = ctx.store.state; const today = ctx.today(); const sc = st.scans;
  for (const id of [...V.stF]) if (id !== 'none' && !SC.statusOf(st, id)) V.stF.delete(id);
  document.body.classList.toggle('tj-nomenu', menuHidden());
  const anything = sc.runs.length || (sc.lists || []).length || (sc.folders || []).length || Object.keys(sc.marks || {}).length;
  if (!anything) return h('div', { class: 'scans' }, h('header', { class: 'pg-head sc-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'Trade'), h('h1', null, 'Scans')),
    h('div', { class: 'sc-headbtns' }, h('button', { class: 'btn sm', onClick: () => keysHelp() }, 'Keys ?'))), emptyState(ctx));
  const secs = sectionsOf(st, today); const flat = []; const built = [];
  let cols = [];
  for (const s of secs) {
    const v = SC.sourceView(st, s.src, today); s.v = v;
    if (V.tab === 'scans' || s.open) cols = [...new Set([...cols, ...v.cols])];
    if (!s.open) { built.push({ s, rows: [], rej: 0, noData: 0, total: v.rows.length }); continue; }
    const x = sectionRows(st, s, v); built.push({ s, ...x });
    for (const r of x.rows) flat.push({ r, key: s.key, s });
  }
  let cur = flat.find((x) => x.key === V.sel?.key && x.r.t === V.sel?.t) || (V.sel?.t ? flat.find((x) => x.r.t === V.sel.t) : null) || flat.find((x) => x.key === V.sel?.key) || flat[0] || null;
  if (cur) V.sel = { t: cur.r.t, key: cur.key };
  LAST = { rows: flat, focus: cur };
  const info = tradeInfo(st);
  const main = V.view === 'table' ? tablePanel(ctx, st, built, cur, info, today) : [panel(ctx, st, built, flat, info, today), chartPanel(ctx, st, cur, info, today)];
  if (V.view === 'chart' && cur) setTimeout(() => showChart(cur.r.full && cur.r.full.includes(':') ? cur.r.full : cur.r.t), 0); else setTimeout(placeChart, 0);
  setTimeout(() => { placeChart(); document.querySelector('.sc-li.on')?.scrollIntoView({ block: 'nearest' }); }, 0);
  return h('div', { class: 'scans full' }, toolbar(ctx, st, built, cols), filterArea(ctx, st, built, cols),
    h('div', { class: 'sc-body ' + V.view }, main));
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
    k('↑ ↓', 'Move through the stocks (the chart follows)'), k('Enter', 'Open the stock in Finviz'), k('Ctrl + V', 'Add a scan from TJ Collect'), k('?', 'This list'),
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
      const next = items.find((k) => { const r = k.getBoundingClientRect(); return cy < r.top + r.height / 2; }) || null;
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
function toolbar(ctx, st, built, cols) {
  const nF = SC.filterCount(V.f);
  const q = h('input', { type: 'search', class: 'sc-q', value: V.f.q, placeholder: 'Find', 'aria-label': 'Find a ticker', 'data-keep': 'sc-q',
    onInput: (e) => { V.f = { ...V.f, q: e.target.value }; ctx.redraw(); const el = document.querySelector('[data-keep="sc-q"]'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } } });
  const hidden = menuHidden();
  let nNew = 0, nDrop = 0;
  if (V.tab === 'scans') for (const b of built) { const v = b.s.v; if (!v?.hasNewDrop) continue; const base = b.s.kind === 'compare' ? SC.quickRows(v, V.part[b.s.cmp.id] || 'inall') : v.rows; nNew += base.filter((r) => r.isNew && !r.rej).length; nDrop += v.dropped.length; }
  const qb = (k, label, n, cls = '') => h('button', { type: 'button', class: 'sc-qv ' + cls + (V.q === k ? ' on' : ''), 'aria-pressed': String(V.q === k), onClick: () => { V.q = V.q === k ? 'all' : k; ctx.redraw(); } }, label, h('span', { class: 'sc-n' }, n));
  const nSt = V.stF.size;
  return h('div', { class: 'sc-tool' },
    h('button', { type: 'button', class: 'sc-ibtn', 'aria-label': hidden ? 'Show the program menu' : 'Hide the program menu', title: hidden ? 'Show the program menu' : 'Hide the program menu for a bigger chart', onClick: () => { try { localStorage.setItem('tj-scans-nomenu', hidden ? '0' : '1'); } catch { /* fine */ } ctx.redraw(); } }, hidden ? '⇥' : '⇤'),
    h('div', { class: 'sc-quick', role: 'group', 'aria-label': 'Quick views' },
      V.tab === 'scans' ? [qb('new', 'New today', nNew), qb('dropped', 'Dropped today', nDrop, 'drop')] : null,
      h('button', { type: 'button', class: 'sc-qv' + (nSt ? ' on' : ''), 'aria-haspopup': 'menu', onClick: (e) => { e.stopPropagation(); statusFilterMenu(ctx, e.currentTarget); } }, nSt ? `Status · ${nSt}` : 'Status', h('span', { 'aria-hidden': 'true' }, ' ▾'))),
    h('span', { class: 'spacer' }),
    q, h('button', { type: 'button', class: 'btn sm sc-fbtn' + (nF ? ' active' : ''), 'aria-expanded': String(V.fOpen), onClick: () => { V.fOpen = !V.fOpen; ctx.redraw(); } }, nF ? `Filter · ${nF}` : 'Filter'),
    h('div', { class: 'seg sc-pages', role: 'group', 'aria-label': 'View' }, [['chart', 'Chart'], ['table', 'Table']].map(([k, l]) => h('button', { type: 'button', class: V.view === k ? 'on' : '', 'aria-pressed': String(V.view === k), onClick: () => { V.view = k; ctx.redraw(); } }, l))),
    h('button', { class: 'btn sm pri', disabled: ctx.readOnly, title: 'Get your Finviz Elite screeners', onClick: () => fvGetDialog(ctx) }, '⟳ Finviz'),
    h('button', { class: 'btn sm', 'aria-label': 'More', 'aria-haspopup': 'menu', title: 'More', onClick: (e) => { e.stopPropagation(); popMenu(e.currentTarget, 'More', [
      { label: 'Paste a scan', right: 'Ctrl+V', disabled: ctx.readOnly, fn: () => pasteFromButton(ctx) },
      { label: 'TJ Collect buttons', fn: () => collectHelp() },
      { label: 'Keyboard keys', fn: () => keysHelp() }]); } }, '⋯'));
}
function statusFilterMenu(ctx, anchor) {
  const st = ctx.store.state;
  const tog = (id) => { if (V.stF.has(id)) V.stF.delete(id); else V.stF.add(id); ctx.redraw(); setTimeout(() => { const b = [...document.querySelectorAll('.sc-quick .sc-qv')].at(-1); if (b) statusFilterMenu(ctx, b); }, 0); };
  popMenu(anchor, 'Status filter', [...SC.statusesOf(st).map((s) => ({ label: s.name, color: s.color, on: V.stF.has(s.id), fn: () => tog(s.id) })),
    { label: 'No status', cls: 'sep', on: V.stF.has('none'), fn: () => tog('none') },
    V.stF.size ? { label: 'Show all', cls: 'sep', fn: () => { V.stF.clear(); ctx.redraw(); } } : null]);
}

// ---------------------------------------------------------------- Filter (1.8.17, Finviz style: every column a ready row)
function setF(ctx, patch) { V.f = { ...V.f, ...patch }; ctx.redraw(); }
function setCol(ctx, c, x) { const cols = { ...V.f.cols }; if (x && SC.colActive(x)) cols[c] = x; else delete cols[c]; setF(ctx, { cols }); }
function filterArea(ctx, st, built, cols) {
  const chips = []; const chip = (text, off, grey = false) => h('span', { class: 'sc-fchip' + (grey ? ' grey' : ''), title: grey ? 'Not in what you see now: it is ignored here' : null }, text, h('button', { type: 'button', 'aria-label': 'Remove filter ' + text, onClick: () => { off(); ctx.redraw(); } }, '×'));
  const f = V.f; const has = (x) => x !== null && x !== undefined && x !== '';
  if (has(f.rsMin) || has(f.rsMax)) chips.push(chip(has(f.rsMin) && has(f.rsMax) ? `RS ${f.rsMin}–${f.rsMax}` : has(f.rsMin) ? `RS ≥ ${f.rsMin}` : `RS ≤ ${f.rsMax}`, () => { V.f = { ...V.f, rsMin: null, rsMax: null }; }));
  if (has(f.earnDays)) chips.push(chip(`No earnings ≤ ${f.earnDays} d`, () => { V.f = { ...V.f, earnDays: null }; }));
  for (const [c, x] of Object.entries(f.cols || {})) {
    if (!SC.colActive(x)) continue; const grey = !cols.includes(c);
    const t = x.is !== undefined ? `${c}: ${x.is}` : has(x.min) && has(x.max) ? `${c} ${x.min}–${x.max}` : has(x.min) ? `${c} ≥ ${x.min}` : `${c} ≤ ${x.max}`;
    chips.push(chip(grey ? t + ' (not here)' : t, () => { const cc = { ...V.f.cols }; delete cc[c]; V.f = { ...V.f, cols: cc }; }, grey));
  }
  if (!V.fOpen && !chips.length) return null;
  return h('div', { class: 'sc-filter' }, V.fOpen ? filterPanel(ctx, st, built, cols) : null,
    chips.length ? h('div', { class: 'sc-fchips', 'aria-label': 'Filters that are on' }, chips, h('button', { type: 'button', class: 'linkish', onClick: () => { V.f = { ...SC.emptyFilter(), q: V.f.q }; ctx.redraw(); } }, 'Clear all')) : null);
}
function filterPanel(ctx, st, built, cols) {
  const f = V.f; const rows = built.flatMap((b) => (b.s.open || V.tab === 'scans' ? b.s.v.rows : []));
  const fcols = SC.filterableCols(cols); const kinds = SC.colKinds(rows, fcols);
  const keys = keyColsOf(st, fcols); const rest = fcols.filter((c) => !keys.includes(c));
  const box = (val, label, on) => h('input', { class: 'sc-fnum', value: val ?? '', inputmode: 'decimal', 'aria-label': label, onChange: (e) => on(e.target.value.trim()) });
  const numRow = (label, x, set) => h('div', { class: 'sc-frow' }, h('span', { class: 'sc-flab' }, label), h('span', { class: 'sc-fin' }, 'from ', box(x?.min, label + ' from', (v) => set({ ...(x || {}), min: v })), ' to ', box(x?.max, label + ' to', (v) => set({ ...(x || {}), max: v }))));
  const colRow = (c) => {
    const x = f.cols?.[c]; const k = kinds[c];
    if (k?.kind === 'text') return h('div', { class: 'sc-frow' }, h('span', { class: 'sc-flab' }, c), h('select', { 'aria-label': c, onChange: (e) => setCol(ctx, c, e.target.value ? { is: e.target.value } : null) },
      h('option', { value: '' }, 'Any'), (k.options || []).map((o) => h('option', { value: o, selected: x?.is === o }, o))));
    return numRow(c, x, (y) => setCol(ctx, c, y));
  };
  const earn = h('input', { type: 'checkbox', checked: f.earnDays !== null && f.earnDays !== undefined && f.earnDays !== '', onChange: (e) => setF(ctx, { earnDays: e.target.checked ? 7 : null }) });
  return h('div', { class: 'sc-fpanel2' },
    h('div', { class: 'sc-fgrid' },
      numRow('RS', { min: f.rsMin, max: f.rsMax }, (y) => setF(ctx, { rsMin: y.min === '' || y.min === undefined ? null : y.min, rsMax: y.max === '' || y.max === undefined ? null : y.max })),
      h('div', { class: 'sc-frow' }, h('span', { class: 'sc-flab' }, 'Earnings'), h('label', { class: 'sc-fin' }, earn, ' hide if within ', box(f.earnDays ?? 7, 'Earnings days', (v) => setF(ctx, { earnDays: v === '' ? null : v })), ' days')),
      keys.map(colRow)),
    rest.length ? h('details', { class: 'sc-fmore' }, h('summary', null, `More columns (${rest.length})`), h('div', { class: 'sc-fgrid' }, rest.map(colRow))) : null,
    !fcols.length ? para('These stocks have no scanner columns to filter on.', 'note') : null,
    h('div', { class: 'sc-fline end' }, h('button', { type: 'button', class: 'btn sm', onClick: () => { V.fOpen = false; ctx.redraw(); } }, 'Done')));
}

// ---------------------------------------------------------------- the stock panel: tabs Scans | My lists | Status
const LOCAL_FOLD = {}; // read-only window: folding works on screen only
function fold(ctx, key, folded) { if (ctx.readOnly) LOCAL_FOLD[key] = folded; else ctx.act((d) => A.setScanFold(d, key, folded), { label: 'fold', noUndo: true }); ctx.redraw(); }
function panel(ctx, st, built, flat, info, today) {
  const ro = ctx.readOnly;
  const tabs = h('div', { class: 'sc-tabs', role: 'tablist', 'aria-label': 'What to show' }, [['scans', 'Scans'], ['lists', 'My lists'], ['status', 'Status']].map(([k, l]) =>
    h('button', { type: 'button', role: 'tab', class: V.tab === k ? 'on' : '', 'aria-selected': String(V.tab === k), onClick: () => { V.tab = k; if (k !== 'scans') V.q = 'all'; V.ticked = new Set(); V.sel = null; ctx.redraw(); } }, l)));
  const plus = h('button', { type: 'button', class: 'sc-plus', 'aria-label': 'Add', title: 'Add', disabled: ro, onClick: (e) => { e.stopPropagation(); addMenu(ctx, e.currentTarget); } }, '+');
  let head;
  if (V.tab === 'lists') {
    const f = currentList(st);
    head = h('div', { class: 'sc-phead' }, f ? h('button', { type: 'button', class: 'sc-listpick', 'aria-haspopup': 'menu', onClick: (e) => { e.stopPropagation(); listMenu(ctx, e.currentTarget, f); } }, f.name, h('span', { 'aria-hidden': 'true' }, ' ▾')) : h('span', { class: 'note' }, 'No lists yet'), h('span', { class: 'spacer' }), plus);
  } else head = h('div', { class: 'sc-phead' }, h('span', { class: 'note' }, V.tab === 'scans' ? 'Your scanners' : 'Your statuses'), h('span', { class: 'spacer' }), plus);
  const tickers = SC.finvizTickers(flat.map((x) => x.r.t));
  const act = h('div', { class: 'sc-lhd' },
    tickers.length ? h('a', { class: 'btn sm', href: SC.finvizListUrl(tickers), target: '_blank', rel: 'noopener', title: `Open these ${plural(tickers.length, 'stock')} in your Finviz Custom table` }, 'All in Finviz ↗') : h('button', { type: 'button', class: 'btn sm', disabled: true }, 'All in Finviz ↗'),
    h('button', { class: 'linkish', onClick: () => { V.selMode = !V.selMode; V.ticked = new Set(); ctx.redraw(); } }, V.selMode ? 'Done' : 'Select'));
  const secs = h('div', { class: 'sc-lis sc-secs', role: 'listbox', 'aria-label': 'Stocks' });
  for (const b of built) secs.append(block(ctx, st, b, info, secs));
  if (!built.length) secs.append(h('div', { class: 'empty' }, V.tab === 'lists' ? [h('b', null, 'No lists yet'), h('span', null, 'Click + to make your first list and its sections.')] : [h('b', null, 'No scanners yet'), h('span', null, 'Click ⟳ Finviz, or paste a scan with Ctrl + V.')]));
  return h('section', { class: 'card sc-list sc-panel' }, tabs, head, act, V.selMode ? selectBar(ctx, st, flat) : null, secs);
}
function block(ctx, st, b, info, secsEl) {
  const s = b.s; const v = s.v; const ro = ctx.readOnly;
  const count = s.kind === 'status' ? v.rows.length : v.rows.filter((r) => !r.rej).length;
  const right = [];
  if (s.kind === 'scanner' && v.picker && v.picker.options.length > 1) right.push(h('select', { class: 'sc-day', 'aria-label': 'Day of ' + s.title, title: 'Which day', onClick: (e) => e.stopPropagation(), onPointerdown: (e) => e.stopPropagation(), onChange: (e) => { V.day[s.key] = e.target.value; ctx.redraw(); } },
    v.picker.options.map((o) => h('option', { value: o.value, selected: o.value === v.picker.value }, o.label.replace(/ · \d+$/, '')))));
  else if (s.kind === 'scanner' && v.picker) right.push(h('span', { class: 'note sc-day1' }, v.picker.options[0].label.replace(/ · \d+$/, '')));
  right.push(h('span', { class: 'sc-cnt' }, s.kind === 'compare' ? `${v.inAll ?? 0} in all` : String(count)));
  const toggle = () => fold(ctx, s.key, s.open);
  const head = h('div', { class: 'sc-sec', onClick: (e) => { if (!e.target.closest('button, select, input')) toggle(); } },
    h('span', { class: 'sc-grip', 'aria-hidden': 'true' }, '⠿'),
    h('button', { type: 'button', class: 'sc-fold', 'aria-expanded': String(s.open), 'aria-label': (s.open ? 'Fold ' : 'Open ') + s.title, onClick: toggle }, s.open ? '▾' : '▸'),
    s.kind === 'status' ? dot(s.status.color) : null, s.kind === 'compare' ? h('span', { class: 'sc-cmp', title: 'Comparison' }, '⇄') : null,
    h('b', { class: 'sc-sect' + (s.kind === 'status' ? ' c-' + s.status.color : '') }, s.title),
    h('span', { class: 'sc-secr' }, right),
    ro ? null : h('button', { type: 'button', class: 'sc-more', 'aria-label': 'More for ' + s.title, title: 'More', onClick: (e) => { e.stopPropagation(); sectionMenu(ctx, st, s, e.currentTarget); } }, '⋯'));
  const el = h('div', { class: 'sc-block', 'data-key': s.key }, head);
  // drag the section by its head
  draggable(el, head, { zones: () => [secsEl], items: (z) => [...z.querySelectorAll(':scope > .sc-block, :scope > .sc-ph')],
    onDrop: (zone, next) => {
      const keys = [...zone.children].map((c) => (c.classList.contains('sc-ph') ? s.key : c.dataset.key)).filter(Boolean);
      let r = { ok: true };
      if (V.tab === 'scans') r = ctx.act((d) => A.setScanOrder(d, keys), { label: 'move scanner', now: true });
      else if (V.tab === 'lists') r = ctx.act((d) => A.placeSection(d, s.list.id, s.list.folder, next?.dataset.key?.slice(2) || null), { label: 'move section', now: true });
      else r = ctx.act((d) => A.moveStatus(d, s.status.id, keys.indexOf(s.key)), { label: 'move status', now: true });
      if (!r.ok) toast(r.error); ctx.redraw();
    } });
  if (!s.open) return el;
  if (s.kind === 'compare') {
    const N = v.N || 0; const pb = (k, label) => (k === 'some' && N < 3) ? null : h('button', { type: 'button', class: 'sc-qv' + ((V.part[s.cmp.id] || 'inall') === k ? ' on' : ''), onClick: () => { V.part[s.cmp.id] = k; ctx.redraw(); } }, label, h('span', { class: 'sc-n' }, SC.quickRows(v, k).filter((r) => !r.rej).length));
    el.append(v.missing?.length && N < 2 ? h('div', { class: 'note sc-sub' }, 'No scans yet for: ' + v.missing.join(', ')) : h('div', { class: 'sc-parts' }, pb('inall', 'In all'), pb('some', 'In some'), pb('one', 'Only one')));
  }
  const kind = s.kind === 'list' ? 'list' : s.kind === 'status' ? 'status' : 'scan';
  const zone = h('div', { class: 'sc-dz', 'data-kind': kind, 'data-id': s.kind === 'list' ? s.list.id : s.kind === 'status' ? s.status.id : s.key });
  for (const r of b.rows) zone.append(stockRow(ctx, st, r, s, info));
  if (!b.rows.length) zone.append(h('div', { class: 'note sc-none' }, s.kind === 'status' ? 'Drop a stock here.' : b.total ? 'No stock matches your filter.' : s.kind === 'list' ? 'No stocks yet.' : V.q === 'new' ? 'No new stocks.' : V.q === 'dropped' ? 'Nothing dropped.' : 'No stocks.'));
  if (b.noData) zone.append(h('div', { class: 'note sc-none' }, `${plural(b.noData, 'stock')} ${b.noData === 1 ? 'has' : 'have'} no data for this filter.`));
  if (b.rej || V.showRej[s.key]) zone.append(h('button', { type: 'button', class: 'sc-rejline', onClick: () => { V.showRej[s.key] = !V.showRej[s.key]; ctx.redraw(); } }, V.showRej[s.key] ? 'Hide rejected' : `${b.rej} rejected hidden`));
  if (s.kind === 'list' && !ro) zone.append(h('div', { class: 'sc-dzend' }, h('input', { class: 'sc-addin', placeholder: '+ Add ticker (e.g. NVDA, AAPL)', 'aria-label': 'Add tickers to ' + s.title,
    onKeydown: (e) => { if (e.key !== 'Enter') return; addTyped(ctx, s.list, e.target.value); } })));
  else zone.append(h('div', { class: 'sc-dzend' }));
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
function stockRow(ctx, st, r, s, info) {
  const m = r.mark; const ss = m ? SC.statusOf(st, m.st) : null; const x = info.get(r.t);
  const on = V.sel?.key === s.key && V.sel?.t === r.t; const v = s.v;
  let tag = null;
  if (s.kind === 'compare' && r.hits) tag = (V.part[s.cmp.id] || 'inall') === 'one' ? h('span', { class: 'sc-tag' }, v.runs[r.hits.indexOf(true)]?.scanner || '') : h('span', { class: 'sc-tag' + (r.n === v.N ? ' open' : ''), title: `Found in ${r.n} of ${v.N} scanners` }, `${r.n}/${v.N}`);
  const el = h('div', { class: 'sc-li sc-row1' + (on ? ' on' : '') + (r.rej ? ' rej' : ''), role: 'option', 'aria-selected': String(on), 'data-t': r.t, onClick: () => { V.sel = { t: r.t, key: s.key }; ctx.redraw(); } },
    V.selMode ? h('input', { type: 'checkbox', 'aria-label': 'Tick ' + r.t, checked: V.ticked.has(r.t), onClick: (e) => e.stopPropagation(), onChange: (e) => { if (e.target.checked) V.ticked.add(r.t); else V.ticked.delete(r.t); ctx.redraw(); } }) : null,
    h('span', { class: 'sc-flag c-' + (ss ? ss.color : 'none'), title: ss ? ss.name : 'No status' }),
    h('b', { class: 'sc-tkr' }, r.t), tag,
    r.isNew ? h('span', { class: 'sc-tag new' }, 'New') : null, r.isDropped ? h('span', { class: 'sc-tag drop' }, 'Dropped') : null,
    x?.open ? h('span', { class: 'sc-tag open', title: 'You hold this stock now' }, '●') : null,
    r.earnings && r.earnings.days >= 0 && r.earnings.days <= 7 ? h('span', { class: 'sc-tag earn', title: 'Earnings ' + dmy(r.earnings.iso) }, `E ${r.earnings.days}d`) : null,
    h('span', { class: 'sc-sp' }),
    ss && s.kind !== 'status' ? h('span', { class: 'sc-stw c-' + ss.color }, ss.name) : null,
    h('span', { class: 'sc-lirs' + (r.rs !== null && r.rs >= 80 ? ' sc-strong' : ''), title: 'RS (rank 1–99 inside the scan)' }, r.rs ?? '–'),
    h('button', { type: 'button', class: 'sc-stbtn sm', 'aria-haspopup': 'menu', 'aria-label': `Status and lists of ${r.t}`, disabled: ctx.readOnly, onClick: (e) => { e.stopPropagation(); V.sel = { t: r.t, key: s.key }; statusMenu(ctx, [r], e.currentTarget, s); } }, '▾'));
  if (s.kind === 'list') draggable(el, el, { zones: () => [...document.querySelectorAll('.sc-dz[data-kind="list"]')], items: (z) => [...z.querySelectorAll(':scope > .sc-li, :scope > .sc-ph')],
    onDrop: (zone, next) => { const to = zone.dataset.id; const res = ctx.act((d) => A.placeScanItem(d, s.list.id, to, r.t, next?.dataset.t || null, { date: ctx.today() }), { label: 'move ' + r.t, now: true }); if (!res.ok) toast(res.error); ctx.redraw(); } });
  if (s.kind === 'status') draggable(el, el, { zones: () => [...document.querySelectorAll('.sc-dz[data-kind="status"]')], items: (z) => [...z.querySelectorAll(':scope > .sc-li, :scope > .sc-ph')],
    onDrop: (zone) => { const to = zone.dataset.id; if (to === s.status.id) return ctx.redraw(); setStatus(ctx, [r], to); } });
  return el;
}
function selectBar(ctx, st, flat) {
  const n = V.ticked.size; const rows = []; const seen = new Set(); for (const x of flat) if (V.ticked.has(x.r.t) && !seen.has(x.r.t)) { seen.add(x.r.t); rows.push(x.r); }
  return h('div', { class: 'sc-actbar sel' }, h('b', null, `${n} ticked`),
    h('button', { class: 'btn sm', disabled: !n || ctx.readOnly, onClick: (e) => { e.stopPropagation(); statusMenu(ctx, rows, e.currentTarget, null, () => { V.ticked = new Set(); }); } }, 'Status / list ▾'),
    h('button', { class: 'linkish', onClick: () => { V.ticked = new Set(flat.map((x) => x.r.t)); ctx.redraw(); } }, `Tick all ${new Set(flat.map((x) => x.r.t)).size}`),
    n ? h('button', { class: 'linkish', onClick: () => { V.ticked = new Set(); ctx.redraw(); } }, 'Clear') : null);
}

// ---------------------------------------------------------------- + and ⋯ menus
function addMenu(ctx, anchor) {
  if (V.tab === 'scans') return popMenu(anchor, 'Add', [
    { label: 'Get scans from Finviz', right: '⟳ Finviz', fn: () => fvGetDialog(ctx) },
    { label: 'Paste a scan', right: 'Ctrl+V', fn: () => pasteFromButton(ctx) },
    SC.runsByScanner(ctx.store.state).length >= 2 ? { label: 'New comparison', cls: 'sep', fn: () => compareDialog(ctx, null) } : null]);
  if (V.tab === 'lists') return popMenu(anchor, 'Add', [
    currentList(ctx.store.state) ? { label: 'New section', fn: () => newSectionDialog(ctx) } : null,
    { label: 'New list', cls: currentList(ctx.store.state) ? 'sep' : '', fn: () => newListDialog(ctx) }]);
  return newStatusDialog(ctx);
}
function listMenu(ctx, anchor, f) {
  const st = ctx.store.state; const secs = st.scans.lists.filter((l) => l.folder === f.id);
  popMenu(anchor, 'Lists', [...st.scans.folders.map((x) => ({ label: x.name, on: x.id === f.id, right: String(st.scans.lists.filter((l) => l.folder === x.id).length), fn: () => { V.list = x.id; try { localStorage.setItem('tj-scans-list', x.id); } catch { /* fine */ } V.sel = null; ctx.redraw(); } })),
    ctx.readOnly ? null : { label: 'Rename this list', cls: 'sep', fn: () => nameDialog(ctx, `Rename ${f.name}`, f.name, (d, x) => A.renameScanFolder(d, f.id, x)) },
    { label: 'Download for TradingView', cls: ctx.readOnly ? 'sep' : '', disabled: !secs.some((l) => l.items.length), fn: () => downloadSections(ctx, f.name, secs) },
    ctx.readOnly ? null : { label: 'Delete this list…', cls: 'rej', fn: () => deleteFolderDialog(ctx, f, secs) }]);
}
function sectionMenu(ctx, st, s, anchor) {
  if (s.kind === 'scanner') { const v = s.v; return popMenu(anchor, s.title, [
    { label: 'Rename', fn: () => renameScannerDialog(ctx, s.name) },
    v.run ? { label: 'Delete this day…', fn: () => deleteRunDialog(ctx, v.run) } : null,
    { label: 'Delete the scanner…', cls: 'rej', fn: () => deleteScannerDialog(ctx, s.name) }]); }
  if (s.kind === 'compare') return popMenu(anchor, s.title, [
    { label: 'Change…', fn: () => compareDialog(ctx, s.cmp) },
    { label: 'Delete…', cls: 'rej', fn: () => deleteCompareDialog(ctx, s.cmp) }]);
  if (s.kind === 'list') { const l = s.list; const stale = A.staleInList(st, l); return popMenu(anchor, s.title, [
    { label: 'Rename', fn: () => nameDialog(ctx, `Rename ${l.name}`, l.name, (d, x) => A.renameScanList(d, l.id, x)) },
    stale.length ? { label: `Clean up ${stale.length}…`, fn: () => cleanUpDialog(ctx, l, new Set(stale)) } : null,
    { label: 'Download for TradingView', disabled: !l.items.length, fn: () => downloadOne(ctx, l) },
    { label: 'Delete…', cls: 'rej', fn: () => deleteListDialog(ctx, l) }]); }
  const x = s.status; return popMenu(anchor, s.title, [
    { label: 'Rename', fn: () => nameDialog(ctx, `Rename ${x.name}`, x.name, (d, n) => A.renameStatus(d, x.id, n)) },
    { label: 'Colour', right: COLOR_NAME[x.color] || '', fn: () => setTimeout(() => popMenu(anchor, 'Colour', STATUS_COLORS.map((c) => ({ label: COLOR_NAME[c], color: c, on: x.color === c, fn: () => { const r = ctx.act((d) => A.setStatusColor(d, x.id, c), { label: 'colour', now: true }); if (!r.ok) toast(r.error); ctx.redraw(); } }))), 0) },
    x.rej ? null : { label: 'Delete…', cls: 'rej', fn: () => deleteStatusDialog(ctx, x) }]);
}

// ---------------------------------------------------------------- chart view: chart + key values
function chartPanel(ctx, st, cur, info, today) {
  if (!cur) return h('section', { class: 'card sc-chart' }, h('div', { class: 'empty' }, h('b', null, 'No stock selected'), h('span', null, 'Pick a stock in the list.')));
  const r = cur.r; const v = cur.s.v; const m = r.mark; const ss = m ? SC.statusOf(st, m.st) : null; const lists = SC.listsOf(st, r.t);
  const keyCols = keyColsOf(st, v.cols);
  return h('section', { class: 'card sc-chart', 'aria-label': 'Chart of ' + r.t },
    h('div', { class: 'sc-chd' },
      h('div', { class: 'sc-cht' }, h('b', { class: 'sc-big' }, r.t), h('span', { class: 'note' }, (r.full?.includes(':') ? r.full.split(':')[0] : '') + (r.rs !== null ? ` · RS ${r.rs}` : '')),
        cur.s.kind === 'compare' && r.n ? h('span', { class: 'note' }, ` · in ${r.n} of ${v.N}`) : null, ...marks(st, r, info, today),
        ss ? h('span', { class: 'sc-stw big c-' + ss.color }, dot(ss.color), ss.name) : null,
        h('span', { class: 'sc-actnote note' }, m ? `since ${dmy(m.date)}${ss?.rej && reasonNames(st, m) ? ' · ' + reasonNames(st, m) : ''}` : '', lists.length ? ` · in ${lists.map((l) => l.name).join(', ')}` : '')),
      h('div', { class: 'row', style: { gap: '6px' } },
        h('button', { type: 'button', class: 'btn sm', title: 'Add to one of your lists', 'aria-label': 'Add ' + r.t + ' to a list', disabled: ctx.readOnly, onClick: (e) => { e.stopPropagation(); addToListMenu(ctx, e.currentTarget, [r]); } }, '+'),
        h('a', { class: 'btn sm', href: fvUrl(r), target: '_blank', rel: 'noopener' }, 'Open in Finviz ↗'))),
    h('div', { id: 'sc-chart-ph', class: 'sc-chart-ph', 'data-symbol': r.full?.includes(':') ? r.full : r.t }, h('span', { class: 'note' }, 'Loading the TradingView chart…')),
    h('div', { class: 'sc-keys' }, keyCols.map((c) => h('span', null, h('span', { class: 'note' }, c + ' '), h('b', null, r.vals?.[c] || '–'))),
      v.cols.length ? h('button', { type: 'button', class: 'sc-iconbtn', 'aria-label': 'Choose the key values', title: 'Choose the key values', onClick: () => keyColsDialog(ctx, v.cols, keyCols) }, '⚙') : null));
}
function keyColsOf(st, cols) {
  const saved = (st.scans.keyCols || []).filter((c) => cols.includes(c)); if (st.scans.keyCols) return saved;
  const out = []; for (const re of SC.KEY_DEFAULT) { const c = cols.find((x) => re.test(x) && !out.includes(x)); if (c) out.push(c); } return out;
}
function keyColsDialog(ctx, cols, shown) {
  const boxes = cols.map((c) => [c, h('input', { type: 'checkbox', checked: shown.includes(c) })]);
  dialog({ title: 'Key values under the chart', ok: 'Show', body: h('div', { class: 'sc-cols' }, para('Up to 6, from your scanner columns. They also come first in Filter.', 'note'), boxes.map(([c, b]) => h('label', null, b, ' ', c))),
    onOk: () => { const p = boxes.filter(([, b]) => b.checked).map(([c]) => c); if (p.length > 6) return 'Choose 6 at most.'; const r = ctx.act((d) => A.setScanKeyCols(d, p), { label: 'key values', now: true }); return r.ok ? true : r.error; } });
}

// ---------------------------------------------------------------- Table view (all columns of the section you are in)
function tablePanel(ctx, st, built, cur, info, today) {
  const b = built.find((x) => x.s.key === cur?.key) || built.find((x) => x.s.open) || null;
  if (!b) return h('section', { class: 'card sc-mid' }, h('div', { class: 'empty' }, h('b', null, 'Nothing to show'), h('span', null, 'Open a section in Chart view first.')));
  const v = b.s.v; const shown = shownCols(st, v.cols); const rows = b.rows;
  const parts = [h('div', { class: 'sc-tbtop' }, h('span', null, h('b', null, b.s.title), h('span', { class: 'note' }, ' · ' + plural(rows.length, 'stock'))), h('div', { class: 'row' },
    h('button', { class: 'btn sm' + (V.selMode ? ' pri' : ''), onClick: () => { V.selMode = !V.selMode; V.ticked = new Set(); ctx.redraw(); } }, V.selMode ? 'Done selecting' : 'Select'),
    h('button', { class: 'btn sm', onClick: () => colsDialog(ctx, v.cols, shown) }, 'Columns'),
    rows.length ? h('a', { class: 'btn sm', href: SC.finvizListUrl(rows.map((r) => r.t)), target: '_blank', rel: 'noopener' }, 'All in Finviz ↗') : null))];
  if (V.selMode) parts.push(selectBar(ctx, st, rows.map((r) => ({ r, key: b.s.key, s: b.s }))));
  if (!rows.length) { parts.push(h('div', { class: 'empty' }, h('b', null, 'No stocks here'))); return h('section', { class: 'card sc-mid' }, parts); }
  const head = h('tr', null, V.selMode ? h('th', { class: 'sc-tk' }, '') : null, h('th', null, 'Stock'), h('th', { class: 'r', title: 'RS: strength over 3, 6 and 12 months, ranked 1–99 against every stock in the scans shown.' }, 'RS'),
    b.s.kind === 'compare' ? v.runs.map((x) => h('th', { class: 'sc-hit', title: `${x.scanner} · ${SC.runLabel(st, x, today)}` }, h('span', { class: 'sc-hitn' }, x.scanner), h('span', { class: 'sc-hitd' }, SC.runLabel(st, x, today)))) : null,
    shown.map((c) => h('th', { class: 'r' }, c)), h('th', null, 'Status'));
  const body = rows.map((r) => h('tr', { class: 'sc-row' + (r.t === cur?.r.t ? ' on' : '') + (r.rej ? ' rej' : ''), onClick: () => { V.sel = { t: r.t, key: b.s.key }; ctx.redraw(); }, onDblclick: () => { V.sel = { t: r.t, key: b.s.key }; V.view = 'chart'; ctx.redraw(); } },
    V.selMode ? h('td', { class: 'sc-tk', onClick: (e) => e.stopPropagation() }, h('input', { type: 'checkbox', 'aria-label': 'Tick ' + r.t, checked: V.ticked.has(r.t), onChange: (e) => { if (e.target.checked) V.ticked.add(r.t); else V.ticked.delete(r.t); ctx.redraw(); } })) : null,
    h('td', null, h('div', { class: 'sc-sym' }, h('b', null, r.t), r.isNew ? h('span', { class: 'sc-tag new' }, 'New') : null, r.isDropped ? h('span', { class: 'sc-tag drop' }, 'Dropped') : null,
      SC.listsOf(st, r.t).length ? h('span', { class: 'sc-tag list', title: 'In your lists: ' + SC.listsOf(st, r.t).map((l) => l.name).join(', ') }, '≡ ' + SC.listsOf(st, r.t).length) : null, ...marks(st, r, info, today))),
    h('td', { class: 'r' + (r.rs !== null && r.rs >= 80 ? ' sc-strong' : '') }, r.rs ?? '–'),
    r.hits && b.s.kind === 'compare' ? r.hits.map((x) => h('td', { class: 'sc-hit' + (x ? ' yes' : '') }, x ? '●' : '○')) : null,
    shown.map((c) => h('td', { class: 'r' }, r.vals?.[c] || '–')),
    h('td', { class: 'sc-stcell' }, h('button', { type: 'button', class: 'sc-stbtn', 'aria-haspopup': 'menu', 'aria-label': `Status of ${r.t}`, disabled: ctx.readOnly, onClick: (e) => { e.stopPropagation(); V.sel = { t: r.t, key: b.s.key }; statusMenu(ctx, [r], e.currentTarget, b.s); } }, statusText(st, r.mark), h('span', { class: 'sc-caret', 'aria-hidden': 'true' }, '▾')))));
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
  if (!cols.length) return dialog({ title: 'No columns', info: true, body: para('These stocks have no scanner columns. Scans from Finviz or TJ Collect bring every column of your view.', '') });
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
  const s = m ? SC.statusOf(st, m.st) : null;
  if (!s) return h('span', { class: 'sc-st new' }, 'No status');
  const reasons = s.rej ? reasonNames(st, m) : '';
  return h('span', { class: 'sc-stw c-' + s.color, title: `${s.name} on ${dmy(m.date)}${reasons ? ' · ' + reasons : ''}` }, dot(s.color), s.name, reasons ? h('span', { class: 'sc-why' }, ' · ' + reasons) : null);
}
const reasonNames = (st, m) => [...(m.reasons || []).map((id) => st.rejects.find((x) => x.id === id)?.name).filter(Boolean), m.other || ''].filter(Boolean).join(', ');
// the ▾ on a stock (or Select): his statuses, No status, Add to list, Remove from this section
function statusMenu(ctx, rows, anchor, s, after) {
  const st = ctx.store.state; const one = rows.length === 1 ? rows[0] : null; const cur = one?.mark?.st || null;
  popMenu(anchor, one ? `Status of ${one.t}` : `${rows.length} stocks`, [
    { head: 'Status' },
    ...SC.statusesOf(st).map((x) => ({ label: x.name + (x.rej ? '…' : ''), color: x.color, on: cur === x.id, fn: () => { setStatus(ctx, rows, x.id); after?.(); } })),
    rows.some((r) => r.mark) ? { label: 'No status', cls: 'none', fn: () => { clearStatus(ctx, rows); after?.(); } } : null,
    { label: 'Add to list…', cls: 'sep', fn: () => setTimeout(() => addToListMenu(ctx, anchor, rows, after), 0) },
    s?.kind === 'list' && one ? { label: `Remove from ${s.list.name}`, cls: 'rej', fn: () => { const r = ctx.act((d) => A.removeFromScanList(d, s.list.id, [one.t]), { label: `remove ${one.t}`, now: true }); if (r.ok) toast(`${one.t} removed from ${s.list.name}.`, 'Undo', () => ctx.store.undo()); else toast(r.error); ctx.redraw(); } } : null]);
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

// ---------------------------------------------------------------- add to a list (▾ on a stock, + above the chart, Select)
function addToListMenu(ctx, anchor, rows, after) {
  if (ctx.readOnly || !rows.length) return;
  const sc = ctx.store.state.scans; const items = [];
  for (const f of sc.folders) { const secs = sc.lists.filter((l) => l.folder === f.id); items.push({ head: f.name });
    for (const l of secs) items.push({ label: l.name, on: rows.every((r) => l.items.some((y) => y.t === SC.tickerOf(r.t))), right: String(l.items.length), fn: () => addToSection(ctx, l, rows, after) }); }
  items.push(sc.folders.length ? { label: 'New section…', cls: 'sep', fn: () => newSectionDialog(ctx, rows, after) } : { label: 'New list…', fn: () => newListDialog(ctx, rows, after) });
  popMenu(anchor, 'Add to list', items);
}
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
async function newSectionDialog(ctx, rows, after) {
  const st = ctx.store.state; const f = currentList(st); if (!f) return newListDialog(ctx, rows, after);
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
  if (!ok) return; V.stF.delete(x.id); const r = ctx.act((d) => A.deleteStatus(d, x.id), { label: 'delete status', now: true }); if (r.ok) toast(`${x.name} moved to the Trash.`, 'Undo', () => ctx.store.undo()); else toast(r.error); ctx.redraw();
}

// ---------------------------------------------------------------- scanners and comparisons
async function renameScannerDialog(ctx, name) {
  const inp = h('input', { value: name, 'aria-label': 'Scanner name', maxlength: '60' }); setTimeout(() => inp.select(), 0);
  let to = null;
  await dialog({ title: `Rename ${name}`, ok: 'Rename', body: h('div', { style: { display: 'grid', gap: '8px' } }, field('Name', inp), para('Use the same name as in TradingView, so TJ Collect files new scans under it.', 'note')),
    onOk: () => { const r = ctx.act((d) => A.renameScanner(d, name, inp.value), { label: 'rename scanner', now: true }); if (r.ok) to = inp.value.trim(); return r.ok ? true : r.error; } });
  if (to && V.day['S:' + name]) { V.day['S:' + to] = V.day['S:' + name]; delete V.day['S:' + name]; } ctx.redraw();
}
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


// open the Scans tab on one scanner / comparison (after a paste, a Finviz fetch, a new comparison)
function focusKey(ctx, key, run = null) {
  V.tab = 'scans'; V.q = 'all'; V.sel = { key, t: null }; if (key.startsWith('S:')) { if (run) V.day[key] = run; else delete V.day[key]; }
  if (ctx.store.state.scans.fold?.[key] !== false && (key.startsWith('C:') || ctx.store.state.scans.fold?.[key])) ctx.act((d) => A.setScanFold(d, key, false), { label: 'fold', noUndo: true });
  ctx.redraw();
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
  for (let i = 0; i < pick.length; i++) {
    const x = pick[i]; toast(`Getting ${x.name} (${i + 1} of ${pick.length})…`, null, null, 20000);
    const r = await fvFetch(helper, x.q);
    if (!r.ok) { failed.push(`${x.name}: ${r.error}`); continue; }
    if (!r.rows.length) { failed.push(`${x.name}: no stocks today`); ctx.act((d) => A.markFvFetched(d, x.id, today), { label: 'fetched', now: true, noUndo: true }); continue; }
    const res = ctx.act((d) => { const a = A.addScanRun(d, { scanner: x.name, date: today, cols: r.cols, rows: r.rows, shown: r.rows.length }, { replace: true, today }); if (a.ok) A.markFvFetched(d, x.id, today); return a; }, { label: 'Finviz ' + x.name, now: true });
    if (res.ok) done.push(`${x.name} ${r.rows.length}`); else failed.push(`${x.name}: ${res.error}`);
  }
  if (done.length) focusKey(ctx, 'S:' + pick.find((x) => done.some((d) => d.startsWith(x.name + ' '))).name); else ctx.redraw();
  if (failed.length) dialog({ title: done.length ? 'Some screeners did not come' : 'Nothing came from Finviz', info: true, body: h('div', { style: { display: 'grid', gap: '6px' } }, done.length ? para('Got: ' + done.join(' · '), '') : null, h('ul', { class: 'sc-ul' }, failed.map((f) => h('li', null, f)))) });
  else toast(`Got from Finviz: ${done.join(' · ')}.`, null, null, 7000);
}
