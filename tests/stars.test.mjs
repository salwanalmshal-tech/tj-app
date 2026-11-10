// Setup rating (stars, 2026-11-10): 0,5 to 5 stars per trade, only for a real setup; a setup change clears them.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/actions.js';
import { emptyState, dataProblems } from '../js/model.js';
import { buildFromSheets, toSheets, plainSheets } from '../js/importer.js';
import { analyse, filtered, presetGroups } from '../js/ui/history.js';

function journal() {
  const st = emptyState(); assert.ok(A.setStartCapital(st, { amount: '6000', date: '2026-01-01' }).ok);
  const vcp = A.addListItem(st, 'setups', 'VCP_low').data, flag = A.addListItem(st, 'setups', 'High Flag').data;
  const none = A.addListItem(st, 'setups', 'No setup').data, uncl = A.addListItem(st, 'setups', 'Unclassified').data;
  return { st, vcp, flag, none, uncl };
}
const open = (st, sym, extra = {}) => A.openTrade(st, { symbol: sym, buyDate: '2026-02-02', qty: '10', buyPrice: '10', initialStop: '9', buyCommission: '1', ...extra });

test('stars: a real setup keeps 0,5 to 5 in half steps; wrong values are refused', () => {
  const { st, vcp } = journal();
  assert.equal(open(st, 'AAA', { setupId: vcp.id, stars: 3.5 }).data.stars, 3.5);
  assert.equal(open(st, 'BBB', { setupId: vcp.id }).data.stars, null);
  for (const bad of [0.3, 5.5, 2.25, 'x']) assert.equal(open(st, 'CCC', { setupId: vcp.id, stars: bad }).ok, false, String(bad));
  assert.equal(A.normStars('4,5'), 4.5); assert.equal(A.normStars(''), null); assert.equal(A.normStars(0), null);
});
test('stars: "No setup", "Unclassified" and an empty setup cannot be rated', () => {
  const { st, none, uncl } = journal();
  assert.equal(open(st, 'AAA', { setupId: none.id, stars: 4 }).data.stars, null);
  const t = open(st, 'BBB', { setupId: uncl.id }).data, u = open(st, 'CCC', {}).data;
  assert.equal(A.editDaily(st, t.id, 'stars', 3).ok, false);
  assert.equal(A.editDaily(st, u.id, 'stars', 3).ok, false);
  assert.equal(A.canRate(st, none.id), false); assert.equal(A.canRate(st, null), false);
});
test('stars: changing the setup clears them; the same setup keeps them', () => {
  const { st, vcp, flag } = journal();
  const t = open(st, 'AAA', { setupId: vcp.id, stars: 4 }).data;
  assert.ok(A.editDaily(st, t.id, 'setupId', vcp.id).ok); assert.equal(t.stars, 4);
  assert.ok(A.editDaily(st, t.id, 'setupId', flag.id).ok); assert.equal(t.stars, null);
  assert.ok(A.editDaily(st, t.id, 'stars', 2.5).ok); assert.equal(t.stars, 2.5);
  assert.ok(A.editDaily(st, t.id, 'stars', null).ok); assert.equal(t.stars, null);
});
test('stars: a data file with a wrong rating is not used', () => {
  const { st, vcp } = journal(); const t = open(st, 'AAA', { setupId: vcp.id, stars: 2 }).data;
  assert.deepEqual(dataProblems(st), []);
  t.stars = 7; assert.ok(dataProblems(st).some((p) => /stars/.test(p)));
});
test('stars: Excel export then import keeps the rating', () => {
  const { st, vcp, none } = journal();
  open(st, 'AAA', { setupId: vcp.id, stars: 4.5 }); open(st, 'BBB', { setupId: none.id });
  const t = open(st, 'CCC', { setupId: vcp.id, stars: 1 }).data;
  assert.ok(A.closeSale(st, { date: '2026-02-10', price: '11', commission: '1', allocations: [{ tradeId: t.id, qty: '10' }] }).ok);
  const r = buildFromSheets(plainSheets(toSheets(st))); assert.ok(r.ok, JSON.stringify(r.errors));
  const by = (sym) => r.state.trades.find((x) => r.state.stocks.find((s) => s.id === x.stockId).symbol === sym);
  assert.equal(by('AAA').stars, 4.5); assert.equal(by('BBB').stars, null); assert.equal(by('CCC').stars, 1);
  const w = plainSheets(toSheets(st)); w['Open positions'][0].Stars = 9;
  const r2 = buildFromSheets(w); assert.ok(r2.ok); assert.ok(r2.warnings.some((x) => /Stars/.test(x.msg)));
});
test('stars in History: filter from … to, "not rated", and the 4–5 vs 0,5–2 comparison', () => {
  const { st, vcp, none } = journal();
  const mk = (sym, stars, setupId = vcp.id) => { const t = open(st, sym, { setupId, stars }).data; assert.ok(A.closeSale(st, { date: '2026-02-10', price: '11', commission: '1', allocations: [{ tradeId: t.id, qty: '10' }] }).ok); };
  mk('AAA', 5); mk('BBB', 4); mk('CCC', 2); mk('DDD', 0.5); mk('EEE', null); mk('FFF', null, none.id);
  const syms = (ts) => ts.map((t) => t.symRaw).sort().join(',');
  assert.equal(analyse(st).trades.find((t) => t.symRaw === 'AAA').stars, 5);
  assert.equal(syms(filtered(st, { starsFrom: '4', starsTo: '5' })), 'AAA,BBB');
  assert.equal(syms(filtered(st, { starsTo: '2' })), 'CCC,DDD');
  assert.equal(syms(filtered(st, { starsFrom: 'none' })), 'EEE'); // "No setup" is complete: not counted as not rated
  const [a, b] = presetGroups(st, 'stars'); assert.equal(syms(a), 'AAA,BBB'); assert.equal(syms(b), 'CCC,DDD');
});
