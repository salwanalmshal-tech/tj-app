import { h, dialog, para, toast, money, signed, pctTxt, qtyTxt, priceTxt, numClass, dmy, field, pill, infoBtn, changeTable, datePicker } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';
import * as A from '../actions.js';
import * as M from '../marks.js';
import { parseDMY } from '../dates.js';
import { editTrade } from './tradeforms.js';

let fYear = 'all', fSym = '', fText = '';

export function render(ctx) {
  const st = ctx.store.state; const S = st.settings;
  const traded = st.trades.filter((t) => t.sales.length);
  const rows = [];
  for (const t of traded) for (const det of C.salesDetail(t)) rows.push({ t, s: det.sale, det });
  rows.sort((a, b) => (a.s.date < b.s.date ? 1 : a.s.date > b.s.date ? -1 : b.s.seq - a.s.seq));
  const years = [...new Set(rows.map((r) => r.s.date.slice(0, 4)))].sort().reverse();
  if (fYear !== 'all' && !years.includes(fYear)) fYear = 'all';
  const shown = rows.filter((r) => (fYear === 'all' || r.s.date.startsWith(fYear)) && (!fSym || A.symbolOf(st, r.t) === fSym) && (!fText || (r.t.comment || '').toLowerCase().includes(fText.toLowerCase())));

  // summary: trades counted (fully sold), by sell date of the last sale
  const counted = new Map(); for (const r of shown) if (C.openQty(r.t) === 0n) counted.set(r.t.id, r.t);
  let win = 0, loss = 0, even = 0, net = 0n, sumR = 0n, nR = 0;
  for (const t of counted.values()) { const n = C.tradeNet(t); net += n; if (n > 0n) win++; else if (n < 0n) loss++; else even++; const R = C.rMultiple(t); if (R !== null) { sumR += R; nR++; } }
  const tiles = [['Trades counted', String(counted.size), 'Fully sold trades'], ['Win rate', counted.size ? pctTxt(D.pct(BigInt(win) * D.SCALE, BigInt(counted.size) * D.SCALE), 1) : '–', `${win} ${win === 1 ? 'win' : 'wins'} · ${loss} ${loss === 1 ? 'loss' : 'losses'}${even ? ' · ' + even + ' even' : ''}`], ['Net result', signed(net), 'After all commissions'], ['Average R', nR ? D.fmt(D.div(sumR, BigInt(nR) * D.SCALE), 2) : '–', 'Trades with an Initial stop']];

  const syms = [...new Set(rows.map((r) => A.symbolOf(st, r.t)))].sort();
  const filters = h('div', { class: 'row' },
    field('Year', h('select', { onChange: (e) => { fYear = e.target.value; ctx.redraw(); } }, h('option', { value: 'all' }, 'All years'), years.map((y) => h('option', { value: y, selected: y === fYear }, y)))),
    field('Symbol', h('select', { onChange: (e) => { fSym = e.target.value; ctx.redraw(); } }, h('option', { value: '' }, 'All'), syms.map((s) => h('option', { value: s, selected: s === fSym }, s)))),
    field('Comment contains', h('input', { value: fText, 'data-keep': 'ftext', onChange: (e) => { fText = e.target.value; ctx.redraw(); } })));

  const th = (x, c = '', why) => h('th', { class: c }, x, why ? infoBtn(x, why) : null);
  const head = h('tr', null, th('Edit'), th('Trade ID'), th('Symbol'), th('Marks', '', 'Gain or loss above your limits (as % of the capital at open). Set the limits in Settings.'), th('Buy date'), th('Sell date'), th('Qty sold', 'r'), th('Buy price', 'r'), th('Sell price', 'r'), th('Net P&L', 'r', 'Gross result minus the buy commission share and the sell commission.'),
    th('% of capital', 'r', 'Net P&L as % of the capital this trade was opened with.'), th('Days', 'r', 'Calendar days from buy date to this sale.'), th('Trade R', 'r', 'Total result of the trade divided by the risk of the shares sold (from the Initial stop). Shown when the trade is fully sold.'), th('Category'), th('Stop distance'), th('Setup'), th('Error'), th('Comment'));
  const body = shown.map(({ t, s, det }) => {
    const sym = A.symbolOf(st, t); const closed = C.openQty(t) === 0n; const R = closed ? C.rMultiple(t) : null; const cap = D.parse(t.capitalAtOpen);
    const pct = cap && cap > 0n ? D.pct(det.net, cap) : null; const mk = M.resultPctMark(pct, S);
    const sd = C.stopDistancePct(t);
    return h('tr', null, h('td', null, h('button', { class: 'btn sm', disabled: ctx.readOnly, 'aria-label': 'Edit sale of ' + sym, onClick: () => editSale(ctx, t.id, s.id) }, 'Edit')),
      h('td', { class: 'mono' }, t.id), h('td', { class: 'mono' }, sym), h('td', null, mk ? pill(mk) : null, closed ? null : h('span', { class: 'pill', title: 'Some shares of this trade are still open' }, 'Partly sold')),
      h('td', null, dmy(t.buyDate)), h('td', null, dmy(s.date)), h('td', { class: 'r' }, qtyTxt(D.d(s.qty))), h('td', { class: 'r' }, priceTxt(D.d(t.buyPrice))), h('td', { class: 'r' }, priceTxt(D.d(s.price))),
      h('td', { class: 'r ' + numClass(det.net) }, signed(det.net)), h('td', { class: 'r ' + numClass(pct) }, pct === null ? '–' : pctTxt(pct, 2, { sign: true })), h('td', { class: 'r' }, String(C.saleDays(t, s))), h('td', { class: 'r' }, R === null ? '–' : D.fmt(R, 2)),
      h('td', null, R === null ? '–' : C.rCategory(R, S)), h('td', null, sd === null ? 'No SL' : C.stopDistanceLabel(sd, S)),
      h('td', null, st.setups.find((x) => x.id === t.setupId)?.name ?? '–'), h('td', null, st.errors.find((x) => x.id === t.errorId)?.name ?? '–'), h('td', { class: 'mut' }, t.comment || '–'));
  });
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    h('div', { class: 'tile-row' }, tiles.map(([l, v, d]) => h('div', { class: 'panel tile' }, h('span', { class: 'lab' }, l), h('span', { class: 'v' }, v), h('span', { class: 'd' }, d)))),
    h('section', { class: 'panel' }, h('div', { class: 'pb' }, filters),
      shown.length ? h('div', { class: 'tw fx' }, h('table', { class: 'stk' }, h('thead', null, head), h('tbody', null, body))) : h('div', { class: 'pb' }, h('p', { class: 'mut' }, rows.length ? 'No sales match these filters.' : 'No sales yet. When you close a trade it appears here.')),
      h('div', { class: 'pb note' }, `${shown.length} sale${shown.length === 1 ? '' : 's'} · ${counted.size} trade${counted.size === 1 ? '' : 's'} counted`)));
}

