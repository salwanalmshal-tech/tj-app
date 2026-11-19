import test from 'node:test'; import assert from 'node:assert/strict';
import * as C from '../js/calc.js'; import * as D from '../js/decimal.js';
const tr = (o) => ({ id: o.id, stockId: 's', buyDate: '2026-05-01', qty: o.qty, buyPrice: o.buy, buyCommission: '0', initialStop: '', currentStop: o.stop ?? '', last: o.last ?? '', highest: o.hi ?? '', sales: o.sales ?? [], capitalAtOpen: '10000' });
test('loss from highest: (stop - highest) x open shares, trades without stop or highest not counted', () => {
  const st = { capital: { start: { amount: '10000', date: '2026-01-01', seq: 1 }, flows: [] }, dividends: [], stocks: [], trades: [
    tr({ id: 'T-1', qty: '10', buy: '100', stop: '110', last: '115', hi: '120' }),
    tr({ id: 'T-2', qty: '10', buy: '50', stop: '45', last: '50', hi: '55', sales: [{ id: 'a', seq: 5, date: '2026-05-05', qty: '4', price: '52', commission: '0' }] }),
    tr({ id: 'T-3', qty: '5', buy: '40', stop: '', last: '41', hi: '42' }),
    tr({ id: 'T-4', qty: '5', buy: '40', stop: '38', last: '41', hi: '' }) ] };
  const r = C.lossFromHighest(st);
  assert.equal(D.fmt(r.loss, 2), D.fmt(D.d('-160'), 2)); // T-1 (110-120)x10 = -100, T-2 (45-55)x6 = -60
  assert.equal(r.missing, 2);
  const today = C.lossIfAllStopsHit(st); assert.ok(r.loss < today.loss, 'from highest is never smaller a loss than from today when highest >= last');
});
