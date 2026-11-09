// History (2026-11-09): its numbers must always equal the program's exact calculations (review fix).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/actions.js';
import * as C from '../js/calc.js';
import * as D from '../js/decimal.js';
import { emptyState } from '../js/model.js';
import { analyse } from '../js/ui/history.js';

function journal() {
  const st = emptyState(); assert.ok(A.setStartCapital(st, { amount: '6000', date: '2026-01-01' }).ok);
  const open = (sym, date, qty, price, stop, comm = '1') => A.openTrade(st, { symbol: sym, buyDate: date, qty, buyPrice: price, initialStop: stop, buyCommission: comm }).data;
  const sell = (t, date, qty, price, comm = '1') => assert.ok(A.closeSale(st, { date, price, commission: comm, allocations: [{ tradeId: t.id, qty }] }).ok);
  const a = open('AAA', '2026-02-02', '3', '10', '9.70'); sell(a, '2026-02-03', '3', '9.665', '0.35');      // exactly 3 % stop distance; tiny loss
  const b = open('BBB', '2026-02-05', '7', '33.33', '31.1'); sell(b, '2026-02-20', '4', '40.01'); sell(b, '2026-03-01', '3', '44.444', '0.33');
  const c = open('CCC', '2026-03-02', '10', '20', '19'); sell(c, '2026-03-03', '10', '18.5');                // fails right away
  const d = open('DDD', '2026-03-05', '5', '50', '48'); sell(d, '2026-03-20', '5', '56', '1');               // R = exactly 2,x
  const e = open('EEE', '2026-04-01', '9', '12.34', ''); sell(e, '2026-04-02', '9', '12.11');               // no stop
  open('FFF', '2026-04-03', '2', '10', '9');                                                                 // still open: not in History
  return st;
}

test('History net, R, labels and stop distance equal calc.js for every closed trade', () => {
  const st = journal(); const r = analyse(st);
  assert.equal(r.trades.length, 5);
  for (const t of r.trades) {
    const src = st.trades.find((x) => x.id === t.id);
    assert.equal(t.net, Number(D.fmt(C.realized(src), 2).replace('−', '-').replace(/\s/g, '').replace(',', '.')), t.id + ' net');
    assert.equal(t.labelRaw, C.rCategory(C.rMultiple(src), st.settings) ?? '–', t.id + ' label');
    assert.equal(t.sdRaw, C.stopDistanceLabel(C.stopDistancePct(src), st.settings) ?? 'No SL', t.id + ' stop distance');
    assert.equal(t.days, C.holdingDays(src), t.id + ' days');
  }
  const total = st.trades.filter((x) => C.openQty(x) === 0n).reduce((s, x) => s + C.realized(x), 0n);
  assert.equal(r.stats.net, Number(D.fmt(total, 2).replace('−', '-').replace(/\s/g, '').replace(',', '.')));
  assert.equal(r.trades.find((t) => t.symRaw === 'AAA').sdRaw, C.stopDistanceLabel(D.d('3'), st.settings)); // exactly on the limit
});

test('History checks: verdicts work on a small journal, and typed names are made safe text', () => {
  const st = journal(); st.stocks[0].symbol = '<b>X</b>';
  const r = analyse(st);
  assert.equal(r.checks.length, 7);
  for (const c of r.checks) assert.ok(['good', 'watch', 'bad', 'na'].includes(c.v), c.name);
  const t = r.trades.find((x) => x.symRaw === '<b>X</b>'); assert.equal(t.sym, '&lt;b&gt;X&lt;/b&gt;');
  for (const c of r.checks) assert.ok(!/<b>X<\/b>/.test(c.body + c.head + c.detail), c.name + ' contains raw HTML from a symbol');
});
