// The 10-scenario test (2026-11-09): realistic cases from start to finish, every number checked against a hand calculation.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/actions.js';
import * as C from '../js/calc.js';
import * as D from '../js/decimal.js';
import { emptyState, checkFile, migrate } from '../js/model.js';
import { toSheets, buildFromSheets } from '../js/importer.js';
import { analyse } from '../js/ui/history.js';

const $ = (b) => D.toStr(b); // exact text of a value
const capNow = (st) => $(C.capitalBefore(st, '9999-12-31'));
function start() { const st = emptyState(); assert.ok(A.setStartCapital(st, { amount: '10000', date: '2026-01-01' }).ok); return st; }
const open = (st, f) => { const r = A.openTrade(st, f); assert.ok(r.ok, r.error); return r.data; };
const sell = (st, f) => { const r = A.closeSale(st, f); assert.ok(r.ok, r.error); return r.data; };

test('1. open and close in one sale: result, R, label, days, capital', () => {
  const st = start();
  const t = open(st, { symbol: 'AAA', buyDate: '2026-01-05', qty: '100', buyPrice: '10', initialStop: '9.5', buyCommission: '1' });
  assert.equal(t.capitalAtOpen, '10000');
  sell(st, { date: '2026-01-10', price: '11', commission: '1', allocations: [{ tradeId: t.id, qty: '100' }] });
  // 100 × (11 − 10) − 1 − 1 = 98; R = 98 ÷ (0,5 × 100) = 1,96 → GOOD WINNER; 5 days; capital 10 098
  assert.equal($(C.realized(t)), '98'); assert.equal($(C.rMultiple(t)), '1.96');
  assert.equal(C.rCategory(C.rMultiple(t), st.settings), 'GOOD WINNER'); assert.equal(C.holdingDays(t), 5); assert.equal(capNow(st), '10098');
  const h = analyse(st).trades[0]; assert.equal(h.net, 98); assert.equal(h.capPct, 0.98);
});

test('2. add more shares of a stock you hold, then close both lines in one sale', () => {
  const st = start();
  const b1 = open(st, { symbol: 'BBB', buyDate: '2026-02-02', qty: '10', buyPrice: '20', initialStop: '19' });
  const b2 = open(st, { symbol: 'BBB', buyDate: '2026-02-03', qty: '10', buyPrice: '21', initialStop: '20' });
  assert.ok(A.editDaily(st, b2.id, 'last', '21,50').ok); assert.equal(b1.last, '21.5'); // shared last price
  sell(st, { date: '2026-02-10', price: '22', commission: '2', allocations: [{ tradeId: b1.id, qty: '10' }, { tradeId: b2.id, qty: '10' }] });
  // commission split by shares: 1 + 1; b1 = 10 × 2 − 1 = 19 (R 1,9); b2 = 10 × 1 − 1 = 9 (R 0,9)
  assert.equal($(C.realized(b1)), '19'); assert.equal($(C.realized(b2)), '9');
  assert.equal($(C.rMultiple(b1)), '1.9'); assert.equal($(C.rMultiple(b2)), '0.9'); assert.equal(capNow(st), '10028');
  const hb2 = analyse(st).trades.find((x) => x.id === b2.id); assert.equal(hb2.how, 'Added higher');
});

test('3. sell in two parts: buy commission shared out, R on the total, days to the last sale', () => {
  const st = start();
  const t = open(st, { symbol: 'CCC', buyDate: '2026-03-02', qty: '30', buyPrice: '50', initialStop: '48', buyCommission: '3' });
  sell(st, { date: '2026-03-05', price: '54', commission: '1', allocations: [{ tradeId: t.id, qty: '10' }] });
  assert.equal(C.status(t) === 'closed', false); assert.equal($(C.openQty(t)), '20');
  sell(st, { date: '2026-03-20', price: '49', commission: '1', allocations: [{ tradeId: t.id, qty: '20' }] });
  // part 1: 10 × 4 − 1 (buy comm 3 × 10/30) − 1 = 38; part 2: 20 × (−1) − 2 (rest of buy comm) − 1 = −23; total 15
  const det = C.salesDetail(t).map((x) => $(x.net)); assert.deepEqual(det, ['38', '-23']);
  assert.equal($(C.realized(t)), '15'); assert.equal($(C.rMultiple(t)), '0.25'); assert.equal(C.holdingDays(t), 18);
});

test('4. reopen a sale by mistake, then restore it from the Trash', () => {
  const st = start();
  const t = open(st, { symbol: 'DDD', buyDate: '2026-04-01', qty: '5', buyPrice: '100', initialStop: '95' });
  sell(st, { date: '2026-04-08', price: '110', commission: '1', allocations: [{ tradeId: t.id, qty: '5' }] });
  assert.equal(capNow(st), '10049'); // 5 × 10 − 1
  assert.ok(A.reopenSales(st, t.id, [t.sales[0].id]).ok); assert.equal($(C.openQty(t)), '5'); assert.equal(capNow(st), '10000');
  assert.ok(A.restoreFromTrash(st, st.trash.findIndex((e) => e.kind === 'sales')).ok); assert.equal(capNow(st), '10049'); assert.equal($(C.openQty(t)), '0');
});

test('5. delete a closed trade and restore it: capital back to the same number', () => {
  const st = start();
  const t = open(st, { symbol: 'EEE', buyDate: '2026-04-02', qty: '8', buyPrice: '25', initialStop: '24' });
  sell(st, { date: '2026-04-03', price: '23.5', commission: '1', allocations: [{ tradeId: t.id, qty: '8' }] });
  assert.equal(capNow(st), '9987'); // 8 × −1,5 − 1 = −13
  assert.ok(A.deleteTrade(st, t.id).ok); assert.equal(capNow(st), '10000'); assert.equal(st.trades.length, 0);
  assert.ok(A.restoreFromTrash(st, 0).ok); assert.equal(capNow(st), '9987');
});

