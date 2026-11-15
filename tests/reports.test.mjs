// 1.7.0 Reports + placement (agreed 2026-11-15): one library, used on Dashboard, History and Open positions.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/actions.js';
import * as C from '../js/calc.js';
import { emptyState, migrate } from '../js/model.js';
import { analyse, runReport } from '../js/ui/history.js';

function journal() {
  const st = emptyState(); assert.ok(A.setStartCapital(st, { amount: '10000', date: '2026-01-01' }).ok);
  const vcp = A.addListItem(st, 'setups', 'VCP').data, flag = A.addListItem(st, 'setups', 'Flag').data;
  const T = [['AAA', vcp, '2026-09-02', '2026-09-10', '112'], ['BBB', vcp, '2026-09-05', '2026-09-08', '96'], ['CCC', flag, '2026-10-01', '2026-10-15', '108'], ['DDD', null, '2026-10-03', '2026-10-04', '97']];
  for (const [sym, su, bd, sd, sp] of T) { const t = A.openTrade(st, { symbol: sym, buyDate: bd, qty: '10', buyPrice: '100', initialStop: '95', buyCommission: '1', stockInfo: { sector: sym < 'C' ? 'Tech' : 'Energy', industry: 'I', exchange: 'X' } }).data;
    if (su) A.setTradeSetup(t, su.id); assert.ok(A.closeSale(st, { date: sd, price: sp, commission: '1', allocations: [{ tradeId: t.id, qty: '10' }] }).ok); }
  return st;
}

test('Placement: nothing saved = exactly what each screen showed before 1.7.0', () => {
  const st = journal(); st.layouts.dashboard = { cards: ['loss', 'capital'], blocks: ['curve'], onOpen: ['openpl', 'month'] };
  assert.deepEqual(C.placement(st, 'dashboard'), { cards: ['c.loss', 'c.capital', 'c.openpl', 'c.progress', 'c.month', 'c.year', 'c.market'], blocks: ['d.curve', 'd.exposure', 'd.months', 'd.setups'] });
  assert.deepEqual(C.placement(st, 'history'), { cards: [], blocks: ['h.cards', 'h.verdicts', 'h.big', 'h.time', 'h.open'] });
  assert.deepEqual(C.placement(st, 'open'), { cards: ['c.openpl', 'c.month'], blocks: [] });
  delete st.layouts.dashboard.onOpen; assert.deepEqual(C.placement(st, 'open').cards, ['c.capital', 'c.openpl', 'c.loss', 'c.market']);
});

test('Placement: switch on/off, max 4 number cards on Open positions, cards only among cards', () => {
  const st = journal();
  assert.equal(A.setShown(st, 'open', 'c.year', true).ok, false); // already 4
  assert.ok(A.setShown(st, 'open', 'c.loss', false).ok); assert.ok(A.setShown(st, 'open', 'c.year', true).ok);
  assert.deepEqual(C.placement(st, 'open').cards, ['c.capital', 'c.openpl', 'c.market', 'c.year']); // new one goes last
  assert.equal(A.setShown(st, 'history', 'c.capital', true).ok, false); // History has no number-card row
  assert.equal(A.swapShown(st, 'open', 'c.capital', 'd.curve').ok, false);  // a card only for a card
  assert.ok(A.setShown(st, 'history', 'h.time', false).ok); assert.ok(!C.placement(st, 'history').blocks.includes('h.time'));
  assert.ok(A.setShown(st, 'history', 'h.time', true).ok); assert.equal(C.placement(st, 'history').blocks.at(-1), 'h.time'); // never lost, back at the end
});

