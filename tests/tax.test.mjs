import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../js/decimal.js';
import * as A from '../js/actions.js';
import { emptyState } from '../js/model.js';
import { periodData } from '../js/ui/tax.js';

function fresh() {
  const st = emptyState();
  assert.ok(A.setStartCapital(st, { amount: '10000', date: '2024-01-01' }).ok);
  return st;
}

test('Tax report: groups sales by symbol, weighted averages, commission and net P&L', () => {
  const st = fresh();
  const a = A.openTrade(st, { symbol: 'AAA', buyDate: '2026-02-01', qty: '100', buyPrice: '10', initialStop: '9', buyCommission: '2' }).data;
  A.closeSale(st, { date: '2026-03-01', price: '12', commission: '1', allocations: [{ tradeId: a.id, qty: '100' }] });
  // a second AAA buy line, sold the same period, to check the weighted average
  const a2 = A.openTrade(st, { symbol: 'AAA', buyDate: '2026-02-05', qty: '100', buyPrice: '20', initialStop: '18', buyCommission: '2' }).data;
  A.closeSale(st, { date: '2026-03-02', price: '22', commission: '1', allocations: [{ tradeId: a2.id, qty: '100' }] });

  const { rows, totals } = periodData(st, '2026-01-01', '2026-12-31');
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.symbol, 'AAA');
  assert.equal(D.fmt(r.shares, 0), '200');
  assert.equal(D.fmt(r.avgBuy, 2), '15,00'); // (10*100 + 20*100) / 200
  assert.equal(D.fmt(r.avgSell, 2), '17,00'); // (12*100 + 22*100) / 200
  assert.equal(D.fmt(r.commission, 2), '6,00'); // 2 buy commission + 1 sell commission, per trade, for the two trades
  assert.equal(D.fmt(r.net, 2, { sign: true }), '+394,00'); // (12-10)*100-2-1 + (22-20)*100-2-1
  assert.equal(D.fmt(totals.net, 2, { sign: true }), '+394,00');
});

test('Tax report: sell date outside the period is excluded; a dividend alone still gets a row', () => {
  const st = fresh();
  const a = A.openTrade(st, { symbol: 'BBB', buyDate: '2025-06-01', qty: '10', buyPrice: '50', initialStop: '45', buyCommission: '' }).data;
  A.closeSale(st, { date: '2025-12-20', price: '55', commission: '', allocations: [{ tradeId: a.id, qty: '10' }] }); // sold LAST year
  const stock = A.addListItem(st, 'stocks', 'CCC').data;
  A.addDividend(st, { stockId: stock.id, payDate: '2026-06-01', amount: '15' }); // paid THIS year, nothing of it sold this year

  const { rows } = periodData(st, '2026-01-01', '2026-12-31');
  assert.equal(rows.length, 1); // BBB's sale is outside the period and must not appear
  assert.equal(rows[0].symbol, 'CCC');
  assert.equal(rows[0].shares, 0n);
  assert.equal(rows[0].avgBuy, null);
  assert.equal(D.fmt(rows[0].dividends, 2), '15,00');
});

test('Tax report: open lines bought in the period are listed separately and never in the sold totals', () => {
  const st = fresh();
  A.openTrade(st, { symbol: 'DDD', buyDate: '2026-04-15', qty: '5', buyPrice: '30', initialStop: '27', buyCommission: '' });
  A.openTrade(st, { symbol: 'EEE', buyDate: '2025-04-15', qty: '5', buyPrice: '30', initialStop: '27', buyCommission: '' }); // bought before the period

  const { rows, totals, open } = periodData(st, '2026-01-01', '2026-12-31');
  assert.equal(rows.length, 0); // nothing sold, no dividends
  assert.equal(D.fmt(totals.net, 2, { sign: true }), '0,00');
  assert.equal(open.length, 1);
  assert.equal(open[0].symbol, 'DDD');
});
