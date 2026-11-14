import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../js/decimal.js';
import * as A from '../js/actions.js';
import * as C from '../js/calc.js';
import { emptyState } from '../js/model.js';

const fx = (x, dp = 2) => D.toNumber(x).toFixed(dp); // plain numbers, so the test does not depend on the display spaces/minus
const f2 = (x) => fx(x, 2);
function fresh() {
  const st = emptyState();
  assert.ok(A.setStartCapital(st, { amount: '10000', date: '2026-01-01' }).ok);
  return st;
}
const stock = (st, sym, sector) => { const s = st.stocks.find((x) => x.symbol === sym); s.sector = sector; };

test('Dashboard exposure: grouped by symbol, last price or buy price (marked), loss from today, % of estimated account', () => {
  const st = fresh();
  const a = A.openTrade(st, { symbol: 'AAA', buyDate: '2026-03-01', qty: '10', buyPrice: '100', initialStop: '90', buyCommission: '' }).data;
  const a2 = A.openTrade(st, { symbol: 'AAA', buyDate: '2026-03-02', qty: '10', buyPrice: '110', initialStop: '100', buyCommission: '' }).data;
  const b = A.openTrade(st, { symbol: 'BBB', buyDate: '2026-03-03', qty: '5', buyPrice: '50', initialStop: '45', buyCommission: '' }).data;
  stock(st, 'AAA', 'Tech'); stock(st, 'BBB', 'Retail');
  for (const t of [a, a2]) { t.last = '120'; t.currentStop = '105'; }
  b.last = ''; b.currentStop = '45'; // no last price: buy price is used and the line is marked
  const ex = C.dashExposure(st);
  const A1 = ex.rows.find((r) => r.sym === 'AAA'), B1 = ex.rows.find((r) => r.sym === 'BBB');
  assert.equal(f2(A1.value), '2400.00'); // 20 shares x 120
  assert.equal(f2(A1.loss), '-300.00'); // (105-120) x 20
  assert.equal(f2(A1.pl), '300.00'); // (120-100)x10 + (120-110)x10
  assert.equal(B1.noLast, true); assert.equal(f2(B1.value), '250.00'); assert.equal(B1.pl, null);
  assert.equal(f2(B1.loss), '-25.00'); // (45-50) x 5 at buy price
  assert.equal(ex.rows[0].sym, 'AAA'); // biggest first
  assert.deepEqual(ex.sectors.map((x) => x.key), ['Tech', 'Retail']);
  const acc = C.estimatedAccount(st); // 10 000 + 300 open result (BBB has no last price)
  assert.equal(f2(acc), '10300.00');
  assert.equal(fx(ex.totalPct, 2), fx(D.pct(D.d('2650'), acc), 2));
});

test('Dashboard months: result by sale date, % of capital on the 1st, trades closed that month, running total', () => {
  const st = fresh();
  const a = A.openTrade(st, { symbol: 'AAA', buyDate: '2026-02-10', qty: '10', buyPrice: '100', initialStop: '90', buyCommission: '' }).data;
  A.closeSale(st, { date: '2026-02-20', price: '120', commission: '', allocations: [{ tradeId: a.id, qty: '10' }] }); // +200 in Feb
  const b = A.openTrade(st, { symbol: 'BBB', buyDate: '2026-03-01', qty: '10', buyPrice: '50', initialStop: '45', buyCommission: '' }).data;
  A.closeSale(st, { date: '2026-03-05', price: '45', commission: '', allocations: [{ tradeId: b.id, qty: '5' }] }); // -25 in Mar, still open
  A.closeSale(st, { date: '2026-04-02', price: '40', commission: '', allocations: [{ tradeId: b.id, qty: '5' }] }); // -50 in Apr, closed in Apr
  const ms = C.monthStats(st, '2026-01-01', '2026-12-31');
  assert.equal(ms.length, 12);
  const by = Object.fromEntries(ms.map((m) => [m.month, m]));
  assert.equal(by['2026-01'].has, false);
  assert.equal(f2(by['2026-02'].net), '200.00'); assert.equal(fx(by['2026-02'].pct, 2), '2.00'); // of 10 000 on 1 Feb
  assert.equal(by['2026-02'].closed, 1); assert.equal(by['2026-02'].won, 1); assert.equal(by['2026-02'].best.sym, 'AAA');
  assert.equal(f2(by['2026-03'].net), '-25.00'); assert.equal(by['2026-03'].closed, 0); // a part sale, the trade is not closed yet
  assert.equal(f2(by['2026-04'].net), '-50.00'); assert.equal(by['2026-04'].closed, 1); assert.equal(by['2026-04'].lost, 1);
  assert.equal(f2(by['2026-04'].run), '125.00'); // 200 - 25 - 50
  assert.equal(fx(by['2026-03'].pct, 4), fx(D.pct(D.d('-25'), D.d('10200')), 4)); // capital on 1 Mar = 10 200
});

