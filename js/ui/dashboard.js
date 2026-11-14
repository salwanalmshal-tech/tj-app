// Dashboard v2 (built 2026-11-14 from the preview he approved): where the account stands today and how the year goes.
// Agreed: 7 number cards (never filtered), exposure, "your year month by month", capital over time, result by setup;
// Auto | Drag and drop order saved in the data file (cards among cards, blocks among blocks). No filter bar: the month
// and setup blocks share one Year / Custom period. Trade statistics stay in History. Numbers come from calc.js only.
// 1.5.1: every number card has an "On Open positions" tick (max 4, saved in the data file); the ticked cards are the
// account numbers on top of Open positions, where he arranges them by dragging.
import { h, money, dmy, datePicker, infoBtn } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';
import * as A from '../actions.js';

const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, String(v));
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const num = (a) => (a === null || a === undefined ? 0 : D.toNumber(a));
const usd = (a) => (a === null || a === undefined ? '–' : (a < 0n ? '−$' : '$') + money(D.abs(a)));
const susd = (a) => (a === null || a === undefined ? '–' : (a > 0n ? '+$' : a < 0n ? '−$' : '$') + money(D.abs(a)));
const spct = (a, dp = 1) => (a === null || a === undefined ? '–' : (a > 0n ? '+' : a < 0n ? '−' : '') + D.fmt(D.abs(a), dp) + ' %');
const tone = (a) => (a === null || a === undefined ? '' : a > 0n ? 'pos' : a < 0n ? 'neg' : '');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monName = (k, full) => (full ? MON_FULL : MON)[Number(k.slice(5, 7)) - 1] + (full ? ' ' + k.slice(0, 4) : '');
const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)'];
const fill = (pctW, bg, extra = {}) => h('span', { class: 'd-fill' + (extra.cls ? ' ' + extra.cls : ''), style: { width: Math.max(0, Math.min(100, pctW)) + '%', background: bg, animationDelay: extra.delay || '0s' } });

export const CARDS = ['capital', 'openpl', 'loss', 'progress', 'month', 'year', 'market'];
export const BLOCKS = ['exposure', 'months', 'curve', 'setups'];
// His saved order, with anything new (or unknown) put back in the standard place.
export function ordered(saved, def) { const ok = (saved || []).filter((k) => def.includes(k)); return [...ok, ...def.filter((k) => !ok.includes(k))]; }

// view choices (not saved in the data file): the period of the month/setup blocks and what is selected
const V = { preset: null, from: null, to: null, sel: null, ex: -1, su: 0, pinMsg: false };