function editSale(ctx, tradeId, saleId) {
  const st = ctx.store.state; const t = A.tradeById(st, tradeId); const s = t.sales.find((x) => x.id === saleId); const sym = A.symbolOf(st, t);
  const date = datePicker({ iso: s.date, label: 'Sell date' }), qty = h('input', { value: D.edit(D.d(s.qty)), style: { textAlign: 'right' }, 'aria-label': 'Quantity sold' }), price = h('input', { value: D.edit(D.d(s.price)), style: { textAlign: 'right' }, 'aria-label': 'Sell price' }), comm = h('input', { value: s.commission === '' ? '' : D.edit(D.d(s.commission)), style: { textAlign: 'right' }, 'aria-label': 'Sell commission' });
  dialog({ title: `Edit sale of ${sym} · ${t.id}`, wide: true, ok: 'Save', body: h('div', { style: { display: 'grid', gap: '12px' } },
    h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' } }, field('Sell date', date), field('Quantity sold', qty), field('Sell price', price), field('Sell commission', comm)),
    h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => { document.querySelector('.scrim')?.remove(); editTrade(ctx, t.id); } }, 'Edit buy data…'),
      h('button', { class: 'btn quiet-dng', onClick: async () => {
        const ok = await dialog({ title: `Reopen ${sym}: remove this sale?`, ok: 'Remove sale', body: para(`The ${qtyTxt(D.d(s.qty))} shares become open again and the sale moves to the Trash for 15 days. Capital and statistics change.`, '') });
        if (!ok) return; const r = ctx.act((d) => A.reopenSales(d, t.id, [s.id]), { label: 'reopen ' + sym, now: true }); if (r.ok) { document.querySelector('.scrim')?.remove(); toast(`${sym} sale removed.`, 'Undo', () => ctx.store.undo()); } else toast(r.error); } }, 'Reopen (remove this sale)…'))),
    onOk: async () => {
      const iso = parseDMY(date.value); if (!iso) return 'Enter a valid sell date (dd-mm-yyyy).';
      const patch = { date: iso, qty: qty.value, price: price.value, commission: comm.value.trim() };
      const trial = structuredClone(st); const r = A.editSale(trial, t.id, s.id, patch); if (!r.ok) return r.error;
      const t2 = A.tradeById(trial, t.id); const n1 = C.tradeNet(t), n2 = C.tradeNet(t2);
      const changed = n1 !== n2 || s.date !== iso;
      if (changed) { const ok = await dialog({ title: `Change this sale of ${sym}?`, ok: 'Save changes', body: changeTable([Object.assign(['Net result of the trade so far', signed(n1), signed(n2)], { changed: true }), Object.assign(['Capital (closed trades)', money(C.capitalNow(st)), money(C.capitalNow(trial))], { changed: true })]) }); if (!ok) return false; }
      const res = ctx.act((d) => A.editSale(d, t.id, s.id, patch), { label: 'edit sale ' + sym, now: true }); return res.ok ? true : res.error;
    } });
}
