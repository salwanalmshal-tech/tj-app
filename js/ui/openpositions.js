// Open positions: the daily workspace. Look from the UX/UI specification; content, names and rules from the agreed decisions.
// Hierarchy: page header + the account numbers he ticked on the Dashboard (1.5.1: up to 4, dragged into his own order here), then "All open positions" as cards straight on the page (1.2.1) with
// filters and an Auto | Drag and drop order switch. A card opens the daily detail panel. All numbers come from calc.js / marks.js.
import { h, dialog, para, toast, money, pctTxt, qtyTxt, priceTxt, numClass, dmy, num, changeTable, infoBtn, pill, datePicker } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';
import * as M from '../marks.js';
import * as A from '../actions.js';
import { diffDays } from '../dates.js';
import { editTrade } from './tradeforms.js';
import { dragItems } from './dashboard.js';
import { swapButton, blockEl as placedBlock } from './place.js';

export const usd = (a) => (a === null || a === undefined ? '–' : (a < 0n ? '−$' : '$') + money(D.abs(a)));
export const susd = (a) => (a === null || a === undefined ? '–' : (a > 0n ? '+$' : a < 0n ? '−$' : '$') + money(D.abs(a)));
const spct = (a, dp = 1) => (a === null || a === undefined ? '–' : (a > 0n ? '+' : '') + pctTxt(a, dp));
const rTxt = (r) => (r === null || r === undefined ? '–' : (r > 0n ? '+' : '') + D.fmt(r, 2) + ' R');
const STATUS_TEXT = { act: 'Act now', rev: 'Review', ok: 'On plan' };
const ORDER = { act: 0, rev: 1, ok: 2 };
const isMissing = (marks) => marks.some((m) => m.code.startsWith('missing-')); // by the fixed code (1.5.7)
let filter = 'all'; // all | attention | missing

export function lines(st, today) {
  const account = C.estimatedAccount(st);
  return C.openTrades(st).map((t) => {
    const marks = M.lineMarks(st, t, today, account);
    return { t, sym: A.symbolOf(st, t), m: C.lineMetrics(st, t, account), marks, status: M.lineStatus(marks), exc: marks.filter(M.isException) };
  }).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.sym.localeCompare(b.sym) || (a.t.seq ?? 0) - (b.t.seq ?? 0));
}
// In market / Cash as one bar (Q4): blue = in market, light grey = cash; the bigger value gets the bigger part.
function marketCard(inMarket, value, account) {
  const why = `How much of your account (${usd(account)}) is in open trades at the last price (${usd(value)}). Cash = the rest.`;
  const head = h('span', { class: 'eyebrow' }, 'In market / Cash', infoBtn('In market / Cash', why));
  if (inMarket === null) return h('div', { class: 'metric' }, head, h('span', { class: 'v' }, '–'));
  const p = Math.max(0, Math.min(100, Number(inMarket) / Number(D.SCALE)));
  const cash = D.sub(D.d('100'), inMarket);
  // both values are always written on the bar; a small part keeps a minimum width so its value stays readable
  const seg = (cls, w, label, v) => h('div', { class: 'mseg ' + cls, style: { flex: `${w} 1 0`, minWidth: w > 0 ? '58px' : '0' }, title: `${label} ${pctTxt(v, 1)}` }, w >= 30 ? h('span', { class: 'ml' }, label) : null, h('b', null, pctTxt(v, 1)));
  return h('div', { class: 'metric' }, head,
    h('div', { class: 'mbar', role: 'img', 'aria-label': `In market ${pctTxt(inMarket, 1)}, cash ${pctTxt(cash, 1)}` }, p > 0 ? seg('in', p, 'In market', inMarket) : null, p < 100 ? seg('cash', 100 - p, 'Cash', cash) : null),
    h('span', { class: 'd' }, `${usd(value)} in the market`));
}