export function render(ctx) {
  const st = ctx.store.state; const today = ctx.today(); const year = today.slice(0, 4);
  if (!V.preset) Object.assign(V, { preset: year, from: year + '-01-01', to: year + '-12-31' });

  const lay = st.layouts?.dashboard || {}; const mode = lay.mode === 'drag' ? 'drag' : 'auto';
  const canDrag = mode === 'drag' && !ctx.readOnly;
  const setLayout = (patch, label) => ctx.act((d) => { d.layouts ??= {}; d.layouts.dashboard = { ...(d.layouts.dashboard || {}), ...patch }; return { ok: true }; }, { label, now: true });
  const seg = (key, label) => h('button', { class: 'seg-b', 'aria-pressed': String(mode === key), disabled: ctx.readOnly, onClick: () => { if (mode !== key) setLayout({ mode: key }, 'dashboard order mode'); } }, label);
  const cardOrder = mode === 'drag' ? ordered(lay.cards, CARDS) : CARDS;
  const blockOrder = mode === 'drag' ? ordered(lay.blocks, BLOCKS) : BLOCKS;
  const grip = canDrag ? h('span', { class: 'd-grip', 'aria-hidden': 'true' }, '⋮⋮') : null;

  const wrap = h('div', { class: 'dash' });
  wrap.append(h('header', { class: 'pg-head' },
    h('div', null, h('div', { class: 'eyebrow' }, 'Learn'), h('h1', null, 'Dashboard'), h('p', { class: 'lead' }, 'Where your account stands today, and how the year is going.')),
    h('div', { class: 'acts' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Card order' }, seg('auto', 'Auto'), seg('drag', 'Drag and drop')),
      mode === 'drag' ? h('button', { class: 'btn ghost', disabled: ctx.readOnly, onClick: () => setLayout({ cards: [...CARDS], blocks: [...BLOCKS] }, 'dashboard order reset') }, 'Reset order') : null)));
  if (!st.capital.start) { wrap.append(h('div', { class: 'msg' }, 'Add your start capital in Capital first — the Dashboard is built from it.')); return wrap; }
  if (canDrag) wrap.append(h('div', { class: 'd-note' }, 'Drag mode — grab a card or a block and move it. Cards move among the cards, blocks among the blocks. Your order is saved.'));

  const ex = C.dashExposure(st);
  // "On Open positions" ticks: up to 4 cards also show on top of Open positions (their order is set there, by dragging)
  const pins = C.openCards(st); const pinMsg = V.pinMsg; V.pinMsg = false;
  const pin = (k) => { const on = pins.includes(k);
    return h('div', { class: 'd-pinrow' }, h('button', { class: 'd-pin' + (on ? ' on' : ''), type: 'button', 'aria-pressed': String(on), disabled: ctx.readOnly,
      title: on ? 'Shown on Open positions. Click to take it away there.' : 'Click to show this card on Open positions too.',
      onClick: () => { const r = ctx.act((d) => A.toggleOpenCard(d, k), { label: on ? 'card taken off Open positions' : 'card shown on Open positions', now: true }); if (r && !r.ok) { V.pinMsg = true; ctx.redraw(); } } },
      on ? '✓ On Open positions' : '+ Open positions')); };
  const cards = h('div', { class: 'd-cards' + (canDrag ? ' d-dragmode' : '') }, cardOrder.map((k, i) => { const c = CARD[k](st, today, ex, grip); c.dataset.id = k; c.style.animationDelay = (i * 0.05) + 's';
    (k === 'capital' ? c.firstElementChild : c).append(pin(k)); return c; }));
  const pinLine = h('div', { class: 'd-pinline' }, h('span', { class: 'd-q' }, `${pins.length} of ${C.OPEN_CARD_MAX} cards shown on Open positions · drag them into your order there · these cards are never filtered`),
    pinMsg ? h('span', { class: 'd-pinmsg', role: 'status' }, `Max ${C.OPEN_CARD_MAX} — untick one first`) : null);
  const blocks = h('div', { class: 'd-blocks' + (canDrag ? ' d-dragmode' : '') }, blockOrder.map((k, i) => { const b = BLOCK[k](ctx, st, today, ex, grip); b.dataset.id = k; b.style.animationDelay = (0.1 + i * 0.05) + 's'; return b; }));
  if (canDrag) {
    dragItems(cards, '.d-card', (ids) => setLayout({ cards: ids }, 'dashboard card order'));
    dragItems(blocks, '.d-block', (ids) => setLayout({ blocks: ids }, 'dashboard block order'));
  }
  wrap.append(cards, pinLine, blocks);
  return wrap;
}

// ---------------------------------------------------------------- number cards (never filtered)
const head = (grip, label, why) => h('span', { class: 'eyebrow' }, grip?.cloneNode(true), label, infoBtn(label, why));

const CARD = {
  capital(st, today, ex, grip) {
    const cap = C.capitalNow(st); const pr = C.progress(st); const cur = C.capitalCurve(st);
    return h('div', { class: 'd-card wide' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', flex: '1 1 auto', minWidth: '0' } },
        head(grip, 'Capital (closed trades)', 'Start capital + deposits − withdrawals + dividends + the net result of every sale. Open positions are not in it.'),
        h('span', { class: 'v big' }, usd(cap)),
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
          h('span', { class: 'd-tag ' + (tone(pr.result) || 'pos') }, (pr.result < 0n ? '▼ ' : '▲ ') + susd(pr.result) + ' from sales and dividends'),
          h('span', { class: 'q' }, 'invested ' + usd(pr.invested)))),
      spark(cur.pts.map((p) => num(p.capital)), 'var(--accent)', 'Capital since the start'));
  },
  openpl(st, today, ex, grip) {
    const rows = ex.rows.filter((r) => r.pl !== null);
    const tot = rows.reduce((a, r) => a + r.pl, 0n); const noLast = ex.rows.length - rows.length;
    const max = Math.max(1e-9, ...rows.map((r) => Math.abs(num(r.pl))));
    const top = [...rows].sort((a, b) => Math.abs(num(b.pl)) - Math.abs(num(a.pl))).slice(0, 3);
    return h('div', { class: 'd-card' },
      head(grip, 'Open P&L', 'Result of your open positions at their last prices. Not in Capital until you sell.'),
      h('span', { class: 'v ' + tone(tot) }, susd(tot)),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, top.map((r, i) =>
        h('div', { style: { display: 'grid', gridTemplateColumns: '44px 1fr 62px', gap: '6px', alignItems: 'center', fontSize: '11px' } },
          h('b', null, r.sym), h('span', { class: 'd-track', style: { height: '5px' } }, fill((Math.abs(num(r.pl)) / max) * 100, r.pl < 0n ? 'var(--neg)' : 'var(--pos)', { delay: i * 0.1 + 's' })),
          h('span', { class: tone(r.pl), style: { textAlign: 'right' } }, susd(r.pl))))),
      h('span', { class: 'q' }, !ex.rows.length ? 'No open positions' : `${ex.rows.length} open stock${ex.rows.length === 1 ? '' : 's'}` + (rows.length > 3 ? ` · top 3 shown` : '') + (noLast ? ` · ${noLast} without last price not included` : '')));
  },
  loss(st, today, ex, grip) {
    const L = C.lossIfAllStopsHit(st);
    const by = new Map();
    for (const t of C.openTrades(st)) { const v = C.lineValues(t); if (v.lossIfStop === null) continue; const sym = st.stocks.find((x) => x.id === t.stockId)?.symbol ?? '?'; by.set(sym, (by.get(sym) ?? 0n) + v.lossIfStop); }
    const parts = [...by.entries()].filter(([, v]) => v < 0n).sort((a, b) => num(a[1]) - num(b[1]));
    const tot = parts.reduce((a, [, v]) => a + num(v), 0);
    const shades = ['var(--neg)', '#C66A60', '#E3A49B', '#EFC6C0'];
    return h('div', { class: 'd-card risk' },
      head(grip, 'Loss if all stops hit', 'From today: (Current stop − last price) × shares for every open line, as % of the estimated account (capital + open result).'),
      h('span', { class: 'v neg' }, susd(L.loss)),
      parts.length ? h('div', { style: { display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', gap: '2px' } },
        parts.map(([, v], i) => h('span', { class: 'd-fill', style: { width: (num(v) / tot) * 100 + '%', background: shades[Math.min(i, 3)], animationDelay: i * 0.1 + 's' } }))) : null,
      h('span', { class: 'q' }, spct(L.pctOfAccount) + ' of estimated account' + (parts.length ? ' · ' + parts.slice(0, 3).map(([sym, v]) => `${sym} ${Math.round((num(v) / tot) * 100)} %`).join(' · ') : '') + (L.missing ? ` · ${L.missing} line${L.missing === 1 ? '' : 's'} without stop or last price not included` : '')));
  },
  progress(st, today, ex, grip) {
    const pr = C.progress(st); const cur = C.capitalCurve(st);
    let inv = 0n; const invested = cur.pts.map((p) => { if (p.kind === 'start' || p.kind === 'deposit') inv += p.amount; return num(inv); });
    return h('div', { class: 'd-card' },
      head(grip, 'Progress vs original', '(Sale results + dividends) ÷ everything you put in (start capital + deposits). Withdrawals never count as a loss.'),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } }, h('span', { class: 'v ' + tone(pr.pct) }, spct(pr.pct)),
        spark(cur.pts.map((p) => num(p.capital)), pr.result < 0n ? 'var(--neg)' : 'var(--pos)', 'Capital against what you put in', { w: 90, hgt: 34, base: invested, area: false })),
      h('span', { class: 'q' }, `${susd(pr.result)} on ${usd(pr.invested)} put in (dashed line)`));
  },
  month(st, today, ex, grip) {
    const k = today.slice(0, 7); const v = C.monthResult(st, k); const cap = baseCapital(st, k + '-01', today);
    const p = cap > 0n ? D.pct(v, cap) : null;
    const day = Number(today.slice(8, 10)); const days = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate();
    return h('div', { class: 'd-card' },
      head(grip, 'This month', 'Net result of the sales made this month (by sale date), as % of your capital on the 1st.'),
      h('span', { class: 'v ' + tone(v) }, susd(v)),
      h('span', { class: 'd-track', style: { height: '6px' } }, fill((day / days) * 100, 'var(--accent)')),
      h('span', { class: 'q' }, `${spct(p)} of capital on 1 ${MON[Number(k.slice(5)) - 1]} · day ${day} of ${days}`));
  },
  year(st, today, ex, grip) {
    const y = today.slice(0, 4); const v = C.yearResult(st, y); const cap = baseCapital(st, y + '-01-01', y + '-12-31'); const late = st.capital.start.date > y + '-01-01';
    const p = cap > 0n ? D.pct(v, cap) : null;
    const ms = C.monthStats(st, y + '-01-01', y + '-12-31'); const nowK = today.slice(0, 7);
    const green = ms.filter((m) => m.has && m.net > 0n).length, done = ms.filter((m) => m.has).length;
    return h('div', { class: 'd-card' },
      head(grip, 'This year', 'Net result of the sales made this year (by sale date), as % of your capital on 1 January.'),
      h('span', { class: 'v ' + tone(v) }, susd(v)),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(12,minmax(0,1fr))', gap: '3px' }, 'aria-label': `${green} of ${done} months green` }, ms.map((m, i) =>
        h('span', { title: monName(m.month, true) + (m.has ? ': ' + susd(m.net) : ''), style: { height: '14px', borderRadius: '3px', boxSizing: 'border-box',
          background: m.has ? (m.net > 0n ? (m.month === nowK ? '#8CC2A8' : 'var(--pos)') : m.net < 0n ? 'var(--neg)' : 'var(--faint)') : m.month > nowK ? 'transparent' : '#EEF2F6',
          border: m.month > nowK ? '1.5px dashed var(--field)' : 'none', animation: m.has ? `d-grow .9s ${i * 0.05}s cubic-bezier(.2,.8,.2,1) both` : 'none' } }))),
      h('span', { class: 'q' }, `${spct(p)} of capital on ${late ? dmy(st.capital.start.date) + ' (start)' : '1 Jan'} · ${green} of ${done} month${done === 1 ? '' : 's'} green`));
  },
  market(st, today, ex, grip) {
    const p = ex.totalPct === null ? 0 : Math.max(0, Math.min(100, num(ex.totalPct)));
    const C2 = 2 * Math.PI * 26;
    return h('div', { class: 'd-card' },
      head(grip, 'In market / Cash', 'Open positions at last price (buy price when there is no last price) ÷ estimated account. Cash is the rest.'),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
        s('svg', { viewBox: '0 0 64 64', role: 'img', 'aria-label': `${Math.round(p)} percent in market`, style: { width: '64px', height: '64px', transform: 'rotate(-90deg)', flex: '0 0 auto' } },
          s('circle', { cx: 32, cy: 32, r: 26, fill: 'none', stroke: '#E6EBF1', 'stroke-width': 8 }),
          p > 0 ? s('circle', { class: 'd-ring', cx: 32, cy: 32, r: 26, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-dasharray': `${(p / 100) * C2} ${C2}` }) : null),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, h('span', { style: { fontSize: '22px', fontWeight: '800', letterSpacing: '-.02em' } }, D.fmt(D.d(String(p.toFixed(2))), 1) + ' %'),
          h('span', { class: 'q' }, `in market · ${D.fmt(D.d(String((100 - p).toFixed(2))), 1)} % cash`))));
  },
};

