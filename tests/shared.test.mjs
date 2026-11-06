// Same stock, several open trades: shared daily values (agreed 2026-11-06)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/actions.js';
import { emptyState } from '../js/model.js';

function setup() {
  const st = emptyState();
  assert.ok(A.setStartCapital(st, { amount: '6000', date: '2026-01-01' }).ok);
  const a = A.openTrade(st, { symbol: 'WPP', buyDate: '2026-11-02', qty: '11', buyPrice: '27,148', initialStop: '26' }).data;
  const b = A.openTrade(st, { symbol: 'WPP', buyDate: '2026-11-04', qty: '11', buyPrice: '28,60', initialStop: '27' }).data;
  const c = A.openTrade(st, { symbol: 'WMT', buyDate: '2026-10-23', qty: '4', buyPrice: '120,42', initialStop: '116' }).data;
  return { st, a, b, c };
}

test('a new trade in a stock already held takes the shared values; highest = the higher', () => {
  const { a, b } = setup();
  assert.equal(a.last, '28.6'); assert.equal(b.last, '28.6'); // the newest buy is the newest price
  assert.equal(a.highest, '28.6'); assert.equal(b.highest, '28.6');
});
test('last price, EMA10 and next report go to every open line of the stock, not to other stocks', () => {
  const { st, a, b, c } = setup();
  assert.ok(A.editDaily(st, b.id, 'last', '29,10').ok);
  assert.ok(A.editDaily(st, a.id, 'ema10', '28').ok);
  assert.ok(A.editDaily(st, a.id, 'nextReport', '2027-02-25').ok);
  for (const t of [a, b]) { assert.equal(t.last, '29.1'); assert.equal(t.ema10, '28'); assert.equal(t.nextReport, '2027-02-25'); }
  assert.equal(c.ema10, ''); assert.equal(c.nextReport, '');
  assert.ok(A.editDaily(st, a.id, 'ema10', '').ok); assert.equal(b.ema10, ''); // clearing is shared too (latest wins)
  assert.ok(A.editDaily(st, a.id, 'currentStop', '27,5').ok); assert.equal(b.currentStop, '27'); // stops are per line
});
test('highest price: strictly highest wins; only "Correct highest price" can lower it (logged, all lines)', () => {
  const { st, a, b } = setup();
  assert.ok(A.editDaily(st, a.id, 'highest', '30').ok); assert.equal(b.highest, '30');
  const low = A.editDaily(st, b.id, 'highest', '29'); assert.equal(low.ok, false); assert.equal(a.highest, '30');
  assert.equal(A.editDaily(st, b.id, 'highest', '').ok, false);
  const n = st.changeLog.length;
  assert.ok(A.correctHighest(st, b.id, '29,40').ok);
  assert.equal(a.highest, '29.4'); assert.equal(b.highest, '29.4'); assert.equal(st.changeLog.length, n + 2);
});
test('closed trades are not part of the sync; a reopened trade joins at once', () => {
  const { st, a, b } = setup();
  assert.ok(A.closeSale(st, { date: '2026-11-05', price: '29', commission: '1', allocations: [{ tradeId: a.id, qty: '11' }] }).ok);
  assert.ok(A.editDaily(st, b.id, 'last', '31').ok); assert.ok(A.editDaily(st, b.id, 'highest', '32').ok);
  assert.equal(a.last, '28.6'); assert.equal(a.highest, '28.6');
  assert.ok(A.editDaily(st, a.id, 'last', '20').ok); assert.equal(b.last, '31'); // editing a closed line stays on that line
  assert.ok(A.reopenSales(st, a.id, [a.sales[0].id]).ok);
  assert.equal(a.last, '31'); assert.equal(a.highest, '32');
});
test('existing lines that differ: found per stock, higher highest used, his choices applied', () => {
  const { st, a, b, c } = setup();
  const c2 = A.openTrade(st, { symbol: 'WMT', buyDate: '2026-10-29', qty: '8', buyPrice: '120,88', initialStop: '119,45' }).data;
  // simulate data from before this version
  a.last = '28'; b.last = '28,9'.replace(',', '.'); a.highest = '29'; b.highest = '30'; a.ema10 = '27'; b.ema10 = '27';
  c.highest = '124.51'; c2.highest = '124.51';
  const d = A.sharedDiffs(st);
  assert.equal(d.length, 1); assert.equal(d[0].symbol, 'WPP'); assert.equal(d[0].highest, '30');
  assert.deepEqual(d[0].fields.map((f) => f.field), ['last']);
  assert.ok(A.alignShared(st, { [a.stockId]: { last: '28.9' } }).ok);
  assert.equal(a.last, '28.9'); assert.equal(a.highest, '30'); assert.equal(A.sharedDiffs(st).length, 0);
  // no choice given: highest is still aligned, the open question stays
  a.last = '1'; a.highest = '31';
  assert.ok(A.alignShared(st).ok); assert.equal(b.highest, '31'); assert.equal(a.last, '1');
  assert.equal(A.sharedDiffs(st)[0].fields[0].field, 'last');
});

test('deleted trade: gone everywhere at once, in the Trash 15 days, then gone for good incl. its log lines', () => {
  const { st, a, b } = setup();
  A.editDaily(st, a.id, 'currentStop', '26,5');
  assert.ok(A.deleteTrade(st, a.id).ok);
  assert.equal(st.trades.some((t) => t.id === a.id), false); assert.equal(st.trash.length, 1);
  const day = 86400000, at = Date.parse(st.trash[0].deletedAt);
  assert.equal(A.purgeTrash(st, at + 14 * day).ok, false); assert.equal(st.trash.length, 1);
  assert.ok(A.purgeTrash(st, at + 15 * day).ok); assert.equal(st.trash.length, 0);
  assert.equal(st.changeLog.some((e) => e.tradeId === a.id), false); assert.equal(st.stopHistory.some((e) => e.tradeId === a.id), false);
  assert.equal(st.changeLog.some((e) => e.tradeId === b.id), true); // other trades keep their log
});
