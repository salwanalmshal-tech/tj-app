import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFromSheets, toSheets, plainSheets } from '../js/importer.js';
import * as C from '../js/calc.js';
import * as D from '../js/decimal.js';

const base = () => ({
  'Capital start': [{ 'Start capital (USD)': 20000, 'Start date': '05-01-2026' }],
  'Deposits withdrawals': [{ Date: '12-05-2026', 'Type (Deposit or Withdrawal)': 'Deposit', 'Amount (USD)': 2000 }],
  Dividends: [{ 'Pay date': '15-09-2026', Symbol: 'XOM', 'Net amount (USD)': 120 }],
  'Open positions': [
    { 'Trade ID': 'T-0007', Symbol: 'AMN', 'Buy date': '12-10-2026', Quantity: 20, 'Buy price': 24.8, 'Initial stop': 23.6, 'Current stop': 24.6, 'Last price': 25.4, 'Buy commission': 0.67, Setup: 'Qualmagi' },
    { Symbol: 'XOM', 'Buy date': '01-06-2026', Quantity: 15, 'Buy price': 100, 'Example row (ignored by import)': 'EXAMPLE' },
  ],
  History: [
    { 'Trade ID': 'T-0007', Symbol: 'AMN', 'Buy date': '12-10-2026', 'Sell date': '20-10-2026', 'Quantity sold': 10, 'Buy price': 24.8, 'Sell price': 26.2, 'Buy commission (share for these shares)': 0.33, 'Sell commission': 1, 'Initial stop': 23.6, Error: 'Early exit' },
    { Symbol: 'NUE', 'Buy date': '02-02-2026', 'Sell date': '03-03-2026', 'Quantity sold': 5, 'Buy price': 100, 'Sell price': 110, 'Sell commission': 1, 'Initial stop': 95 },
  ],
  Notes: [{ a: 1 }],
});
test('import: builds one consistent state; partly sold trade is one trade; example rows skipped; extra sheet listed', () => {
  const r = buildFromSheets(base());
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepEqual(r.ignoredSheets, ['Notes']);
  assert.equal(r.summary.trades, 2 + 0 + 0 || 2, 'AMN + NUE (example XOM row skipped)');
  const amn = r.state.trades.find((t) => t.buyPrice === '24.8');
  assert.equal(amn.qty, '30'); assert.equal(C.soldQty(amn), D.d('10')); assert.equal(D.toStr(C.openQty(amn)), '20');
  assert.equal(amn.buyCommission, '1'); assert.equal(r.state.setups.length, 1);
  assert.equal(r.state.dividends.length, 1); assert.ok(r.state.stocks.some((s) => s.symbol === 'XOM'));
  assert.equal(C.quantityProblems(amn).length, 0);
});
test('import: errors stop everything and name sheet and row', () => {
  const b = base(); b['Open positions'][0]['Initial stop'] = 30; b.History[1]['Sell price'] = '';
  const r = buildFromSheets(b); assert.equal(r.ok, false); assert.ok(r.errors.some((e) => e.sheet === 'Open positions' && e.row === 2 && /below the buy price/.test(e.msg))); assert.ok(r.errors.some((e) => e.sheet === 'History' && /Sell price is missing/.test(e.msg)));
  const c = base(); c['Capital start'] = []; assert.equal(buildFromSheets(c).ok, false);
  const d = base(); d.History[1]['Buy date'] = '01-01-2025'; assert.ok(buildFromSheets(d).errors.some((e) => /before the start capital date/.test(e.msg)));
});
test('export then import gives the same trades and the same capital', () => {
  const a = buildFromSheets(base()).state;
  const b = buildFromSheets(plainSheets(toSheets(a)));
  assert.ok(b.ok, JSON.stringify(b.errors));
  assert.equal(b.state.trades.length, a.trades.length);
  assert.equal(C.capitalNow(b.state), C.capitalNow(a));
  const net = (s) => s.trades.reduce((x, t) => x + C.realized(t), 0n);
  assert.equal(net(b.state), net(a));
});