// small line picture; base = optional dashed comparison line (same length)
function spark(vals, color, label, o = {}) {
  const W = o.w ?? 200, H = o.hgt ?? 60;
  const all = vals.concat(o.base || []);
  if (vals.length < 2) return s('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', style: { width: o.w ? W + 'px' : '46%', height: 'auto' } });
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const xy = (v, i, n) => [(i / (n - 1)) * W, H - 4 - ((v - lo) / span) * (H - 8)];
  const line = (arr) => arr.map((v, i) => xy(v, i, arr.length).map((z) => z.toFixed(1)).join(',')).join(' ');
  const last = xy(vals.at(-1), vals.length - 1, vals.length);
  return s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label, style: { width: o.w ? W + 'px' : '46%', height: o.w ? H + 'px' : 'auto', alignSelf: 'center', overflow: 'visible', flex: '0 0 auto' } },
    o.area === false ? null : s('polygon', { points: `0,${H} ${line(vals)} ${W},${H}`, fill: 'var(--infobg)' }),
    o.base ? s('polyline', { points: line(o.base), fill: 'none', stroke: '#AEB8C4', 'stroke-dasharray': '3 3' }) : null,
    s('polyline', { class: 'd-draw', points: line(vals), fill: 'none', stroke: color, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }),
    o.w ? null : s('circle', { cx: last[0], cy: last[1], r: 4, fill: color }));
}

// ---------------------------------------------------------------- blocks
const blockHead = (grip, title, right) => h('div', { class: 'd-bh' }, h('span', { class: 'd-bt' }, grip?.cloneNode(true), title), right);

// shared Year / Custom period of the months and setup blocks
function periodPicker(ctx, st, today) {
  const ys = new Set([today.slice(0, 4)]);
  for (const t of st.trades) for (const x of t.sales) ys.add(x.date.slice(0, 4));
  const years = [...ys].sort().reverse().slice(0, 4);
  const pick = (y) => { Object.assign(V, { preset: y, from: y + '-01-01', to: y + '-12-31', sel: null }); ctx.redraw(); };
  const row = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
    years.map((y) => h('button', { class: 'chip', 'aria-pressed': String(V.preset === y), onClick: () => pick(y) }, y)),
    h('button', { class: 'chip', 'aria-pressed': String(V.preset === 'custom'), onClick: () => { V.preset = 'custom'; V.sel = null; ctx.redraw(); } }, 'Custom'));
  if (V.preset === 'custom') {
    const f = datePicker({ iso: V.from, label: 'From', onChange: () => { const v = f.getISO(); if (v) { V.from = v; V.sel = null; ctx.redraw(); } } });
    const t = datePicker({ iso: V.to, label: 'To', onChange: () => { const v = t.getISO(); if (v) { V.to = v; V.sel = null; ctx.redraw(); } } });
    row.append(h('span', { class: 'd-q' }, 'From'), f, h('span', { class: 'd-q' }, 'To'), t);
  }
  return row;
}

