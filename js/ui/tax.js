// Tax report (I2/I3): trades sold in a period (sell date), grouped by symbol, plus the open lines bought in that
// period shown separately. Read-only; never changes data. Excel export of exactly these two tables.
import { h, dialog, para, toast, money, qtyTxt, priceTxt, dmy, datePicker, infoBtn, download } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';
import * as A from '../actions.js';
// Loaded lazily (not at the top) so this module stays usable from plain Node tests, which have no window/document
// for data.js's own import chain (it pulls in app.js for the shell).
const loadData = () => import('./data.js');

const usd = (a) => (a === null || a === undefined ? '–' : (a < 0n ? '−$' : '$') + money(D.abs(a)));
const susd = (a) => (a === null || a === undefined ? '–' : (a > 0n ? '+$' : a < 0n ? '−$' : '$') + money(D.abs(a)));
const toneCls = (a) => (a === null || a === undefined ? 'mut' : a > 0n ? 'pos' : a < 0n ? 'neg' : '');

// kept across redraws of this screen (not saved to the data file - a view choice, like History's filters)
let F = null;

function thisYear(today) { return { from: today.slice(0, 4) + '-01-01', to: today }; }
function lastYear(today) { const y = Number(today.slice(0, 4)) - 1; return { from: y + '-01-01', to: y + '-12-31' }; }
function ensure(ctx) { if (!F) { const r = thisYear(ctx.today()); F = { preset: 'this', from: r.from, to: r.to }; } return F; }

// Grouped by symbol: every sale with a sell date inside [from, to], plus any dividend paid in that period even
// when nothing of that symbol was sold in it (he chose to always show the dividend, 2026-11-12).
export function periodData(st, from, to) {
  const g = new Map();
  const grp = (sym) => g.get(sym) ?? (g.set(sym, { symbol: sym, shares: 0n, buyW: 0n, sellW: 0n, commission: 0n, net: 0n, dividends: 0n }), g.get(sym));
  for (const t of st.trades) {
    for (const x of C.salesDetail(t)) {
      if (x.sale.date < from || x.sale.date > to) continue;
      const r = grp(A.symbolOf(st, t)); const q = D.d(x.sale.qty);
      r.shares += q; r.buyW += D.mul(D.d(t.buyPrice), q); r.sellW += D.mul(D.d(x.sale.price), q);
      r.commission += x.buyShare + (x.sale.commission === '' ? 0n : D.d(x.sale.commission)); r.net += x.net;
    }
  }
  for (const dv of st.dividends) {
    if (dv.payDate < from || dv.payDate > to) continue;
    const sym = st.stocks.find((s) => s.id === dv.stockId)?.symbol ?? '?';
    grp(sym).dividends += D.d(dv.amount);
  }
  const rows = [...g.values()].sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0))
    .map((r) => ({ ...r, avgBuy: r.shares ? D.div(r.buyW, r.shares) : null, avgSell: r.shares ? D.div(r.sellW, r.shares) : null }));
  const totals = rows.reduce((a, r) => ({ commission: a.commission + r.commission, dividends: a.dividends + r.dividends, net: a.net + r.net }), { commission: 0n, dividends: 0n, net: 0n });
  const open = C.openTrades(st).filter((t) => t.buyDate >= from && t.buyDate <= to)
    .map((t) => ({ symbol: A.symbolOf(st, t), buyDate: t.buyDate, shares: C.openQty(t), buyPrice: D.d(t.buyPrice) }))
    .sort((a, b) => (a.buyDate < b.buyDate ? -1 : a.buyDate > b.buyDate ? 1 : a.symbol < b.symbol ? -1 : 1));
  return { rows, totals, open };
}