export function render(ctx) {
  const st = ctx.store.state; const today = ctx.today();
  const account = C.estimatedAccount(st);
  const all = lines(st, today);
  const capital = C.capitalNow(st);
  const openPL = all.reduce((a, l) => a + (l.m.openPL ?? 0n), 0n);
  const loss = C.lossIfAllStopsHit(st);
  const value = all.reduce((a, l) => a + (l.m.value ?? 0n), 0n);
  const inMarket = account > 0n ? D.pct(value, account) : null;
  const noStop = all.filter((l) => num(l.t.currentStop) === null).length;

  const wrap = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } });
  wrap.append(h('header', { class: 'pg-head' },
    h('div', null, h('div', { class: 'eyebrow' }, 'Daily workspace'), h('h1', null, 'Open positions'), h('p', { class: 'lead' }, 'Start with the trades that need attention.')),
    h('div', { class: 'acts' }, h('button', { class: 'btn pri big', disabled: ctx.readOnly || !st.capital.start, onClick: () => ctx.go('open-trade') }, '+ Open trade'))));

  if (!st.capital.start) wrap.append(h('div', { class: 'msg warn' }, '◆ Capital is not set yet. ', h('a', { href: '#/capital', onClick: (e) => { e.preventDefault(); ctx.go('capital'); } }, 'Set the start capital first.')));

  // The account numbers = the Dashboard number cards he ticked "On Open positions" (max 4), in the order he dragged them here.
  const metric = (label, why, v, cls, d) => h('div', { class: 'metric' }, h('span', { class: 'eyebrow' }, label, infoBtn(label, why)), h('span', { class: 'v ' + (cls || '') }, v), d ? h('span', { class: 'd' }, d) : null);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ofCap = (v, cap) => (cap > 0n ? spct(D.pct(v, cap)) : '–');
  const METRIC = {
    capital: () => metric('Capital (closed trades)', `Start capital, plus deposits and dividends, minus withdrawals, plus the result of every sale. Open trades are not in it. Now: ${usd(capital)}.`, usd(capital), '', 'Start capital, deposits, dividends and sales'),
    openpl: () => metric('Open P&L', `What all open trades would win or lose if sold at the last price. Commissions are counted when you sell. Now: ${susd(openPL)} on ${all.length} trade${all.length === 1 ? '' : 's'}.`, susd(openPL), numClass(openPL), `${all.length} open trade${all.length === 1 ? '' : 's'}`),
    loss: () => { const fh = C.lossFromHighest(st); const el = metric('Loss if all stops hit', `From today: what you lose from today's prices if every open trade sells at its Current stop, next to your whole account (${usd(account)}). From highest: the same, but from each trade's Highest price, so it also counts the profit already given back since the top. Trades without a stop are not counted.`, susd(loss.loss), loss.loss < 0n ? 'neg' : '', (loss.pctOfAccount === null ? '' : `${pctTxt(D.abs(loss.pctOfAccount))} of account estimate`) + (noStop ? ` · ${noStop} without stop` : ''));
      // 1.7.3 (his wish, 2nd look): the card stays as it was; one small line in the bottom right corner, from the Highest price
      el.append(h('span', { class: 'm-corner' }, 'From highest price ', h('span', null, fh.pctOfAccount === null ? '–' : pctTxt(D.abs(fh.pctOfAccount))), h('b', { class: fh.loss < 0n ? 'neg' : '' }, susd(fh.loss))));
      return el; },
    market: () => marketCard(inMarket, value, account),
    progress: () => { const pr = C.progress(st);
      return metric('Result vs money put in', `Your sale results and dividends, next to everything you put in (start capital and deposits). Withdrawals never count as a loss. Now: ${susd(pr.result)} on ${usd(pr.invested)}.`, pr.pct === null ? '–' : spct(pr.pct), pr.pct === null ? '' : numClass(pr.pct), `${susd(pr.result)} on ${usd(pr.invested)} put in`); },
    month: () => { const k = today.slice(0, 7); const v = C.monthResult(st, k); const cap = C.periodBaseCapital(st, k + '-01', today);
      return metric('This month', `The result of the sales made this month, next to your capital on the 1st. Now: ${susd(v)}.`, susd(v), numClass(v), `${ofCap(v, cap)} of capital on 1 ${MON[Number(k.slice(5)) - 1]}`); },
    year: () => { const y = today.slice(0, 4); const v = C.yearResult(st, y); const cap = C.periodBaseCapital(st, y + '-01-01', y + '-12-31'); const late = !!st.capital.start && st.capital.start.date > y + '-01-01';
      return metric('This year', `The result of the sales made this year, next to your capital on 1 January. Now: ${susd(v)}.`, susd(v), numClass(v), `${ofCap(v, cap)} of capital on ${late ? dmy(st.capital.start.date) + ' (start)' : '1 Jan'}`); },
  };
  // 1.7.0: the number cards (max 4) and any blocks or reports come from the Open positions list in Reports;
  // always draggable here, like before. The position cards below are fixed (never switched off).
  const pl = C.placement(st, 'open'); const pins = pl.cards.map((id) => id.slice(2));
  if (pins.length) {
    const canMove = !ctx.readOnly && pins.length > 1;
    const row = h('section', { class: `metrics n${pins.length}` + (canMove ? ' canmove' : ''), 'aria-label': 'Account' }, pins.map((k) => { const el = METRIC[k](); el.dataset.id = 'c.' + k; if (canMove) el.title = 'Drag to change the order'; el.classList.add('pl-card'); el.append(swapButton(ctx, 'open', 'c.' + k)); return el; }));
    if (canMove) dragItems(row, '.metric', (ids) => ctx.act((d) => A.orderShown(d, 'open', 'card', ids), { label: 'account card order', now: true }));
    wrap.append(row);
  }
  if (pl.blocks.length) {
    const grid = h('section', { class: 'pl-grid', 'aria-label': 'Reports' }, pl.blocks.map((id) => { const b = placedBlock(ctx, id, {}); if (!b) return null; b.dataset.id = id; b.classList.add('pl-blk'); b.append(swapButton(ctx, 'open', id)); return b; }).filter(Boolean));
    if (!ctx.readOnly && pl.blocks.length > 1) dragItems(grid, '.pl-blk', (ids) => ctx.act((d) => A.orderShown(d, 'open', 'block', ids), { label: 'Open positions block order', now: true }));
    wrap.append(grid);
  }
  if (!ctx.readOnly && (pl.cards.join() !== C.standardOrder(pl.cards, 'open').join() || pl.blocks.join() !== C.standardOrder(pl.blocks, 'open').join()))
    wrap.append(h('div', { class: 'pl-reset' }, h('button', { class: 'linkbtn', type: 'button', onClick: () => ctx.act((d) => A.resetShownOrder(d, 'open'), { label: 'Open positions order reset', now: true }) }, 'Reset order'), h('span', { class: 'note' }, ' · cards and reports go back to their usual order; nothing is switched on or off')));

  if (!all.length) {
    wrap.append(h('section', { class: 'card' }, h('div', { class: 'card-b', style: { paddingTop: '22px' } }, h('div', { class: 'calm' }, '✓ You have no open trades.'))));
    return wrap;
  }

  // ---- All open positions as cards, straight on the page (1.2.1: the separate "Needs your attention" slider is removed;
  // the cards, their status and the "Needs attention" filter show it). Order: Auto (most urgent first) or his own (drag and drop).
  const exc = all.filter((l) => l.status !== 'ok');
  const nAtt = exc.length, nMiss = all.filter((l) => isMissing(l.marks)).length;
  if (filter === 'attention' && !nAtt || filter === 'missing' && !nMiss) filter = 'all';
  const shown = filter === 'attention' ? exc : filter === 'missing' ? all.filter((l) => isMissing(l.marks)) : all;
  const chip = (key, label, n) => h('button', { class: 'chip', 'aria-pressed': String(filter === key), onClick: () => { filter = key; ctx.redraw(); } }, `${label} · ${n}`);
  const lay = st.layouts?.openCards || {}; const mode = lay.mode === 'drag' ? 'drag' : 'auto';
  const autoSort = (list) => [...list].sort((a, b) => CS_ORDER[M.cardStatus(a.marks)] - CS_ORDER[M.cardStatus(b.marks)] || a.sym.localeCompare(b.sym) || (a.t.seq ?? 0) - (b.t.seq ?? 0));
  const cardsSorted = mode === 'drag' ? ownOrder(shown, lay.order || []) : autoSort(shown);
  const canDrag = mode === 'drag' && filter === 'all' && !ctx.readOnly;
  const setLayout = (patch, label) => ctx.act((d) => { d.layouts ??= {}; d.layouts.openCards = { ...(d.layouts.openCards || {}), ...patch }; return { ok: true }; }, { label, now: true });
  const seg = (key, label) => h('button', { class: 'seg-b', 'aria-pressed': String(mode === key), disabled: ctx.readOnly, onClick: () => { if (mode !== key) setLayout(key === 'drag' && !lay.order?.length ? { mode: key, order: autoSort(all).map((l) => l.t.id) } : { mode: key }, 'card order mode'); } }, label);
  const grid = h('div', { class: 'pcards' + (canDrag ? ' dragmode' : '') }, cardsSorted.map((l) => posCard(ctx, l, today)));
  if (canDrag) dragCards(grid, (ids) => setLayout({ order: ids }, 'card order'));
  const totPL = shown.reduce((a, l) => a + (l.m.openPL ?? 0n), 0n);
  wrap.append(h('section', { class: 'cards-sec', 'aria-label': 'All open positions' },
    h('div', { class: 'cards-head' }, h('h2', null, 'All open positions'),
      h('div', { class: 'row' }, chip('all', 'All', all.length), nAtt ? chip('attention', 'Needs attention', nAtt) : null, nMiss ? chip('missing', 'Missing data', nMiss) : null,
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Card order' }, seg('drag', 'Drag and drop'), seg('auto', 'Auto')),
        h('button', { class: 'btn', disabled: ctx.readOnly, onClick: () => updatePrices(ctx, all.map((l) => l.t)) }, 'Update prices'))),
    mode === 'drag' && filter !== 'all' ? h('div', { class: 'note' }, 'Your own order. Select “All” to move cards.') : null,
    grid,
    h('div', { class: 'cards-foot' }, h('span', null, `${shown.length} trade${shown.length === 1 ? '' : 's'}${filter === 'all' ? '' : ' (filtered)'} · Open P&L `, h('b', { class: numClass(totPL) }, susd(totPL)), ' · Loss if all stops hit ', h('b', { class: 'neg' }, susd(loss.loss)), noStop ? ` · ${noStop} trade${noStop === 1 ? '' : 's'} without a stop ${noStop === 1 ? 'is' : 'are'} not counted` : ''),
      h('span', null, `In market ${pctTxt(inMarket, 1)}`))));
  return wrap;
}