test('Dashboard setups: closed trades in the period, win rate = wins / (wins + losses), average R', () => {
  const st = fresh();
  const s1 = A.addListItem(st, 'setups', 'VCP').data;
  const t1 = A.openTrade(st, { symbol: 'AAA', buyDate: '2026-02-01', qty: '10', buyPrice: '100', initialStop: '90', buyCommission: '', setupId: s1.id }).data;
  const t2 = A.openTrade(st, { symbol: 'BBB', buyDate: '2026-02-01', qty: '10', buyPrice: '100', initialStop: '90', buyCommission: '', setupId: s1.id }).data;
  const t3 = A.openTrade(st, { symbol: 'CCC', buyDate: '2026-02-01', qty: '10', buyPrice: '100', initialStop: '90', buyCommission: '', setupId: s1.id }).data;
  const t4 = A.openTrade(st, { symbol: 'DDD', buyDate: '2026-02-01', qty: '10', buyPrice: '100', initialStop: '90', buyCommission: '' }).data;
  t1.setupId = t2.setupId = t3.setupId = s1.id;
  A.closeSale(st, { date: '2026-02-10', price: '120', commission: '', allocations: [{ tradeId: t1.id, qty: '10' }] }); // +2 R
  A.closeSale(st, { date: '2026-02-11', price: '95', commission: '', allocations: [{ tradeId: t2.id, qty: '10' }] }); // -0,5 R
  A.closeSale(st, { date: '2026-02-12', price: '100', commission: '', allocations: [{ tradeId: t3.id, qty: '10' }] }); // 0
  A.closeSale(st, { date: '2025-12-30', price: '100', commission: '', allocations: [{ tradeId: t4.id, qty: '10' }] }); // outside the period
  const ss = C.setupStats(st, '2026-01-01', '2026-12-31');
  assert.equal(ss.length, 1);
  const g = ss[0];
  assert.equal(g.name, 'VCP'); assert.equal(g.n, 3); assert.equal(g.won, 1); assert.equal(g.lost, 1); assert.equal(g.zero, 1);
  assert.equal(fx(g.winRate, 0), '50'); // the trade at 0 is left out
  assert.equal(fx(g.avgR, 2), '0.50'); // (2 - 0,5 + 0) / 3
  assert.equal(f2(g.net), '150.00');
});

test('Dashboard capital curve: highest, lowest and the deepest drop from a peak', () => {
  const st = fresh();
  const a = A.openTrade(st, { symbol: 'AAA', buyDate: '2026-02-01', qty: '10', buyPrice: '100', initialStop: '90', buyCommission: '' }).data;
  A.closeSale(st, { date: '2026-02-10', price: '200', commission: '', allocations: [{ tradeId: a.id, qty: '10' }] }); // 11 000
  const b = A.openTrade(st, { symbol: 'BBB', buyDate: '2026-03-01', qty: '10', buyPrice: '100', initialStop: '90', buyCommission: '' }).data;
  A.closeSale(st, { date: '2026-03-10', price: '45', commission: '', allocations: [{ tradeId: b.id, qty: '10' }] }); // 10 450
  const cv = C.capitalCurve(st);
  assert.equal(f2(cv.high.capital), '11000.00'); assert.equal(f2(cv.low.capital), '10000.00');
  assert.equal(fx(cv.drop.pct, 2), '-5.00'); // 11 000 -> 10 450
  assert.equal(cv.drop.from.date, '2026-02-10'); assert.equal(cv.drop.to.date, '2026-03-10');
});

test('Dashboard: months between two dates', () => {
  assert.deepEqual(C.monthsBetween('2025-11-15', '2026-02-01'), ['2025-11', '2025-12', '2026-01', '2026-02']);
});