export function render(ctx) {
  const st = ctx.store.state; const f = ensure(ctx);
  const { rows, totals, open } = periodData(st, f.from, f.to);

  const chip = (key, label) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(f.preset === key), onClick: () => {
    if (key === 'this') Object.assign(f, thisYear(ctx.today()), { preset: 'this' });
    else if (key === 'last') Object.assign(f, lastYear(ctx.today()), { preset: 'last' });
    else f.preset = 'custom';
    ctx.redraw();
  } }, label);

  const fromDp = datePicker({ iso: f.from, label: 'From (sell date)', onChange: () => { f.from = fromDp.getISO() || f.from; f.preset = 'custom'; ctx.redraw(); } });
  const toDp = datePicker({ iso: f.to, label: 'To (sell date)', onChange: () => { f.to = toDp.getISO() || f.to; f.preset = 'custom'; ctx.redraw(); } });

  const th = (label, why) => h('th', { class: 'r' }, label, why ? infoBtn(label, why) : null);
  const table1 = !rows.length ? h('div', { class: 'msg dim' }, 'No sales (and no dividends) in this period.') :
    h('div', { class: 'tw' }, h('table', { class: 'cap-table' },
      h('thead', null, h('tr', null,
        h('th', null, 'Symbol'),
        th('Shares bought', 'Total shares bought that were sold in this period, across all buy lines of this symbol.'),
        th('Avg buy price', 'Weighted average buy price of the shares sold in this period.'),
        th('Avg sell price', 'Weighted average sell price of the shares sold in this period.'),
        th('Commission', 'Buy and sell commission together, for the shares sold in this period.'),
        th('Dividends', 'Dividends with a pay date inside this period, for this symbol.'),
        th('Net P&L', 'Total net result (after commission) of the shares sold in this period.'))),
      h('tbody', null,
        rows.map((r) => h('tr', null,
          h('td', null, r.symbol),
          h('td', { class: 'r' }, r.shares ? qtyTxt(r.shares) : '–'),
          h('td', { class: 'r' }, r.avgBuy === null ? '–' : priceTxt(r.avgBuy)),
          h('td', { class: 'r' }, r.avgSell === null ? '–' : priceTxt(r.avgSell)),
          h('td', { class: 'r' }, r.commission ? usd(r.commission) : '–'),
          h('td', { class: 'r' }, r.dividends ? usd(r.dividends) : '–'),
          h('td', { class: 'r ' + toneCls(r.net) }, r.shares ? susd(r.net) : '–'))),
        h('tr', { style: { fontWeight: '700' } }, h('td', null, 'Total'), h('td', { class: 'r' }), h('td', { class: 'r' }), h('td', { class: 'r' }),
          h('td', { class: 'r' }, totals.commission ? usd(totals.commission) : '–'), h('td', { class: 'r' }, totals.dividends ? usd(totals.dividends) : '–'), h('td', { class: 'r ' + toneCls(totals.net) }, susd(totals.net))))));

  const table2 = !open.length ? h('div', { class: 'msg dim' }, 'No open positions were bought in this period.') :
    h('div', { class: 'tw' }, h('table', { class: 'cap-table' },
      h('thead', null, h('tr', null, h('th', null, 'Symbol'), h('th', null, 'Buy date'), h('th', { class: 'r' }, 'Shares'), h('th', { class: 'r' }, 'Buy price'))),
      h('tbody', null, open.map((r) => h('tr', null, h('td', null, r.symbol), h('td', null, dmy(r.buyDate)), h('td', { class: 'r' }, qtyTxt(r.shares)), h('td', { class: 'r' }, priceTxt(r.buyPrice)))))));

  const exportBtn = h('button', { class: 'btn pri', onClick: async () => {
    try {
      const { loadXLSX, toXlsx } = await loadData();
      const X = await loadXLSX();
      const n = (s) => (s === '' || s === null || s === undefined ? '' : { n: s });
      const dt = (iso) => (iso ? { d: iso } : '');
      const sheets = {
        'Sold in period': rows.map((r) => ({ Symbol: r.symbol, 'Shares bought': n(r.shares ? D.toStr(r.shares) : ''), 'Avg buy price': n(r.avgBuy === null ? '' : D.toStr(r.avgBuy)), 'Avg sell price': n(r.avgSell === null ? '' : D.toStr(r.avgSell)), 'Commission (USD)': n(D.toStr(r.commission)), 'Dividends (USD)': n(D.toStr(r.dividends)), 'Net P&L (USD)': n(D.toStr(r.net)) })),
        'Still open, bought in period': open.map((r) => ({ Symbol: r.symbol, 'Buy date': dt(r.buyDate), Shares: n(D.toStr(r.shares)), 'Buy price': n(D.toStr(r.buyPrice)) })),
      };
      download(`TaxReport-${f.from}-to-${f.to}.xlsx`, toXlsx(X, sheets));
    } catch (e) { toast(e.message); }
  } }, 'Export to Excel');

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
    h('section', { class: 'panel' }, h('div', { class: 'pb', style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
      chip('this', 'This year'), chip('last', 'Last year'), chip('custom', 'Custom'),
      h('span', { style: { flexGrow: '1' } }),
      h('span', { class: 'note' }, 'From'), fromDp, h('span', { class: 'note' }, 'To'), toDp)),
    h('section', { class: 'panel' }, h('div', { class: 'ph' }, 'Sold in this period', infoBtn('Sold in this period', 'The sell date decides which sales fall in the period. Grouped by symbol; a stock with a dividend in the period gets a row even if none of it was sold.')), h('div', { class: 'pb' }, table1)),
    h('section', { class: 'panel' }, h('div', { class: 'ph' }, 'Still open — bought in this period', infoBtn('Still open', 'Open lines bought in this period, shown separately. Not counted in the total above.')), h('div', { class: 'pb' }, table2)),
    h('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, exportBtn));
}
