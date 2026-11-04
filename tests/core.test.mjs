import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../js/decimal.js';
import * as A from '../js/actions.js';
import * as C from '../js/calc.js';
import { emptyState } from '../js/model.js';
import { lineMarks } from '../js/marks.js';

function fresh() {
  const st = emptyState();
  assert.ok(A.setStartCapital(st, { amount: '24 000', date: '2026-01-01' }).ok);
  return st;
}
const open = (st, o) => A.openTrade(st, { symbol: 'ABC', buyDate: '2026-09-03', qty: '100', buyPrice: '50', initialStop: '47', buyCommission: '1', ...o });

test('open trade: required fields and stop rule', () => {
  const st = fresh();
  assert.equal(A.openTrade(st, { symbol: 'ABC', buyDate: '2026-09-03', qty: '100', buyPrice: '50', initialStop: '50' }).ok, false);
  assert.equal(A.openTrade(st, { symbol: 'ABC', buyDate: '2025-12-01', qty: '100', buyPrice: '50', initialStop: '47' }).ok, false); // before start date
  const r = open(st); assert.ok(r.ok); assert.equal(r.data.id, 'T-0001'); assert.equal(r.data.capitalAtOpen, '24000');
  assert.equal(open(st).data.id, 'T-0002');
});
test('close trade example from the preview: +837,50, R 2,79, 57 days', () => {
  const st = fresh(); const t = open(st).data;
  const r = A.closeSale(st, { date: '2026-10-30', price: '58,40', commission: '1,50', allocations: [{ tradeId: t.id, qty: '100' }] });
  assert.ok(r.ok);
  assert.equal(D.fmt(C.tradeNet(t), 2, { sign: true }), '+837,50');
  assert.equal(D.fmt(C.rMultiple(t), 2), '2,79');
  assert.equal(C.holdingDays(t), 57); assert.equal(C.status(t), 'closed');
  assert.equal(C.rCategory(C.rMultiple(t), st.settings), 'GOOD WINNER');
});
test('partial sales add up exactly; remainder of buy commission on last part', () => {
  const st = fresh(); const t = open(st, { qty: '3', buyCommission: '1' }).data;
  A.closeSale(st, { date: '2026-10-01', price: '55', commission: '0.10', allocations: [{ tradeId: t.id, qty: '1' }] });
  A.closeSale(st, { date: '2026-10-02', price: '55', commission: '0.10', allocations: [{ tradeId: t.id, qty: '1' }] });
  A.closeSale(st, { date: '2026-10-03', price: '55', commission: '0.10', allocations: [{ tradeId: t.id, qty: '1' }] });
  const det = C.salesDetail(t); const sumShares = det.reduce((a, x) => a + x.buyShare, 0n);
  assert.equal(sumShares, D.d('1')); // exactly the buy commission
  assert.equal(C.tradeNet(t), D.d('15') - D.d('1') - D.d('0.30'));
});
test('one sale across several lines splits the sell commission by shares', () => {
  const st = fresh(); const a = open(st, { qty: '100' }).data; const b = open(st, { qty: '50', buyDate: '2026-09-10' }).data;
  const r = A.closeSale(st, { date: '2026-10-30', price: '60', commission: '3', allocations: [{ tradeId: a.id, qty: '100' }, { tradeId: b.id, qty: '50' }] });
  assert.ok(r.ok); assert.equal(D.d(a.sales[0].commission) + D.d(b.sales[0].commission), D.d('3'));
  assert.equal(a.sales[0].commission, '2'); assert.equal(b.sales[0].commission, '1');
});
test('cannot sell more than open; quantity check blocks buy below sold', () => {
  const st = fresh(); const t = open(st).data;
  assert.equal(A.closeSale(st, { date: '2026-10-30', price: '60', commission: '', allocations: [{ tradeId: t.id, qty: '101' }] }).ok, false);
  A.closeSale(st, { date: '2026-10-30', price: '60', commission: '', allocations: [{ tradeId: t.id, qty: '60' }] });
  const r = A.editBuyData(st, t.id, { qty: '50' }); assert.equal(r.ok, false); assert.equal(t.qty, '100');
  assert.ok(A.editBuyData(st, t.id, { qty: '120' }).ok);
});
test('capital: start + sales + dividends + deposits; trades keep capital at open', () => {
  const st = fresh(); const t = open(st).data;
  A.closeSale(st, { date: '2026-10-30', price: '58.4', commission: '1.5', allocations: [{ tradeId: t.id, qty: '100' }] });
  A.addFlow(st, { date: '2026-11-01', type: 'deposit', amount: '2000' });
  const sid = A.addListItem(st, 'stocks', 'XOM').data.id; A.addDividend(st, { stockId: sid, payDate: '2026-11-02', amount: '40' });
  assert.equal(D.fmt(C.capitalNow(st)), '26\u00a0877,50');
  const t2 = open(st, { symbol: 'XOM', buyDate: '2026-11-03' }).data; assert.equal(t2.capitalAtOpen, '26877.5');
  assert.equal(t.capitalAtOpen, '24000'); // never changed by later deposits
  assert.equal(A.capitalDiffs(st).length, 0);
});
test('same-day order = order entered', () => {
  const st = fresh(); const a = open(st).data;
  A.closeSale(st, { date: '2026-09-03', price: '51', commission: '', allocations: [{ tradeId: a.id, qty: '100' }] });
  const b = open(st, { buyDate: '2026-09-03', symbol: 'DEF' }).data; // entered after the sale
  assert.equal(b.capitalAtOpen, '24099');
});
test('archive blocked with open position; delete only if unused; merge moves links', () => {
  const st = fresh(); const t = open(st).data;
  const r = A.archiveListItem(st, 'stocks', t.stockId); assert.equal(r.ok, false); assert.match(r.error, /still has an open position/);
  assert.equal(A.deleteListItem(st, 'stocks', t.stockId).ok, false);
  const s2 = A.addListItem(st, 'stocks', 'ABD').data; const m = A.renameListItem(st, 'stocks', s2.id, 'abc'); assert.equal(m.error, 'exists');
  const mm = A.renameListItem(st, 'stocks', s2.id, 'abc', { merge: true }); assert.ok(mm.ok); assert.equal(st.stocks.length, 1);
});
test('split on a partly sold trade keeps money results and R', () => {
  const st = fresh(); const t = open(st).data;
  A.closeSale(st, { date: '2026-10-01', price: '60', commission: '', allocations: [{ tradeId: t.id, qty: '40' }] });
  const before = C.realized(t); const rBefore = C.rMultiple(t);
  assert.ok(A.applySplit(st, t.stockId, '4', '1', '2026-10-15').ok);
  assert.equal(t.qty, '400'); assert.equal(C.openQty(t), D.d('240')); assert.equal(t.buyPrice, '12.5');
  assert.equal(C.realized(t), before); assert.equal(C.rMultiple(t), rBefore);
});
test('marks: at or below stop; report tomorrow without profit locked', () => {
  const st = fresh(); const t = open(st, { nextReport: '2026-11-03' }).data;
  A.editDaily(st, t.id, 'last', '46,50');
  const m = lineMarks(st, t, '2026-11-02', C.estimatedAccount(st));
  assert.ok(m.some((x) => x.text === 'At or below stop' && x.level === 'crit'));
  assert.ok(m.some((x) => x.text.startsWith('Report tomorrow: stop not above buy price')));
});
test('reopen puts shares back; undo-safe trash', () => {
  const st = fresh(); const t = open(st).data;
  A.closeSale(st, { date: '2026-10-30', price: '60', commission: '', allocations: [{ tradeId: t.id, qty: '100' }] });
  assert.ok(A.reopenSales(st, t.id, [t.sales[0].id]).ok); assert.equal(C.status(t), 'open');
});
test('stop history logs every Current stop change, also emptying it (C7)', () => {
  const st = fresh(); const t = open(st).data;
  assert.ok(A.editDaily(st, t.id, 'currentStop', '48').ok);
  assert.ok(A.editDaily(st, t.id, 'currentStop', '').ok);
  assert.equal(st.stopHistory.length, 2);
  assert.deepEqual(st.stopHistory.map((x) => [x.old, x.new]), [['47', '48'], ['48', '']]);
  assert.ok(A.editDaily(st, t.id, 'currentStop', '').ok); assert.equal(st.stopHistory.length, 2); // no change, no line
});
test('exceptions: report with profit locked stays calm (G2), without profit it needs review', async () => {
  const { lineStatus } = await import('../js/marks.js');
  const st = fresh(); const t = open(st, { buyDate: '2026-11-02', qty: '20' }).data;
  A.editDaily(st, t.id, 'last', '51'); A.editDaily(st, t.id, 'nextReport', '2026-11-05'); // this week, stop 47 below buy 50
  assert.equal(lineStatus(lineMarks(st, t, '2026-11-03', C.estimatedAccount(st))), 'rev');
  A.editDaily(st, t.id, 'currentStop', '50.5'); // profit locked, price 51 is within 2 % of the stop -> close to stop
  A.editDaily(st, t.id, 'last', '54');
  assert.equal(lineStatus(lineMarks(st, t, '2026-11-03', C.estimatedAccount(st))), 'ok');
  A.editDaily(st, t.id, 'last', '50'); // at or below the stop
  assert.equal(lineStatus(lineMarks(st, t, '2026-11-03', C.estimatedAccount(st))), 'act');
});
test('Q11 missing stops: no Current stop = Act now (red); no Initial stop = Review; both always in Needs your attention', async () => {
  const { lineStatus, isException } = await import('../js/marks.js');
  const st = fresh(); const t = A.openTrade(st, { symbol: 'XYZ', buyDate: '2026-11-02', qty: '10', buyPrice: '50', buyCommission: '1' }).data; // no stops at all
  let mk = lineMarks(st, t, '2026-11-04', C.estimatedAccount(st));
  assert.equal(lineStatus(mk), 'act'); assert.ok(mk.some((m) => m.text === 'Missing: stop' && m.level === 'crit')); assert.ok(mk.some((m) => m.text === 'Missing: Initial stop'));
  A.editDaily(st, t.id, 'currentStop', '48'); mk = lineMarks(st, t, '2026-11-04', C.estimatedAccount(st));
  assert.equal(lineStatus(mk), 'rev'); assert.ok(mk.filter(isException).some((m) => m.text === 'Missing: Initial stop'));
  A.correctInitialStop(st, t.id, '47'); mk = lineMarks(st, t, '2026-11-04', C.estimatedAccount(st));
  assert.ok(!mk.some((m) => m.text.startsWith('Missing')));
});