// His own order (drag and drop): lines not in the saved order yet (new trades) come first, newest on top.
function ownOrder(list, order) {
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...list].sort((a, b) => {
    const pa = pos.get(a.t.id), pb = pos.get(b.t.id);
    if (pa === undefined && pb === undefined) return (b.t.seq ?? 0) - (a.t.seq ?? 0);
    if (pa === undefined) return -1; if (pb === undefined) return 1;
    return pa - pb;
  });
}
// Smooth mouse drag and drop of the cards (agreed 2026-11-06): the dragged card follows the mouse fully visible,
// slightly lifted with a soft shadow; the other cards slide gently aside to show where it will land.
// A short click (no movement) still opens the line; a click right after a drag is ignored.
// 2026-11-06 refinement: slower, softer motion; the place is decided by the MIDDLE of the dragged card (not the mouse),
// only when it is well inside another card; one move at a time (no new move while the cards are still sliding)
const DRAG_START_PX = 6, SLIDE_MS = 350, DROP_MS = 300, EASE = 'cubic-bezier(.22,.61,.36,1)', INNER = 0.22;
// the click that follows a drag must not open a line (one listener for the whole page)
let blockNextClick = false;
window.addEventListener('click', (e) => { if (blockNextClick) { e.stopPropagation(); e.preventDefault(); blockNextClick = false; } }, true);
function dragCards(grid, onDone) {
  const idsNow = () => [...grid.children].map((x) => x.dataset.id ?? x.dataset.ph);
  const start = idsNow().join();
  let d = null;
  // slide the other cards from their old place to the new one (FLIP)
  const slide = (change) => {
    const cards = [...grid.querySelectorAll(':scope > .pcard')];
    const before = new Map(cards.map((c) => [c, c.getBoundingClientRect()]));
    change(); d && (d.busyUntil = performance.now() + SLIDE_MS);
    for (const c of cards) {
      const a = before.get(c), b = c.getBoundingClientRect(); const dx = a.left - b.left, dy = a.top - b.top;
      if (!dx && !dy) continue;
      c.style.transition = 'none'; c.style.transform = `translate(${dx}px,${dy}px)`;
      requestAnimationFrame(() => requestAnimationFrame(() => { c.style.transition = `transform ${SLIDE_MS}ms ${EASE}`; c.style.transform = ''; }));
    }
  };
  const begin = (e) => {
    const c = d.card, r = c.getBoundingClientRect();
    d.ph = h('div', { class: 'pcard-ph' }); d.ph.dataset.ph = c.dataset.id; d.ph.style.height = r.height + 'px';
    grid.insertBefore(d.ph, c);
    d.dx = e.clientX - r.left; d.dy = e.clientY - r.top; d.w = r.width; d.h = r.height; d.busyUntil = 0;
    Object.assign(c.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: '0', zIndex: '1000', pointerEvents: 'none', transition: 'box-shadow .15s, transform .15s' });
    c.classList.add('lifted'); document.body.append(c); document.body.classList.add('grabbing');
    d.active = true;
  };
  const move = (e) => {
    if (!d || e.pointerId !== d.pid) return;
    if (!d.active) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_START_PX) return; begin(e); }
    e.preventDefault();
    d.card.style.left = e.clientX - d.dx + 'px'; d.card.style.top = e.clientY - d.dy + 'px';
    // scroll the page when the card is near the top or bottom edge
    if (e.clientY < 70) window.scrollBy(0, -14); else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
    if (performance.now() < (d.busyUntil || 0)) return; // the last move is still sliding
    // middle of the dragged card
    const cx = e.clientX - d.dx + d.w / 2, cy = e.clientY - d.dy + d.h / 2;
    let target = null;
    for (const c of grid.querySelectorAll(':scope > .pcard')) {
      const r = c.getBoundingClientRect(); const mx = r.width * INNER, my = r.height * INNER;
      if (cx > r.left + mx && cx < r.right - mx && cy > r.top + my && cy < r.bottom - my) { target = c; break; }
    }
    if (!target) return;
    const kids = [...grid.children]; const iT = kids.indexOf(target), iP = kids.indexOf(d.ph);
    const ref = iP < iT ? target.nextSibling : target; // take the target's place; the cards in between move one step
    slide(() => grid.insertBefore(d.ph, ref));
  };
  const end = (e) => {
    if (!d || e.pointerId !== d.pid) return;
    const cur = d; d = null;
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
    if (!cur.active) return; // a plain click: the card opens as usual
    blockNextClick = true; setTimeout(() => { blockNextClick = false; }, 0);
    const c = cur.card, r = cur.ph.getBoundingClientRect();
    c.style.transition = `left ${DROP_MS}ms ${EASE}, top ${DROP_MS}ms ${EASE}, box-shadow ${DROP_MS}ms ${EASE}, transform ${DROP_MS}ms ${EASE}`;
    c.classList.remove('lifted'); c.style.left = r.left + 'px'; c.style.top = r.top + 'px';
    setTimeout(() => {
      grid.replaceChild(c, cur.ph); document.body.classList.remove('grabbing');
      for (const k of ['position', 'left', 'top', 'width', 'height', 'margin', 'zIndex', 'pointerEvents', 'transition', 'transform']) c.style[k] = '';
      const ids = idsNow(); if (ids.join() !== start) onDone(ids);
    }, DROP_MS);
  };
  grid.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || d) return;
    const c = e.target.closest('.pcard'); if (!c || c.parentNode !== grid || e.target.closest('button,a,input,select,textarea')) return;
    d = { card: c, pid: e.pointerId, x0: e.clientX, y0: e.clientY, active: false };
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  });
  grid.addEventListener('dragstart', (e) => e.preventDefault()); // no browser "ghost" image
}