const BLOCK = {
  exposure(ctx, st, today, ex, grip) {
    const b = h('section', { class: 'd-block wide' });
    b.append(blockHead(grip, 'Exposure — your open positions', h('span', { class: 'd-q' }, `% of estimated account ${usd(ex.account)} · tap a stock`)));
    if (!ex.rows.length) { b.append(h('div', { class: 'd-q', style: { padding: '8px 18px 18px' } }, 'No open positions.')); return b; }
    const secColor = new Map(ex.sectors.map((x, i) => [x.key, COLORS[i % COLORS.length]]));
    const sel = V.ex >= 0 && V.ex < ex.rows.length ? ex.rows[V.ex] : null;
    const R = 78, CIRC = 2 * Math.PI * R; let off = 0;
    const ring = s('svg', { viewBox: '0 0 200 200', role: 'img', 'aria-label': `${D.fmt(ex.totalPct ?? 0n, 1)} percent of the account in the market`, style: { width: '200px', height: '200px', transform: 'rotate(-90deg)' } },
      s('circle', { cx: 100, cy: 100, r: R, fill: 'none', stroke: '#EEF2F6', 'stroke-width': 20 }),
      ex.sectors.map((x) => { const len = Math.max(0, (num(x.pct) / 100) * CIRC - 2); const on = !sel || sel.sector === x.key;
        const c = s('circle', { class: 'd-ring', cx: 100, cy: 100, r: R, fill: 'none', stroke: secColor.get(x.key), 'stroke-width': sel && on ? 26 : 20, 'stroke-dasharray': `${len} ${CIRC}`, 'stroke-dashoffset': -off, opacity: on ? 1 : 0.25 });
        off += (num(x.pct) / 100) * CIRC; return c; }));
    const center = h('div', { style: { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', textAlign: 'center' } },
      h('span', { style: { fontSize: '26px', fontWeight: '800', letterSpacing: '-.03em' } }, sel ? D.fmt(sel.pct ?? 0n, 1) + ' %' : D.fmt(ex.totalPct ?? 0n, 1) + ' %'),
      h('span', { class: 'd-q', style: { maxWidth: '120px' } }, sel ? `${sel.sym} · ${sel.sector}` : `in market · ${D.fmt(D.sub(D.d('100'), ex.totalPct ?? 0n), 1)} % cash`));
    const cols = '160px minmax(0,1fr) 80px 66px 92px';
    const max = Math.max(1e-9, ...ex.rows.map((r) => num(r.value)));
    const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' } },
      h('div', { class: 'd-exrow', style: { display: 'grid', gridTemplateColumns: cols, gap: '12px', padding: '0 10px 6px' } },
        ['Stock', 'Value', '$', 'Account', 'If stop hit'].map((t, i) => h('span', { class: 'eyebrow', style: { textAlign: i > 1 ? 'right' : 'left' } }, t))),
      ex.rows.map((r, i) => h('button', { class: 'd-row d-exrow' + (V.ex === i ? ' on' : ''), style: { gridTemplateColumns: cols }, 'aria-pressed': String(V.ex === i), onClick: () => { V.ex = V.ex === i ? -1 : i; ctx.redraw(); } },
        h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: '0' } },
          h('b', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, h('span', { style: { width: '8px', height: '8px', borderRadius: '2px', background: secColor.get(r.sector) } }), r.sym),
          h('span', { class: 'd-q', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.sector + (r.noLast ? ' · buy price, no last price' : ''))),
        h('span', { class: 'd-track' }, fill((num(r.value) / max) * 100, secColor.get(r.sector), { cls: r.noLast ? 'd-hatch' : '', delay: i * 0.08 + 's' })),
        h('span', { style: { textAlign: 'right', fontWeight: '650' } }, usd(r.value)),
        h('span', { style: { textAlign: 'right' } }, D.fmt(r.pct ?? 0n, 1) + ' %'),
        h('span', { class: 'neg', style: { textAlign: 'right', fontWeight: '650' } }, r.loss === null ? 'No stop' : susd(r.loss)))),
      h('div', { class: 'd-exrow', style: { display: 'grid', gridTemplateColumns: cols, gap: '12px', padding: '10px 10px 0', borderTop: '1px solid var(--line)', marginTop: '4px', fontWeight: '700' } },
        h('span', null, 'Total'), h('span'), h('span', { style: { textAlign: 'right' } }, usd(ex.total)), h('span', { style: { textAlign: 'right' } }, D.fmt(ex.totalPct ?? 0n, 1) + ' %'),
        h('span', { class: 'neg', style: { textAlign: 'right' } }, susd(ex.rows.reduce((a, r) => a + (r.loss ?? 0n), 0n)))));
    b.append(h('div', { class: 'd-exgrid', style: { padding: '8px 18px 18px', display: 'grid', gridTemplateColumns: '220px minmax(0,1fr)', gap: '24px', alignItems: 'center' } },
      h('div', { style: { position: 'relative', width: '200px', height: '200px', justifySelf: 'center' } }, ring, center), list));
    return b;
  },

  months(ctx, st, today, ex, grip) {
    const b = h('section', { class: 'd-block wide' });
    b.append(blockHead(grip, 'Your year, month by month', periodPicker(ctx, st, today)));
    const ms = C.monthStats(st, V.from, V.to); const nowK = today.slice(0, 7);
    const shown = ms.filter((m) => m.has);
    const tot = shown.reduce((a, m) => a + m.net, 0n); const cap0 = baseCapital(st, V.from, V.to); const late = st.capital.start.date > V.from;
    const green = shown.filter((m) => m.net > 0n).length;
    b.append(h('div', { style: { padding: '2px 18px 6px', display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap' } },
      h('span', { class: tone(tot), style: { fontSize: '34px', fontWeight: '800', letterSpacing: '-.03em' } }, susd(tot)),
      h('span', { style: { fontSize: '13px', color: '#3C4B60' } }, h('b', { class: tone(tot) }, cap0 > 0n ? spct(D.pct(tot, cap0)) : '–'), ` of capital on ${late ? dmy(st.capital.start.date) + ' (start)' : dmy(V.from)} · `, h('b', null, `${green} of ${shown.length}`), ' months green · by sale date')));
    if (!ms.length) return b;
    if (!V.sel || !ms.some((m) => m.month === V.sel && m.has)) V.sel = (shown.filter((m) => m.month <= nowK).at(-1) ?? shown.at(-1))?.month ?? null;
    const max = Math.max(1e-9, ...shown.map((m) => Math.abs(num(m.net))));
    const n = ms.length; const k = 95 / max;
    const grid = h('div', { class: 'd-mgrid', style: { gridTemplateColumns: `repeat(${n},minmax(${n > 12 ? '44px' : '0'},1fr))` } }, ms.map((m, i) => {
      const future = m.month > nowK; const hgt = Math.max(4, Math.round(Math.abs(num(m.net)) * k));
      return h('button', { class: 'd-mt' + (m.month === V.sel ? ' on' : ''), disabled: !m.has, 'aria-label': `${monName(m.month, true)}: ${m.has ? susd(m.net) : future ? 'not started' : 'no trades'}`, onClick: () => { V.sel = m.month; ctx.redraw(); } },
        h('span', { class: tone(m.net), style: { height: '16px', fontSize: '11.5px', fontWeight: '700' } }, m.has ? (m.net < 0n ? '−' : '+') + Math.round(Math.abs(num(m.net))) : ''),
        h('span', { class: 'd-cap' + (future ? ' future' : !m.has ? ' none' : '') }, h('span', { class: 'd-zero' }),
          m.has ? h('span', { class: 'd-bar ' + (m.net < 0n ? 'dn' : 'up'), style: { height: hgt + 'px', animationDelay: (i * 0.06).toFixed(2) + 's', opacity: m.month === nowK ? '.7' : '1' } }) : null),
        h('span', { style: { display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: '600', color: m.month === V.sel ? 'var(--accent)' : m.has ? '#3C4B60' : '#B4BECB' } }, monName(m.month) + (n > 12 && m.month.endsWith('-01') ? ' ' + m.month.slice(2, 4) : ''), m.month === nowK ? h('span', { class: 'd-live', 'aria-hidden': 'true' }) : null),
        h('span', { style: { fontSize: '10.5px', color: 'var(--faint)', height: '14px' } }, future ? 'coming' : !m.has ? 'no trades' : m.month === nowK ? 'so far' : ''));
    }));
    // running total, drawn over the capsules (same zero line: 110 px from the top of a capsule)
    const runs = ms.map((m, i) => (m.run === null ? null : [((i + 0.5) / n) * 1200, num(m.run)])).filter(Boolean);
    if (runs.length > 1) {
      const mx = Math.max(1e-9, ...runs.map(([, v]) => Math.abs(v))); const kk = 100 / mx;
      const P = runs.map(([x, v]) => [x, Math.max(2, Math.min(188, 110 - v * kk))]);
      grid.append(s('svg', { viewBox: '0 0 1200 190', preserveAspectRatio: 'none', 'aria-hidden': 'true', style: { position: 'absolute', left: '0', right: '0', top: '28px', width: '100%', height: '190px', pointerEvents: 'none' } },
        s('path', { class: 'd-draw', d: smooth(P), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2.5, 'vector-effect': 'non-scaling-stroke', opacity: '.9' })));
    }
    grid.style.setProperty('--n', n);
    const scroller = h('div', { class: 'd-mscroll', style: { padding: '6px 12px 0', overflowX: n > 12 ? 'auto' : 'visible' } }, grid);
    requestAnimationFrame(() => { const on = grid.querySelector('.d-mt.on'); if (on && scroller.scrollWidth > scroller.clientWidth) scroller.scrollLeft = on.offsetLeft - scroller.clientWidth / 2 + on.offsetWidth / 2; });
    b.append(h('div', null, scroller,
      h('div', { style: { display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '11.5px', color: 'var(--muted)', padding: '2px 6px 12px' } },
        h('span', null, h('span', { style: { display: 'inline-block', width: '9px', height: '9px', borderRadius: '3px', background: 'var(--pos)' } }), ' month result'),
        h('span', null, h('span', { style: { display: 'inline-block', width: '14px', borderTop: '2.5px solid var(--accent)', verticalAlign: 'middle' } }), ' running total for the period'),
        h('span', null, 'Tap a month for its details'))));
    const m = ms.find((x) => x.month === V.sel);
    if (m) {
      const wp = m.closed ? (m.won / m.closed) * 100 : 0, lp = m.closed ? (m.lost / m.closed) * 100 : 0;
      b.append(h('div', { class: 'd-soft d-detail', style: { margin: '0 18px 18px', padding: '14px', display: 'grid', gridTemplateColumns: '170px repeat(4,minmax(0,1fr))', gap: '12px' } },
        h('div', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px', paddingLeft: '4px' } }, h('span', { class: 'eyebrow' }, 'Selected'),
          h('span', { style: { fontSize: '22px', fontWeight: '800', letterSpacing: '-.02em' } }, monName(m.month, true)), h('span', { class: 'd-q' }, m.month === nowK ? 'month in progress' : 'closed month')),
        h('div', { class: 'd-stat' }, h('span', { class: 'eyebrow' }, 'Result'), h('b', { class: tone(m.net) }, susd(m.net)), h('span', { class: 'd-q' }, `${spct(m.pct)} of capital on the 1st`)),
        h('div', { class: 'd-stat' }, h('span', { class: 'eyebrow' }, 'Trades closed'), h('b', null, String(m.closed)),
          h('span', { style: { display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden', background: '#E6EBF1', marginTop: '4px' } }, h('span', { style: { width: wp + '%', background: 'var(--pos)' } }), h('span', { style: { width: lp + '%', background: 'var(--neg)' } })),
          h('span', { class: 'd-q' }, `${m.won} won · ${m.lost} lost` + (m.zero ? ` · ${m.zero} at 0` : ''))),
        h('div', { class: 'd-stat' }, h('span', { class: 'eyebrow' }, 'Best trade'), h('b', { class: m.best ? tone(m.best.net) : '' }, m.best ? susd(m.best.net) : '–'), h('span', { class: 'd-q' }, m.best ? m.best.sym : 'no trade closed')),
        h('div', { class: 'd-stat' }, h('span', { class: 'eyebrow' }, 'Total after this month'), h('b', { class: tone(m.run) }, susd(m.run)), h('span', { class: 'd-q' }, 'running total'))));
    }
    return b;
  },

  curve(ctx, st, today, ex, grip) {
    const b = h('section', { class: 'd-block' });
    b.append(blockHead(grip, 'Capital over time', h('span', { class: 'd-q' }, 'since start · never filtered')));
    const cv = C.capitalCurve(st); const pts = cv.pts;
    const pr = C.progress(st);
    b.append(h('div', { style: { padding: '2px 18px 0', display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' } },
      h('span', { style: { fontSize: '30px', fontWeight: '800', letterSpacing: '-.03em' } }, usd(C.capitalNow(st))),
      h('span', { class: 'd-tag ' + (tone(pr.pct) || 'pos') }, (pr.pct !== null && pr.pct < 0n ? '▼ ' : '▲ ') + spct(pr.pct) + ' on what you put in')));
    if (pts.length < 2) { b.append(h('div', { class: 'd-q', style: { padding: '12px 18px 18px' } }, 'The line appears after your first sale.')); return b; }
    const W = 600, H = 200, T = 18, B = 180, L = 10, Rr = 590;
    const d0 = Date.parse(pts[0].date), d1 = Math.max(Date.parse(today), Date.parse(pts.at(-1).date)), spanD = d1 - d0 || 1;
    const vals = pts.map((p) => num(p.capital)); const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.08 || 1;
    const X = (iso) => L + ((Date.parse(iso) - d0) / spanD) * (Rr - L), Y = (v) => B - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (B - T);
    // one point per day (the last capital of that day), so same-day events don't stack up
    // over more than two months: one point per week (the capital at the end of that week), so the line flows;
    // highest, lowest and the deepest drop below still use every event
    const weekly = (d1 - d0) / 86400000 > 60;
    const keyOf = (iso, kind) => (kind === 'start' ? 'start' : weekly ? C.weekStart(iso) : iso);
    const day = []; for (const p of pts) { const k = keyOf(p.date, p.kind); if (day.length && day.at(-1).k === k) day[day.length - 1] = { ...p, k }; else day.push({ ...p, k }); }
    const P = day.map((p) => [X(p.date), Y(num(p.capital))]);
    if (P.at(-1)[0] < Rr - 1) { P.push([Rr, P.at(-1)[1]]); day.push({ ...day.at(-1), date: today, kind: 'today' }); }
    const id = 'capfill' + Math.random().toString(36).slice(2, 7);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Capital from ${usd(pts[0].capital)} to ${usd(pts.at(-1).capital)}`, style: { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible' } },
      s('defs', null, s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: 0, 'stop-color': '#326B9E', 'stop-opacity': '.22' }), s('stop', { offset: 1, 'stop-color': '#326B9E', 'stop-opacity': 0 }))));
    if (cv.drop && D.toNumber(cv.drop.pct) <= -0.5) { // show the deepest drop when it is at least 0,5 %
      const rec = pts.find((p) => p.date > cv.drop.to.date && p.capital >= cv.drop.from.capital);
      const x1 = X(cv.drop.from.date), x2 = rec ? X(rec.date) : Rr;
      svg.append(s('rect', { x: x1, y: 0, width: Math.max(6, x2 - x1), height: B + 10, rx: 10, fill: 'var(--negbg)', opacity: '.8' }),
        s('text', { x: (x1 + x2) / 2, y: 13, 'font-size': '10.5', 'font-weight': '650', fill: 'var(--neg)', 'text-anchor': 'middle' }, 'Deepest drop ' + spct(cv.drop.pct, 2)));
    }
    const path = smooth(P);
    svg.append(s('path', { d: `${path} L${P.at(-1)[0]},${B + 10} L${P[0][0]},${B + 10} Z`, fill: `url(#${id})` }),
      s('path', { class: 'd-draw', d: path, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 3, 'stroke-linecap': 'round' }));
    for (const p of day) if (p.kind === 'deposit' || p.kind === 'withdrawal') svg.append(s('text', { x: X(p.date), y: Y(num(p.capital)) + (p.kind === 'deposit' ? 18 : -10), 'font-size': '11', fill: p.kind === 'deposit' ? 'var(--pos)' : 'var(--neg)', 'text-anchor': 'middle' }, p.kind === 'deposit' ? '▲' : '▼'));
    const [ex1, ey1] = P.at(-1);
    svg.append(s('circle', { class: 'd-glow', cx: ex1, cy: ey1, r: 5, fill: 'var(--accent)' }), s('circle', { cx: ex1, cy: ey1, r: 4.5, fill: 'var(--accent)' }));
    const guide = s('line', { stroke: 'var(--accent)', 'stroke-opacity': '.3', 'stroke-width': 1.5, y2: B + 10, visibility: 'hidden' });
    const halo = s('circle', { r: 11, fill: 'var(--accent)', 'fill-opacity': '.12', visibility: 'hidden' });
    const dot = s('circle', { r: 5.5, fill: '#fff', stroke: 'var(--accent)', 'stroke-width': 3, visibility: 'hidden' });
    svg.append(guide, halo, dot);
    const tip = h('div', { class: 'd-tip', style: { display: 'none' } });
    const box = h('div', { style: { position: 'relative', width: '100%', aspectRatio: '3 / 1', cursor: 'crosshair', touchAction: 'pan-y' } }, svg, tip);
    const show = (clientX) => {
      const r = box.getBoundingClientRect(); const x = ((clientX - r.left) / r.width) * W;
      let i = 0; for (let j = 1; j < P.length; j++) if (Math.abs(P[j][0] - x) < Math.abs(P[i][0] - x)) i = j;
      const [px, py] = P[i]; const p = day[i]; const prev = i > 0 ? day[i - 1] : null;
      for (const el of [guide]) { el.setAttribute('x1', px); el.setAttribute('x2', px); el.setAttribute('y1', py); el.setAttribute('visibility', 'visible'); }
      for (const el of [halo, dot]) { el.setAttribute('cx', px); el.setAttribute('cy', py); el.setAttribute('visibility', 'visible'); }
      tip.style.display = 'block'; tip.style.left = (px / W) * 100 + '%'; tip.style.top = (py / H) * 100 + '%';
      tip.style.transform = `translate(${px < 90 ? '-12%' : px > W - 90 ? '-88%' : '-50%'},-135%)`;
      tip.replaceChildren(document.createTextNode(usd(p.capital)), h('span', null, (p.kind === 'today' ? 'today' : p.kind === 'start' ? dmy(p.date) + ' · start' : (weekly ? 'week of ' + dmy(p.k) : dmy(p.date))) + (prev && p.kind !== 'today' && p.kind !== 'start' ? ' · ' + susd(p.capital - prev.capital) : '')));
    };
    const hide = () => { tip.style.display = 'none'; for (const el of [guide, halo, dot]) el.setAttribute('visibility', 'hidden'); };
    box.addEventListener('pointermove', (e) => show(e.clientX)); box.addEventListener('pointerdown', (e) => show(e.clientX)); box.addEventListener('pointerleave', hide);
    const first = pts[0].date, last = today;
    b.append(h('div', { style: { padding: '10px 18px 0' } }, box,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--faint)', paddingTop: '6px' } }, h('span', null, dmy(first)), h('span', null, 'today'))));
    b.append(h('div', { class: 'd-soft', style: { margin: '12px 18px 12px', padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '10px' } },
      h('div', null, h('div', { class: 'eyebrow' }, 'Highest'), h('div', { style: { fontSize: '16px', fontWeight: '800' } }, usd(cv.high.capital)), h('div', { class: 'd-q' }, cv.high.date === pts.at(-1).date ? 'now' : dmy(cv.high.date))),
      h('div', null, h('div', { class: 'eyebrow' }, 'Lowest'), h('div', { style: { fontSize: '16px', fontWeight: '800' } }, usd(cv.low.capital)), h('div', { class: 'd-q' }, cv.low.kind === 'start' ? 'start' : dmy(cv.low.date))),
      h('div', null, h('div', { class: 'eyebrow' }, 'Deepest drop'), h('div', { class: cv.drop ? 'neg' : '', style: { fontSize: '16px', fontWeight: '800' } }, cv.drop ? spct(cv.drop.pct, 2) : 'none'), h('div', { class: 'd-q' }, cv.drop ? `${dmy(cv.drop.from.date)} → ${dmy(cv.drop.to.date)}` : ''))));
    b.append(h('div', { class: 'd-q', style: { padding: '0 18px 14px' } }, 'Point at or tap the line · ▲ deposit / ▼ withdrawal'));
    return b;
  },

  setups(ctx, st, today, ex, grip) {
    const b = h('section', { class: 'd-block' });
    b.append(blockHead(grip, 'Result by setup', periodPicker(ctx, st, today)));
    const ss = C.setupStats(st, V.from, V.to);
    if (!ss.length) { b.append(h('div', { class: 'd-q', style: { padding: '8px 18px 18px' } }, 'No trades closed in this period.')); return b; }
    if (V.su >= ss.length) V.su = 0;
    const max = Math.max(1e-9, ...ss.map((g) => Math.abs(num(g.net))));
    const cols = '128px minmax(0,1fr) minmax(0,1fr) 90px';
    b.append(h('div', { style: { padding: '8px 8px 0', display: 'flex', flexDirection: 'column', gap: '2px' } }, ss.map((g, i) => {
      const w = (Math.abs(num(g.net)) / max) * 100;
      return h('button', { class: 'd-row d-setrow' + (V.su === i ? ' on' : ''), style: { gridTemplateColumns: cols, gap: '0' }, 'aria-pressed': String(V.su === i), onClick: () => { V.su = i; ctx.redraw(); } },
        h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: '0', paddingRight: '8px' } }, h('b', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, g.name), h('span', { class: 'd-q' }, `${g.n} trade${g.n === 1 ? '' : 's'}`)),
        h('span', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', height: '22px', borderRight: '1.5px solid #AEB8C4' } },
          g.net < 0n ? h('span', { class: 'd-fill r', style: { width: w + '%', height: '14px', background: 'var(--neg)', borderRadius: '7px 0 0 7px', boxShadow: '0 4px 12px rgba(172,76,69,.25)', animationDelay: i * 0.08 + 's' } }) : null),
        h('span', { style: { display: 'flex', alignItems: 'center', height: '22px' } },
          g.net > 0n ? h('span', { class: 'd-fill', style: { width: w + '%', height: '14px', background: 'var(--pos)', borderRadius: '0 7px 7px 0', boxShadow: '0 4px 12px rgba(40,118,90,.25)', animationDelay: i * 0.08 + 's' } }) : null),
        h('span', { class: tone(g.net), style: { textAlign: 'right', fontWeight: '700' } }, susd(g.net)));
    })));
    const g = ss[V.su];
    b.append(h('div', { class: 'd-soft', style: { margin: '12px 18px 18px', padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '10px' } },
      h('div', null, h('div', { class: 'eyebrow' }, g.name), h('div', { class: tone(g.net), style: { fontSize: '18px', fontWeight: '800' } }, susd(g.net))),
      h('div', null, h('div', { class: 'eyebrow' }, 'Win rate'), h('div', { style: { fontSize: '18px', fontWeight: '800' } }, g.winRate === null ? '–' : D.fmt(g.winRate, 0) + ' %'), h('div', { class: 'd-q' }, `${g.won} won · ${g.lost} lost` + (g.zero ? ` · ${g.zero} at 0` : ''))),
      h('div', null, h('div', { class: 'eyebrow' }, 'Per trade'), h('div', { class: tone(g.avgR), style: { fontSize: '18px', fontWeight: '800' } }, g.avgR === null ? '–' : (g.avgR > 0n ? '+' : g.avgR < 0n ? '−' : '') + D.fmt(D.abs(g.avgR), 2) + ' R'), h('div', { class: 'd-q' }, 'average R'))));
    return b;
  },
};

// smooth curve through points that never overshoots or loops (monotone cubic, Fritsch–Carlson)
function smooth(P) {
  const n = P.length; if (n < 2) return '';
  const f = (v) => v.toFixed(1);
  let d = `M${f(P[0][0])},${f(P[0][1])}`;
  if (n === 2) return d + ` L${f(P[1][0])},${f(P[1][1])}`;
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = P[i + 1][0] - P[i][0]; m[i] = dx[i] > 0 ? (P[i + 1][1] - P[i][1]) / dx[i] : 0; }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  t[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], q = a * a + b * b;
    if (q > 9) { const k = 3 / Math.sqrt(q); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = P[i], [x1, y1] = P[i + 1], h3 = dx[i] / 3;
    d += dx[i] > 0 ? ` C${f(x0 + h3)},${f(y0 + t[i] * h3)} ${f(x1 - h3)},${f(y1 - t[i + 1] * h3)} ${f(x1)},${f(y1)}` : ` L${f(x1)},${f(y1)}`;
  }
  return d;
}

// the capital a period is measured against (shared with Open positions, so both screens always show the same %)
const baseCapital = C.periodBaseCapital;

// Drag and drop, the same feel as the Open positions cards (place decided by the middle of the dragged item).
const DRAG_START_PX = 6, SLIDE_MS = 350, DROP_MS = 300, EASE = 'cubic-bezier(.22,.61,.36,1)', INNER = 0.22;
let blockClick = false;
window.addEventListener('click', (e) => { if (blockClick) { e.stopPropagation(); e.preventDefault(); blockClick = false; } }, true);
export function dragItems(grid, sel, onDone) {
  const ids = () => [...grid.children].map((x) => x.dataset.id ?? x.dataset.ph);
  const start = ids().join(); let d = null;
  const slide = (change) => {
    const items = [...grid.querySelectorAll(':scope > ' + sel)]; const before = new Map(items.map((c) => [c, c.getBoundingClientRect()]));
    change(); d && (d.busyUntil = performance.now() + SLIDE_MS);
    for (const c of items) { const a = before.get(c), r = c.getBoundingClientRect(); const dx = a.left - r.left, dy = a.top - r.top; if (!dx && !dy) continue;
      c.style.transition = 'none'; c.style.transform = `translate(${dx}px,${dy}px)`;
      requestAnimationFrame(() => requestAnimationFrame(() => { c.style.transition = `transform ${SLIDE_MS}ms ${EASE}`; c.style.transform = ''; })); }
  };
  const begin = (e) => {
    const c = d.card, r = c.getBoundingClientRect(); const cs = getComputedStyle(c);
    d.ph = h('div', { class: 'd-ph', style: { height: r.height + 'px', gridColumn: cs.gridColumnStart.startsWith('span') ? cs.gridColumnStart : (c.classList.contains('wide') ? 'span 2' : 'auto') } }); d.ph.dataset.ph = c.dataset.id;
    grid.insertBefore(d.ph, c);
    d.dx = e.clientX - r.left; d.dy = e.clientY - r.top; d.w = r.width; d.h = r.height; d.busyUntil = 0;
    Object.assign(c.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', margin: '0', zIndex: '1000', pointerEvents: 'none', animation: 'none', transition: 'box-shadow .15s, transform .15s' });
    c.classList.add('d-lifted'); document.body.append(c); document.body.classList.add('grabbing'); d.active = true;
  };
  const move = (e) => {
    if (!d || e.pointerId !== d.pid) return;
    if (!d.active) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_START_PX) return; begin(e); }
    e.preventDefault();
    d.card.style.left = e.clientX - d.dx + 'px'; d.card.style.top = e.clientY - d.dy + 'px';
    if (e.clientY < 70) window.scrollBy(0, -14); else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
    if (performance.now() < (d.busyUntil || 0)) return;
    const cx = e.clientX - d.dx + d.w / 2, cy = e.clientY - d.dy + d.h / 2; let target = null;
    for (const c of grid.querySelectorAll(':scope > ' + sel)) { const r = c.getBoundingClientRect(); const mx = r.width * INNER, my = r.height * INNER;
      if (cx > r.left + mx && cx < r.right - mx && cy > r.top + my && cy < r.bottom - my) { target = c; break; } }
    if (!target) return;
    const kids = [...grid.children]; const iT = kids.indexOf(target), iP = kids.indexOf(d.ph);
    slide(() => grid.insertBefore(d.ph, iP < iT ? target.nextSibling : target));
  };
  const end = (e) => {
    if (!d || e.pointerId !== d.pid) return;
    const cur = d; d = null;
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
    if (!cur.active) return;
    blockClick = true; setTimeout(() => { blockClick = false; }, 0);
    const c = cur.card, r = cur.ph.getBoundingClientRect();
    c.style.transition = `left ${DROP_MS}ms ${EASE}, top ${DROP_MS}ms ${EASE}, box-shadow ${DROP_MS}ms ${EASE}, transform ${DROP_MS}ms ${EASE}`;
    c.classList.remove('d-lifted'); c.style.left = r.left + 'px'; c.style.top = r.top + 'px';
    setTimeout(() => {
      grid.replaceChild(c, cur.ph); document.body.classList.remove('grabbing');
      for (const k of ['position', 'left', 'top', 'width', 'height', 'margin', 'zIndex', 'pointerEvents', 'transition', 'transform', 'animation']) c.style[k] = '';
      const now = ids(); if (now.join() !== start) onDone(now);
    }, DROP_MS);
  };
  grid.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || d) return;
    const c = e.target.closest(sel); if (!c || c.parentNode !== grid || e.target.closest('button,a,input,select,textarea')) return;
    d = { card: c, pid: e.pointerId, x0: e.clientX, y0: e.clientY, active: false };
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  });
  grid.addEventListener('dragstart', (e) => e.preventDefault());
}