test('6. a sale entered late with an earlier date: later trades get a new capital at open after recalculation', () => {
  const st = start();
  const late = open(st, { symbol: 'FFF', buyDate: '2026-05-01', qty: '10', buyPrice: '10', initialStop: '9' });
  const later = open(st, { symbol: 'GGG', buyDate: '2026-05-10', qty: '1', buyPrice: '50', initialStop: '45' });
  assert.equal(later.capitalAtOpen, '10000');
  sell(st, { date: '2026-05-05', price: '12', commission: '0', allocations: [{ tradeId: late.id, qty: '10' }] }); // +20 before GGG was bought
  const d = A.capitalDiffs(st); assert.deepEqual(d.map((x) => [x.id, x.after]), [[later.id, '10020']]);
  assert.ok(A.recalcCapital(st).ok); assert.equal(later.capitalAtOpen, '10020'); assert.equal(A.capitalDiffs(st).length, 0);
});

test('7. deposit and withdrawal: capital and capital at open of the next trade', () => {
  const st = start();
  assert.ok(A.addFlow(st, { type: 'deposit', date: '2026-06-01', amount: '2500' }).ok);
  assert.ok(A.addFlow(st, { type: 'withdrawal', date: '2026-06-15', amount: '700' }).ok);
  assert.equal(A.addFlow(st, { type: 'deposit', date: '2025-12-31', amount: '1' }).ok, false); // before the start date
  const t = open(st, { symbol: 'HHH', buyDate: '2026-06-20', qty: '1', buyPrice: '10', initialStop: '9' });
  assert.equal(t.capitalAtOpen, '11800'); assert.equal(capNow(st), '11800');
});

test('8. dividend: counts in capital from its pay date, never before the start date', () => {
  const st = start();
  const t = open(st, { symbol: 'III', buyDate: '2026-07-01', qty: '10', buyPrice: '30', initialStop: '28' });
  assert.ok(A.addDividend(st, { stockId: t.stockId, payDate: '2026-07-15', amount: '4.20' }).ok);
  assert.equal(A.addDividend(st, { stockId: t.stockId, payDate: '2025-06-01', amount: '1' }).ok, false);
  assert.equal(capNow(st), '10004.2'); assert.equal($(C.capitalBefore(st, '2026-07-14')), '10000');
});

test('9. stock split 2:1 on an open trade that was partly sold', () => {
  const st = start();
  const t = open(st, { symbol: 'JJJ', buyDate: '2026-08-03', qty: '20', buyPrice: '40', initialStop: '36', buyCommission: '2' });
  sell(st, { date: '2026-08-10', price: '44', commission: '1', allocations: [{ tradeId: t.id, qty: '10' }] }); // 10 × 4 − 1 − 1 = 38
  const before = C.realized(t);
  assert.ok(A.applySplit(st, t.stockId, '2', '1', '2026-08-15').ok);
  assert.equal(t.qty, '40'); assert.equal(t.buyPrice, '20'); assert.equal(t.initialStop, '18');
  assert.equal(t.sales[0].qty, '20'); assert.equal(t.sales[0].price, '22'); assert.equal($(C.openQty(t)), '20');
  assert.equal($(C.realized(t)), $(before)); // money results do not change with a split
});

test('10. backup and Excel copy: the data comes back the same', () => {
  const st = start();
  const a = open(st, { symbol: 'KKK', buyDate: '2026-09-01', qty: '12', buyPrice: '15.5', initialStop: '14.9', buyCommission: '1' });
  sell(st, { date: '2026-09-04', price: '16.75', commission: '1', allocations: [{ tradeId: a.id, qty: '12' }] });
  open(st, { symbol: 'LLL', buyDate: '2026-09-05', qty: '3', buyPrice: '70', initialStop: '66' });
  assert.ok(A.addFlow(st, { type: 'deposit', date: '2026-09-02', amount: '500' }).ok);
  // backup (.json): same file back
  const back = JSON.parse(JSON.stringify(st)); assert.ok(checkFile(back).ok); const m = migrate(back);
  assert.equal(capNow(m), capNow(st)); assert.deepEqual(m.trades.map((t) => $(C.realized(t))), st.trades.map((t) => $(C.realized(t))));
  // Excel copy: write and read back with "New start"
  // the cells as Excel gives them back (numbers; dates as Excel day numbers), like the program's own Excel writer/reader
  const cell = (v) => (v && typeof v === 'object' ? (v.d ? Math.round((Date.parse(v.d + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000) : Number(v.n)) : v);
  const sheets = Object.fromEntries(Object.entries(toSheets(st)).map(([k, rows]) => [k, rows.map((r) => Object.fromEntries(Object.entries(r).map(([h, v]) => [h, cell(v)])))]));
  const r = buildFromSheets(sheets);
  assert.ok(r.ok !== false && r.state, JSON.stringify(r.errors || r).slice(0, 300));
  assert.equal(capNow(r.state), capNow(st)); // 10 000 + 500 + (12 × 1,25 − 1 − 1 = 13) = 10 513
  assert.equal(capNow(st), '10513');
  assert.deepEqual(r.state.trades.map((t) => [A.symbolOf(r.state, t), t.qty, $(C.openQty(t))]).sort(), [['KKK', '12', '0'], ['LLL', '3', '3']]);
});