// ---- Position card (agreed 2026-11-05/06) ----
const CS_ORDER = { red: 0, orange: 1, green: 2 };
const CS_WORD = { red: 'Warning', orange: 'Attention', green: 'Healthy' };
const SIZE_FULL = 15; // the size line is full at 15 % of the account
// which value on the card a mark highlights
// keyed by the mark's fixed code (1.5.7), never by its shown words
const HL = { 'missing-stop': 'stop', raise: 'stop', 'high-far': 'stop', 'stop-far-buy': 'stop',
  atstop: 'last', close: 'last', 'missing-last': 'last', 'missing-highest': 'hi',
  'below-ema': 'ema', 'near-ema': 'ema', 'missing-ema': 'ema', 'missing-initial': 'init',
  'pos-big': 'size', 'pos-near': 'size', 'pos-small': 'size' };
const hlKey = (code) => HL[code] ?? (code.startsWith('report') ? 'rep' : code.startsWith('risk-') ? 'risk' : null);
const HL_RANK = { r: 2, o: 1, b: 0 };
function highlights(marks) {
  const out = {};
  for (const m of marks) {
    const k = hlKey(m.code); const c = m.level === 'crit' || m.level === 'neg' ? 'r' : m.level === 'warn' ? 'o' : m.level === 'info' ? 'b' : null;
    if (!k || !c) continue;
    // #24: "Small position" (info level) must get its own colour (blue), matching Settings, instead of falling
    // through to the default green used for "Normal" - that silent fallback was the original bug.
    if (!out[k] || HL_RANK[c] > HL_RANK[out[k].c]) out[k] = { c, why: [] };
    out[k].why.push(m.say ?? m.text);
  }
  return out;
}
function reportText(iso, today) {
  if (!iso) return '–';
  const d = diffDays(today, iso);
  if (d === 0) return 'today'; if (d === 1) return 'in 1 day'; if (d > 1) return 'in ' + d + ' days';
  return -d === 1 ? '1 day ago' : -d + ' days ago';
}
function posCard(ctx, l, today) {
  const S = ctx.store.state.settings; const { t, m, marks } = l;
  const hl = highlights(marks); const cs = M.cardStatus(marks);
  const buy = D.d(t.buyPrice), last = num(t.last), stop = num(t.currentStop), init = num(t.initialStop);
  const val = (k, text, cls = '') => h('b', { class: `cv ${cls}${hl[k] ? ' hl-' + hl[k].c : ''}${text === '–' ? ' none' : ''}`, title: hl[k] ? hl[k].why.join(' · ') : null }, text);
  const lab = (text) => h('span', { class: 'cl' }, text);
  const risk = stop === null ? '–' : stop >= buy ? 'No risk' : pctTxt(m.riskAtStopPct, 2);
  const result = last === null || buy === 0n ? null : D.pct(D.sub(last, buy), buy);
  const buyToStop = stop === null || buy === 0n ? null : D.pct(D.sub(stop, buy), buy);
  const locked = buyToStop !== null && buyToStop > D.d(S.profitLocked);
  const size = m.positionPct; const sizeN = size === null ? 0 : Math.max(0, Number(size) / Number(D.SCALE));
  const tick = Math.min(100, Number(D.d(S.posSmallTo)) / Number(D.SCALE) / SIZE_FULL * 100);
  const sizeCls = hl.size ? hl.size.c : 'g';
  // 2026-11-09: what is still missing for this trade, in its own raspberry red; each word goes away once it is filled in
  const st = ctx.store.state; const stock = A.stockById(st, t.stockId) || {}; const setupName = st.setups.find((x) => x.id === t.setupId)?.name;
  const missing = [['sector', !(stock.sector || '').trim()], ['industry', !(stock.industry || '').trim()], ['exchange', !(stock.exchange || '').trim()], ['setup', !setupName || setupName === 'Unclassified'], ['rating', A.canRate(st, t.setupId) && (t.stars ?? null) === null], ['earnings date', !t.nextReport]].filter((x) => x[1]).map((x) => x[0]);
  const open = () => detail(ctx, t.id);
  return h('article', { class: 'pcard ' + cs, 'data-id': t.id, tabindex: 0, 'aria-label': `${l.sym} ${t.id}: ${CS_WORD[cs]}. Open the line`, onClick: open, onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
    h('div', { class: 'pc-top' }, h('span', { class: 'pc-sym', title: t.id + (t.sales.length ? ' · partly sold' : '') }, l.sym, t.sales.length ? h('span', { class: 's2' }, ' ½') : null)), // status label removed 2026-11-06 (Auto order and the filters still use the status)
    h('div', { class: 'pc-main' },
      h('div', { class: 'pc-left' },
        h('div', { class: 'pc-stop' }, lab('Current stop'), val('stop', stop === null ? 'No stop' : priceTxt(stop), 'big')),
        h('div', { class: 'pc-vals' },
          h('div', null, lab('Buy price'), val('buy', priceTxt(buy))),
          h('div', null, lab('Last price'), val('last', priceTxt(last))),
          h('div', null, lab('Highest price'), val('hi', priceTxt(num(t.highest)))),
          h('div', null, lab('EMA10'), val('ema', priceTxt(num(t.ema10))))),
        h('div', { class: 'pc-small' }, h('span', null, 'Earnings: ', val('rep', reportText(t.nextReport, today))), h('span', null, 'Initial stop: ', val('init', init === null ? 'missing' : priceTxt(init))))),
      h('div', { class: 'pc-right' },
        h('div', null, lab('Risk, share of capital'), Object.assign(val('risk', risk, 'mid'), stop !== null && stop >= buy ? { title: 'Stop is above the buy price: no risk left' } : {})),
        h('div', null, lab('Performance'), h('b', { class: 'cv res' + (locked ? ' locked' : ''), title: locked ? `Profit locked in: stop more than ${S.profitLocked.replace('.', ',')} % above the buy price` : 'Change from your buy price to the last price' }, result === null ? '–' : spct(result, 2))))),
    h('div', { class: 'pc-size', title: 'Position size: how big this trade is next to your whole account, at the last price' },
      missing.length ? h('span', { class: 'pc-miss', title: 'Sector, industry and exchange: add them in Lists → Stocks. Setup and rating: Edit trade. Earnings date: Update today.' }, 'Missing: ' + missing.join(', ')) : null, // 1.7.1: the grey price line is removed (his choice)
      // 2026-11-06: the size line is removed; its colours now go to the size text (green / orange / red, same limits)
      h('span', { class: 'sz c-' + sizeCls, title: hl.size ? hl.size.why.join(' · ') : null }, 'Position size ' + pctTxt(size, 1))));
}

// 1.5.2: plain price line in the place of the "Missing: …" text (shown only when nothing is missing). Grey only, no rule
// and no colour: it just shows where Stop, Buy, Last, EMA10 and Highest sit. Each point has its own shape so they are
// easy to tell apart: Stop = solid square, Buy = small dot, Last = big dark dot, EMA = thin tick, High = empty ring.
// ---- Line panel: all marks, the daily values (B2: saved at once, Undo for the last change), the facts, and the actions ----
function detail(ctx, id) {
  document.querySelector('.sheet-scrim')?.remove();
  const st = ctx.store.state; const t = A.tradeById(st, id); if (!t) return;
  const sym = A.symbolOf(st, t); const account = C.estimatedAccount(st);
  const marks = M.lineMarks(st, t, ctx.today(), account); const status = M.lineStatus(marks); const m = C.lineMetrics(st, t, account);
  const prevFocus = document.activeElement;
  const inputs = {};
  const numField = (f, label) => {
    const cur = t[f] ?? '';
    const inp = h('input', { inputmode: 'decimal', value: cur === '' ? '' : D.edit(D.d(cur)), 'aria-label': label, autocomplete: 'off', placeholder: 'Empty' });
    inputs[f] = { get: () => inp.value.trim(), el: inp, kind: 'num', label, before: inp.value.trim() };
    return h('label', { class: 'of' }, h('span', { class: 'l' }, label), h('div', { class: 'box' }, h('span', { class: 'pre' }, '$'), inp));
  };
  const rep = datePicker({ iso: t.nextReport || '', label: 'Earnings date' });
  inputs.nextReport = { get: () => rep.getISO(), el: rep.input, kind: 'date', label: 'Earnings date', before: t.nextReport || '' };
  const com = h('textarea', { 'aria-label': 'Comment', rows: 2 }); com.value = t.comment || '';
  inputs.comment = { get: () => com.value, el: com, kind: 'text', label: 'Comment', before: com.value };
  const msg = h('div', { class: 'msg bad', role: 'alert', hidden: true });
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey, true); prevFocus?.focus?.(); };
  async function save() {
    const changes = [];
    for (const [f, x] of Object.entries(inputs)) {
      const v = x.get(); if (v === x.before) continue;
      if (x.kind === 'num' && v !== '' && (D.parse(v) === null || D.parse(v) <= 0n)) { msg.textContent = `■ ${x.label} must be a number above 0, or empty.`; msg.hidden = false; x.el.focus(); return; }
      if (x.kind === 'date' && v === null) { msg.textContent = '■ The earnings date is not a valid date. Use dd-mm-yyyy or the calendar.'; msg.hidden = false; x.el.focus(); return; }
      changes.push([f, v]);
    }
    if (!changes.length) return close();
    const lastCh = changes.find(([f]) => f === 'last');
    if (lastCh && lastCh[1] !== '') {
      const j = A.jumpPct(t.last, lastCh[1]);
      if (j !== null && j > D.d(st.settings.bigJumpPct)) {
        const ok = await dialog({ title: `Last price of ${sym}: ${priceTxt(num(t.last))} → ${priceTxt(D.parse(lastCh[1]))}?`, body: h('div', null, para(`This is a jump of ${pctTxt(j, 0)}. Check for a typing error.`, ''), changeTable([Object.assign(['Last price', priceTxt(num(t.last)), priceTxt(D.parse(lastCh[1]))], { changed: true })])), ok: 'Save anyway' });
        if (!ok) return;
      }
    }
    const res = ctx.act((d) => { for (const [f, v] of changes) { const r = A.editDaily(d, t.id, f, v); if (!r.ok) return r; } return { ok: true }; }, { label: `${sym} update`, now: true });
    if (!res.ok) { msg.textContent = '■ ' + res.error; msg.hidden = false; return; }
    close(); toast(`${sym} updated.`, 'Undo', () => ctx.store.undo());
  }
  const onKey = (e) => {
    if (document.querySelector('.scrim.fixed') || document.querySelector('.dp-pop')) return; // a confirmation or calendar is open on top
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && scrim.contains(e.target)) { e.preventDefault(); save(); }
  };
  const lv = (k, v, why, cls) => h('div', null, h('dt', null, k, why ? infoBtn(k, why) : null), h('dd', { class: cls || '' }, v));
  const setup = st.setups.find((x) => x.id === t.setupId)?.name;
  const locked = m.lockedAtStop !== null && m.lockedAtStop > 0n;
  const R = (() => { const rps = C.riskPerShare(t), last = num(t.last); return rps === null || rps <= 0n || last === null ? null : D.div(D.sub(last, D.d(t.buyPrice)), rps); })();
  const others = A.sameStockOpen(st, t).filter((x) => x.id !== t.id).map((x) => x.id);
  const sharedNote = others.length ? h('div', { class: 'note' }, `Last price, highest price, EMA10 and earnings date are shared with your other ${sym} trade${others.length > 1 ? 's' : ''} (${others.join(', ')}). The highest price can only go up.`) : null;
  const correctHi = () => {
    const cur = t.highest ?? '';
    const inp = h('input', { inputmode: 'decimal', 'aria-label': 'New highest price', autocomplete: 'off', value: cur === '' ? '' : D.edit(D.d(cur)) });
    const rowsFor = (v) => [Object.assign(['Highest price' + (others.length ? ` (${[t.id, ...others].join(', ')})` : ''), cur === '' ? '–' : priceTxt(D.d(cur)), v === null ? '–' : priceTxt(v)], { changed: true })];
    const tbl = h('div', null, changeTable(rowsFor(null)));
    inp.addEventListener('input', () => { const v = D.parse(inp.value.trim()); tbl.replaceChildren(changeTable(rowsFor(v !== null && v > 0n ? v : null))); });
    dialog({ title: `Correct highest price of ${sym}`, body: h('div', null, para('Normally the highest price can only go up. Use this only to fix a wrong value. The change is logged' + (others.length ? ' and applies to all your open ' + sym + ' lines.' : '.'), ''), h('label', { class: 'fld' }, 'New highest price', inp), tbl),
      ok: 'Correct', onOk: () => {
        const v = inp.value.trim(); const p = D.parse(v); if (p === null || p <= 0n) return 'Enter a number above 0.';
        const r = ctx.act((d) => A.correctHighest(d, t.id, v), { label: `${sym} highest corrected`, now: true });
        if (!r.ok) return r.error; close(); toast(`${sym} highest price corrected.`, 'Undo', () => ctx.store.undo()); return true;
      } });
  };
  const sheet = h('aside', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': sym + ' line' },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' } },
      h('div', null, h('div', { class: 'eyebrow' }, `${t.id}${setup ? ' · ' + setup : ''}`), h('h2', { class: 'sh-title' }, sym), h('span', { class: 'st ' + status }, STATUS_TEXT[status])),
      h('button', { class: 'x', 'aria-label': 'Close', onClick: close }, '×')),
    marks.length ? h('div', { class: 'mlist' }, marks.map((x) => h('div', { class: 'mitem ' + x.level }, h('b', null, (x.icon ? x.icon + ' ' : '') + (x.say ?? x.text)), x.why ? h('span', null, ' · ' + x.why) : null))) : h('div', { class: 'calm' }, '✓ On plan. Nothing to decide today.'),
    h('section', { class: 'card acc' }, h('div', { class: 'card-h' }, h('div', null, h('h2', null, 'Update today'), h('p', { class: 'lead' }, 'Your daily values. Leave a field empty to clear it.'))),
      h('div', { class: 'card-b', style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        // 1.7.3 (his wish): the daily values first (Last, Highest, EMA10); Current stop moves next to the Earnings date (they change now and then)
        h('div', { class: 'fgrid fgrid3' }, numField('last', 'Last price'), numField('ema10', 'EMA10'), numField('highest', 'Highest price')),
        h('div', { class: 'fgrid' }, numField('currentStop', 'Current stop'), h('label', { class: 'of' }, h('span', { class: 'l' }, 'Earnings date'), h('div', { class: 'box' }, rep))),
        h('label', { class: 'of' }, h('span', { class: 'l' }, 'Comment'), com), sharedNote, msg,
        h('div', { class: 'row' }, h('button', { class: 'btn pri big', disabled: ctx.readOnly, onClick: save }, 'Save'), h('button', { class: 'btn big', onClick: close }, 'Cancel'),
          h('button', { class: 'btn sm', style: { marginLeft: 'auto' }, disabled: ctx.readOnly, onClick: correctHi }, 'Correct highest price…')))),
    h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', null, 'Trade')), h('div', { class: 'card-b' }, h('dl', { class: 'facts', style: { margin: 0 } },
      lv('Shares open', qtyTxt(C.openQty(t)) + (t.sales.length ? ` of ${qtyTxt(D.d(t.qty))} bought` : '')), lv('Buy date', dmy(t.buyDate)), lv('Buy price', usd(D.d(t.buyPrice))),
      lv('Initial stop', t.initialStop ? usd(D.d(t.initialStop)) : 'No stop', 'The stop you had when you bought. R and risk use it. It changes only with “Correct initial stop” in Edit trade.'),
      lv('Open P&L', susd(m.openPL), '(Last price − buy price) × open shares.', numClass(m.openPL)),
      lv('R (risk) now', R === null ? 'No stop' : rTxt(R), 'Result at the last price, in times your risk. +2 R = two times what you risked.'),
      locked ? lv('Locked in at the Current stop', susd(m.lockedAtStop) + (m.lockedR === null ? '' : ' · ' + rTxt(m.lockedR)), 'What the open shares win or lose from the buy price if sold at the Current stop.', 'pos')
        : lv('Loss from today if the stop is hit', susd(m.lossIfStop) + (m.lockedR === null ? '' : ' · ' + rTxt(m.lockedR) + ' at stop'), 'What you lose from the last price if the Current stop is hit.', numClass(m.lossIfStop)),
      lv('Risk at stop, share of capital', m.riskAtStopPct === null ? '–' : pctTxt(m.riskAtStopPct) + ' of capital when opened', 'What the open shares lose from the buy price if the Current stop is hit, next to your capital when the trade was opened.'),
      lv('Position size', pctTxt(m.positionPct, 1), 'How big this trade is next to your whole account, at the last price.'),
      m.realized !== null ? lv('Taken so far', susd(m.realized) + (m.rReal === null ? '' : ' · ' + rTxt(m.rReal)), 'Result of the shares already sold from this trade.', numClass(m.realized)) : null,
      m.realized !== null ? lv('Open risk', susd(m.lossIfStop), 'What the shares still open lose if the Current stop is hit.', numClass(m.lossIfStop)) : null))),
    h('div', { class: 'row' },
      h('button', { class: 'btn risk big', disabled: ctx.readOnly, onClick: () => { close(); ctx.go('close-trade', { tradeId: t.id }); } }, 'Close trade…'),
      h('button', { class: 'btn big', disabled: ctx.readOnly, onClick: () => { close(); editTrade(ctx, t.id); } }, 'Edit trade'),
      h('button', { class: 'btn big quiet-dng', style: { marginLeft: 'auto' }, disabled: ctx.readOnly, onClick: async () => {
        const ok = await dialog({ title: `Delete trade ${t.id} (${sym})?`, danger: true, ok: 'Delete trade',
          body: h('div', null, para(`Use this for a trade made by mistake or just to try something. It disappears at once from Open positions, History, capital and statistics${t.sales.length ? ', together with its ' + t.sales.length + ' sale' + (t.sales.length > 1 ? 's' : '') : ''}.`, ''),
            para('It stays in the Trash for 15 days in case you deleted the wrong trade (Import / Export → Trash). After that it is gone for good.', '')) });
        if (!ok) return;
        const r = ctx.act((d) => A.deleteTrade(d, t.id), { label: 'delete trade', now: true });
        if (r.ok) { close(); toast(`${sym} ${t.id} deleted.`, 'Undo', () => ctx.store.undo()); } else toast(r.error);
      } }, 'Delete trade…')));
  const scrim = h('div', { class: 'sheet-scrim', onClick: (e) => { if (e.target === scrim) close(); } }, sheet);
  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim);
  if (ctx.readOnly) { for (const x of Object.values(inputs)) x.el.disabled = true; sheet.querySelector('.x').focus(); }
  else { inputs.last.el.focus(); inputs.last.el.select(); }
}

