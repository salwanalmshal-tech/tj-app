// 10-scenario test plan (M3), part 2: import, upgrade, restore, trade maths, rounding, big file
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../js/decimal.js';
import * as A from '../js/actions.js';
import * as C from '../js/calc.js';
import { emptyState, checkFile, migrate, needsUpdateBackup, APP_VERSION, SCHEMA } from '../js/model.js';
import { buildFromSheets, toSheets, plainSheets } from '../js/importer.js';
import { lineMarks } from '../js/marks.js';
import { backupsToDelete } from '../js/storage.js';

const fresh = (amount = '6000', date = '2025-06-02') => { const st = emptyState(); assert.ok(A.setStartCapital(st, { amount, date }).ok); return st; };

test('S5 large import with errors: every bad row is named with sheet and row, nothing is imported, and it is quick', () => {
  const open = []; for (let i = 0; i < 2000; i++) open.push({ Symbol: 'S' + i, 'Buy date': '02-06-2025', Quantity: 10, 'Buy price': 50, 'Initial stop': i % 500 === 7 ? 60 : 45, 'Buy commission': 1 });
  open[100]['Buy date'] = '31-02-2025'; open[200].Quantity = ''; open[300].Symbol = '';
  const t0 = Date.now(); const r = buildFromSheets({ 'Capital start': [{ 'Start capital (USD)': 6000, 'Start date': '01-06-2025' }], 'Open positions': open, History: [] });
  assert.equal(r.ok, false); assert.ok(Date.now() - t0 < 5000, 'under 5 seconds');
  for (const row of [102, 202, 302, 9]) assert.ok(r.errors.some((e) => e.sheet === 'Open positions' && e.row === row), 'row ' + row);
  assert.ok(r.errors.length >= 7);
});
test('S6 upgrade: an older file triggers the before-update backup, upgrades on a copy, and a newer file is refused', () => {
  const old = emptyState(); old.meta.version = '1.0.0'; delete old.splits; delete old.settings.excelCopyDays;
  assert.equal(needsUpdateBackup(old), true); assert.equal(needsUpdateBackup(migrate(old)), false);
  const before = JSON.stringify(old); const up = migrate(old);
  assert.equal(JSON.stringify(old), before, 'the original stays untouched (rollback = keep using it)');
  assert.deepEqual(up.splits, []); assert.equal(up.settings.excelCopyDays, 7); assert.equal(up.meta.version, APP_VERSION);
  const newer = emptyState(); newer.meta.schema = SCHEMA + 1; assert.equal(checkFile(newer).ok, false);
});
test('S7 restore with a damaged or empty file is refused with a clear reason', () => {
  for (const bad of [null, {}, { meta: {} }, { meta: { app: 'other' } }, 'text']) { const c = checkFile(bad); assert.equal(c.ok, false); assert.ok(c.reason.length > 10); }
  assert.equal(checkFile(emptyState()).ok, true);
});
test('S8 partial sales, split, reopen: quantities tie out and money results stay exact', () => {
  const st = fresh(); const t = A.openTrade(st, { symbol: 'ABC', buyDate: '2025-06-02', qty: '90', buyPrice: '30', initialStop: '27', buyCommission: '3' }).data;
  assert.ok(A.closeSale(st, { date: '2025-06-10', price: '33', commission: '1', allocations: [{ tradeId: t.id, qty: '30' }] }).ok);
  const net1 = C.realized(t);
  assert.ok(A.applySplit(st, t.stockId, '3', '1', '2025-06-15').ok);
  assert.equal(D.toStr(C.openQty(t)), '180'); assert.equal(C.realized(t), net1, 'split keeps the money result');
  assert.ok(A.closeSale(st, { date: '2025-06-20', price: '12', commission: '2', allocations: [{ tradeId: t.id, qty: '180' }] }).ok);
  assert.equal(C.openQty(t), 0n); assert.equal(C.quantityProblems(t).length, 0);
  const sumBuyShares = C.salesDetail(t).reduce((a, x) => a + x.buyShare, 0n); assert.equal(sumBuyShares, D.d('3'), 'buy commission split adds up exactly');
  const last = t.sales.at(-1).id; assert.ok(A.reopenSales(st, t.id, [last]).ok); assert.equal(D.toStr(C.openQty(t)), '180');
  assert.equal(C.quantityProblems(t).length, 0);
});
test('S9 rounding and month/year boundaries: thirds add up exactly; sales count in the month and year of the sale date', () => {
  const st = fresh('6000', '2025-01-01');
  const ts = ['A', 'B', 'C'].map((s) => A.openTrade(st, { symbol: s, buyDate: '2025-12-30', qty: '1', buyPrice: '10', initialStop: '9', buyCommission: '' }).data);
  assert.ok(A.closeSale(st, { date: '2025-12-31', price: '11', commission: '1', allocations: ts.map((t) => ({ tradeId: t.id, qty: '1' })) }).ok);
  const comms = ts.map((t) => D.d(t.sales[0].commission)); assert.equal(comms.reduce((a, b) => a + b, 0n), D.d('1'));
  const t2 = A.openTrade(st, { symbol: 'D', buyDate: '2025-12-31', qty: '1', buyPrice: '10', initialStop: '9' }).data;
  assert.ok(A.closeSale(st, { date: '2026-01-01', price: '12', commission: '', allocations: [{ tradeId: t2.id, qty: '1' }] }).ok);
  assert.equal(C.monthResult(st, '2025-12'), D.d('2')); assert.equal(C.monthResult(st, '2026-01'), D.d('2'));
  assert.equal(C.yearResult(st, '2025'), D.d('2')); assert.equal(C.yearResult(st, '2026'), D.d('2'));
  assert.equal(C.capitalNow(st), D.d('6004'));
});
test('S10 big file: 5 000 trades and a long log stay fast (calculations, marks, export, import, save size)', () => {
  const open = [], hist = [];
  for (let i = 0; i < 5000; i++) {
    const day = `${String(1 + (i % 28)).padStart(2, '0')}-${String(1 + (i % 12)).padStart(2, '0')}-2021`;
    const row = { Symbol: 'S' + (i % 300), 'Buy date': day, Quantity: 10, 'Buy price': (20 + i / 1000).toFixed(3), 'Initial stop': 19, 'Buy commission': 1 };
    if (i % 5) hist.push({ ...row, 'Sell date': day, 'Quantity sold': 10, 'Sell price': 19 + (i % 4), 'Sell commission': 1 }); else open.push({ ...row, 'Current stop': 19.5, 'Last price': 21 });
  }
  const t0 = Date.now(); const r = buildFromSheets({ 'Capital start': [{ 'Start capital (USD)': 6000, 'Start date': '01-01-2020' }], 'Open positions': open, History: hist });
  assert.ok(r.ok, JSON.stringify(r.errors?.slice(0, 3))); const st = r.state; assert.equal(st.trades.length, 5000);
  for (let i = 0; i < 6000; i++) st.changeLog.push({ ts: new Date().toISOString(), type: 'edit', tradeId: 'T-0001', field: 'qty', old: '1', new: '2' });
  const importMs = Date.now() - t0; const t1 = Date.now();
  const acc = C.estimatedAccount(st); for (const t of C.openTrades(st)) lineMarks(st, t, '2021-12-31', acc);
  A.capitalDiffs(st); const draft = structuredClone(st); assert.ok(A.editDaily(draft, C.openTrades(draft)[0].id, 'last', '22').ok);
  const sheets = toSheets(st); const json = JSON.stringify(st);
  const work = Date.now() - t1;
  assert.ok(importMs < 10000, `import took ${importMs} ms`); assert.ok(work < 3000, `screens' work took ${work} ms`); assert.ok(json.length < 8e6, 'data file below 8 MB');
  assert.equal(sheets['Open positions'].length, 1000); assert.equal(sheets.History.length, 4000);
  assert.ok(buildFromSheets(plainSheets(sheets)).ok);
  // backups of two years stay bounded
  const list = Array.from({ length: 730 }, (_, i) => ({ id: 'b' + i, kind: 'auto', time: new Date(Date.UTC(2026, 10, 4) - i * 86400000).toISOString() }));
  assert.ok(list.length - backupsToDelete(list, Date.UTC(2026, 10, 4)).length <= 10 + 31 + 13);
});