test('Placement: swap takes the same place; swapping with one already shown changes places; order and reset order', () => {
  const st = journal();
  assert.ok(A.swapShown(st, 'history', 'h.big', 'd.curve').ok);
  assert.deepEqual(C.placement(st, 'history').blocks, ['h.cards', 'h.verdicts', 'd.curve', 'h.time', 'h.open']);
  assert.ok(A.swapShown(st, 'history', 'd.curve', 'h.open').ok);
  assert.deepEqual(C.placement(st, 'history').blocks, ['h.cards', 'h.verdicts', 'h.open', 'h.time', 'd.curve']);
  assert.equal(A.orderShown(st, 'history', 'block', ['h.cards']).ok, false); // must be the same set
  assert.ok(A.orderShown(st, 'history', 'block', ['d.curve', 'h.cards', 'h.verdicts', 'h.open', 'h.time']).ok);
  assert.ok(A.resetShownOrder(st, 'history').ok);
  assert.deepEqual(C.placement(st, 'history').blocks, ['h.cards', 'h.verdicts', 'h.time', 'h.open', 'd.curve']); // order only, nothing added or removed
});

test('Reports: examples once, save checks, copy, and deleting takes it off every screen', () => {
  const st = journal(); assert.deepEqual(st.reports.map((r) => r.id), ['RP-1', 'RP-2', 'RP-3']);
  const old = structuredClone(st); old.reports = []; delete old.meta.reportsSeeded;
  assert.equal(migrate(old).reports.length, 3);                              // an old file gets the examples once
  const again = migrate(old); again.reports = []; assert.equal(migrate(again).reports.length, 0); // deleted by him: never come back
  assert.equal(A.saveReport(st, { name: ' ', g1: 'month', measures: ['net'] }).ok, false);
  assert.equal(A.saveReport(st, { name: 'X', g1: 'month', g2: 'month', measures: ['net'] }).ok, false);
  assert.equal(A.saveReport(st, { name: 'X', g1: 'month', measures: [] }).ok, false);
  const r = A.saveReport(st, { name: 'By sector', g1: 'sector', measures: ['trades', 'nope', 'net'] }); assert.ok(r.ok); assert.equal(r.data.id, 'RP-4'); assert.deepEqual(r.data.measures, ['trades', 'net']);
  assert.equal(A.copyReport(st, 'RP-4').data.name, 'By sector (copy)');
  assert.ok(A.setShown(st, 'history', 'r:RP-4', true).ok); assert.ok(A.setShown(st, 'dashboard', 'r:RP-4', true).ok);
  assert.equal(A.setShown(st, 'open', 'r:RP-99', true).ok, false);
  assert.ok(A.deleteReport(st, 'RP-4').ok);
  assert.ok(!JSON.stringify(st.layouts.place).includes('RP-4')); assert.equal(st.reports.length, 4);
});

test('Reports engine: same numbers as History, groups, two groupings and its own filters', () => {
  const st = journal(); const all = analyse(st).stats;
  const run = runReport(st, { name: 't', g1: 'setup', g2: '', measures: ['trades', 'net', 'winRate', 'avgR'], filters: { period: 'all' } });
  assert.deepEqual(run.rows.map((r) => [r.label, r.n]), [['Flag', 1], ['VCP', 2], ['Not filled in', 1]]);
  assert.equal(run.total.trades, all.n); assert.equal(run.total.net, all.net); assert.equal(run.total.avgR, all.avgR); assert.equal(run.total.winRate, all.wr * 100);
  assert.equal(run.rows.reduce((a, r) => a + r.vals.net, 0).toFixed(2), all.net.toFixed(2)); // the groups add up to the total
  const two = runReport(st, { name: 't', g1: 'sector', g2: 'month', measures: ['trades'], filters: { period: 'all' } });
  assert.deepEqual(two.rows.map((r) => [r.label, r.n, r.sub.map((x) => x.label + ':' + x.n).join()]), [['Energy', 2, 'Oct 2026:2'], ['Tech', 2, 'Sep 2026:2']]);
  const win = runReport(st, { name: 't', g1: 'month', g2: '', measures: ['trades'], filters: { period: 'all', result: 'winners' } });
  assert.equal(win.trades, 2); assert.deepEqual(win.rows.map((r) => r.label), ['Sep 2026', 'Oct 2026']);
});