// ---- Update prices: all lines in one table, one Undo step ----
function updatePrices(ctx, trades) {
  const st = ctx.store.state; const inputs = [];
  const rows = trades.map((t) => {
    const mk = (f, w = 80) => {
      const i = h('input', { class: 'cell', 'aria-label': `${A.symbolOf(st, t)} ${f}`, value: t[f] === '' ? '' : D.edit(D.d(t[f])), style: { width: w + 'px' } });
      const x = { t, f, el: i, get: () => i.value.trim(), before: i.value.trim() }; inputs.push(x);
      if (A.SHARED.includes(f)) i.addEventListener('input', () => { for (const y of inputs) if (y !== x && y.f === f && y.el && y.t.stockId === t.stockId) { y.el.value = i.value; y.mirror = true; } x.mirror = false; });
      return i;
    };
    const rep = datePicker({ iso: t.nextReport || '', label: A.symbolOf(st, t) + ' earnings date' });
    inputs.push({ t, f: 'nextReport', get: () => rep.getISO(), before: t.nextReport || '' });
    return h('tr', null, h('td', null, h('b', null, A.symbolOf(st, t)), h('div', { class: 'note' }, t.id)), h('td', { class: 'r' }, qtyTxt(C.openQty(t))), h('td', { class: 'r' }, priceTxt(D.d(t.buyPrice))), h('td', null, mk('last')), h('td', null, mk('currentStop')), h('td', null, mk('highest')), h('td', null, mk('ema10')), h('td', null, h('div', { class: 'cellbox' }, rep)));
  });
  dialog({ title: 'Update prices', wide: true, ok: 'Save all', body: h('div', null, para('Type the new values. Unchanged fields stay as they are; emptying a box clears that value (Highest price can only be changed). Trades in the same stock share last price, highest price, EMA10 and earnings date. All changes are saved together and can be undone with one click.'),
    h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, ['Symbol', 'Shares', 'Buy price', 'Last price', 'Current stop', 'Highest price', 'EMA10', 'Earnings date'].map((x, i) => h('th', { class: i > 0 && i < 7 ? 'r' : '' }, x)))), h('tbody', null, rows)))),
    onOk: async () => {
      const changes = []; const jumps = [];
      for (const x of inputs) {
        const { t, f } = x; const v = x.get();
        if (v === x.before || x.mirror) continue; // a mirrored value is saved once, through the line it was typed on
        if (f === 'nextReport') { if (v === null) return `${A.symbolOf(st, t)}: the earnings date is not a valid date. Use dd-mm-yyyy.`; }
        // his choice A (2026-11-09): emptying a box clears that value, like in the line panel (not Highest: it can only be corrected)
        else if (v !== '' || f === 'highest') { if (v === '') continue; if (D.parse(v) === null || D.parse(v) <= 0n) return `${A.symbolOf(st, t)}: enter ${f === 'last' ? 'the last price' : f} as a number above 0.`; }
        changes.push({ t, f, v });
        if (f === 'last' && v !== '') { const j = A.jumpPct(t.last, v); if (j !== null && j > D.d(st.settings.bigJumpPct)) jumps.push({ t, v, j }); }
      }
      if (!changes.length) return 'Nothing was changed.';
      if (jumps.length) {
        const ok = await dialog({ title: 'Big price jump', body: h('div', null, para('Check for typing errors:', ''), changeTable(jumps.map(({ t, v, j }) => Object.assign([A.symbolOf(st, t) + ' last price', priceTxt(num(t.last)), priceTxt(D.parse(v)) + ` (${pctTxt(j, 0)})`], { changed: true })))), ok: 'Save anyway' });
        if (!ok) return false;
      }
      const res = ctx.act((d) => { for (const c of changes) { const r = A.editDaily(d, c.t.id, c.f, c.v); if (!r.ok) return { ...r, error: `${A.symbolOf(d, c.t)}: ${r.error}` }; } return { ok: true }; }, { label: 'price update', now: true });
      return res.ok ? true : res.error;
    } });
}
