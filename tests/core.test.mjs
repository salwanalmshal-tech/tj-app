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
// #14: Lists' "Trades" count must not mix in dividends
test('#14: listUsageDetail counts trades and dividends separately', () => {
  const st = fresh(); const t = open(st).data;
  A.addDividend(st, { stockId: t.stockId, payDate: '2026-09-10', amount: '5' });
  A.addDividend(st, { stockId: t.stockId, payDate: '2026-09-11', amount: '5' });
  const u = A.listUsageDetail(st, 'stocks', t.stockId);
  assert.deepEqual(u, { trades: 1, dividends: 2 });
  assert.equal(A.listUsage(st, 'stocks', t.stockId), 3); // the combined total still used to decide "in use"
});
// #12: Close trade's Mistake dropdown must clear an existing mistake when "None" is chosen
test('#12: editDaily("errorId", null) clears an existing mistake, same as the edit screen', () => {
  const st = fresh(); const t = open(st).data; const e = A.addListItem(st, 'errors', 'FOMO').data;
  assert.ok(A.editDaily(st, t.id, 'errorId', e.id).ok); assert.equal(t.errorId, e.id);
  assert.ok(A.editDaily(st, t.id, 'errorId', null).ok); assert.equal(t.errorId, null);
});
// #24: a "Small position" must get its own tone (blue), not silently fall back to the "Normal" green
test('#24: a small position gets an "info" level mark of its own, not mistaken for Normal', () => {
  const st = fresh(); const t = open(st, { qty: '10' }).data; // $500 of $24000 = 2,08 %: inside the 1-5 % "Small" zone
  A.editDaily(st, t.id, 'last', '50');
  const m = lineMarks(st, t, '2026-09-04', C.estimatedAccount(st));
  const size = m.find((x) => x.text === 'Small position');
  assert.ok(size, 'expected a "Small position" mark'); assert.equal(size.level, 'info');
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
  assert.ok(m.some((x) => x.text.startsWith('Report tomorrow: stop not more than 15 % above buy price') && x.level === 'neg'));
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
test('report near (2026-11-06): red only without profit locked (stop more than 15 % above buy); every orange mark needs attention', async () => {
  const { lineStatus, isException, cardStatus } = await import('../js/marks.js');
  const st = fresh(); const t = open(st, { buyDate: '2026-11-02', qty: '20' }).data;
  for (const [f, v] of [['last', '60'], ['highest', '60'], ['ema10', '55'], ['currentStop', '56']]) A.editDaily(st, t.id, f, v);
  A.editDaily(st, t.id, 'nextReport', '2026-11-04'); // tomorrow; stop 56 is 12 % above buy 50 -> not locked -> red
  let mk = lineMarks(st, t, '2026-11-03', C.estimatedAccount(st));
  assert.ok(mk.some((m) => m.text.startsWith('Report tomorrow') && m.level === 'neg')); assert.equal(cardStatus(mk), 'red');
  A.editDaily(st, t.id, 'currentStop', '60'); A.editDaily(st, t.id, 'last', '65'); A.editDaily(st, t.id, 'highest', '65'); // 20 % above buy -> locked -> orange
  mk = lineMarks(st, t, '2026-11-03', C.estimatedAccount(st));
  assert.ok(mk.some((m) => m.text === 'Report tomorrow' && m.level === 'warn')); assert.ok(mk.some((m) => m.text === 'Profit locked in'));
  assert.equal(cardStatus(mk), 'orange'); assert.equal(lineStatus(mk), 'rev');
  A.editDaily(st, t.id, 'nextReport', '2026-11-12'); // next week -> orange, also with profit locked
  mk = lineMarks(st, t, '2026-11-03', C.estimatedAccount(st));
  assert.ok(mk.some((m) => m.text === 'Report next week' && isException(m)));
  A.editDaily(st, t.id, 'nextReport', ''); mk = lineMarks(st, t, '2026-11-03', C.estimatedAccount(st));
  assert.equal(cardStatus(mk), 'green'); assert.equal(lineStatus(mk), 'ok');
});
test('2026-11-06 rule changes: raise stop / far below highest / near EMA10 are orange; stop far below buy needs both settings; old report date', async () => {
  const { isException } = await import('../js/marks.js');
  const st = fresh(); const t = open(st, { qty: '10' }).data; // 10 x 50, stop 47 (6 % below buy): risk 30 / 24 000 = 0,125 % -> below 0,2 %
  for (const [f, v] of [['last', '56'], ['highest', '58'], ['ema10', '55.5']]) A.editDaily(st, t.id, f, v);
  let mk = lineMarks(st, t, '2026-11-03', C.estimatedAccount(st));
  const lv = (text) => mk.find((m) => m.text === text)?.level;
  assert.equal(lv('Raise stop'), 'warn'); assert.equal(lv('Stop far below highest price'), 'warn'); assert.equal(lv('Near EMA10'), 'warn');
  assert.equal(lv('Stop far below buy price'), undefined); // risk too small
  assert.ok(mk.filter((m) => ['Raise stop', 'Stop far below highest price', 'Near EMA10'].includes(m.text)).every(isException));
  const t2 = open(st, { qty: '100' }).data; // 100 x 50, stop 47: risk 300 / 24 000 = 1,25 % -> both true
  for (const [f, v] of [['last', '50'], ['highest', '50'], ['ema10', '49']]) A.editDaily(st, t2.id, f, v);
  mk = lineMarks(st, t2, '2026-11-03', C.estimatedAccount(st)); assert.equal(lv('Stop far below buy price'), 'warn');
  A.editDaily(st, t2.id, 'nextReport', '2026-10-20'); mk = lineMarks(st, t2, '2026-11-03', C.estimatedAccount(st));
  assert.ok(!mk.some((m) => m.text.startsWith('Reported'))); // 14 days ago: no mark (the card still counts the days)
  A.editDaily(st, t2.id, 'nextReport', '2026-10-04'); mk = lineMarks(st, t2, '2026-11-03', C.estimatedAccount(st));
  assert.equal(lv('Reported 30 days ago'), 'warn');
  A.editDaily(st, t2.id, 'ema10', ''); mk = lineMarks(st, t2, '2026-11-03', C.estimatedAccount(st)); assert.equal(lv('Missing: EMA10'), 'warn');
});
test('Q11 missing stops: no Current stop = Act now (red); no Initial stop = Review; both always in Needs your attention', async () => {
  const { lineStatus, isException } = await import('../js/marks.js');
  const st = fresh(); const t = A.openTrade(st, { symbol: 'XYZ', buyDate: '2026-11-02', qty: '10', buyPrice: '50', buyCommission: '1' }).data; // no stops at all
  let mk = lineMarks(st, t, '2026-11-04', C.estimatedAccount(st));
  assert.equal(lineStatus(mk), 'act'); assert.ok(mk.some((m) => m.text === 'Missing: stop' && m.level === 'crit')); assert.ok(mk.some((m) => m.text === 'Missing: Initial stop'));
  A.editDaily(st, t.id, 'currentStop', '48'); mk = lineMarks(st, t, '2026-11-04', C.estimatedAccount(st));
  assert.equal(lineStatus(mk), 'rev'); assert.ok(mk.filter(isException).some((m) => m.text === 'Missing: Initial stop'));
  A.correctInitialStop(st, t.id, '47'); mk = lineMarks(st, t, '2026-11-04', C.estimatedAccount(st));
  assert.ok(!mk.some((m) => m.text === 'Missing: stop' || m.text === 'Missing: Initial stop'));
});
