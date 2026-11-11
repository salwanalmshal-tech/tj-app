import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../js/store.js';
import { emptyState } from '../js/model.js';
import * as A from '../js/actions.js';

test('store: failed action changes nothing; success can be undone once; log is kept', () => {
  let saves = 0; const s = new Store(emptyState(), { onSave: () => saves++ });
  assert.equal(s.run((d) => A.setStartCapital(d, { amount: 'abc', date: '2026-01-01' })).ok, false);
  assert.equal(saves, 0); assert.equal(s.state.capital.start, null);
  assert.ok(s.run((d) => A.setStartCapital(d, { amount: '10000', date: '2026-01-01' }), { label: 'Start capital' }).ok);
  assert.equal(saves, 1); assert.ok(s.canUndo());
  s.state.changeLog.push({ type: 'x' });
  assert.ok(s.undo()); assert.equal(s.state.capital.start, null); assert.ok(s.state.changeLog.some((e) => e.type === 'undo'));
  assert.equal(s.canUndo(), false);
});

// #20: deleting a deposit/dividend offers a "Restore" (Undo) toast. A side-effect recalc that runs right after
// (askRecalc -> recalcCapital) must not steal that one-step Undo slot, or Restore would undo the recalc instead.
test('#20: a noUndo side effect after a delete never takes over the "Restore" (Undo) of that delete', () => {
  const s = new Store(emptyState());
  assert.ok(s.run((d) => A.setStartCapital(d, { amount: '10000', date: '2026-01-01' }), { label: 'start capital', now: true }).ok);
  assert.ok(s.run((d) => A.addFlow(d, { date: '2026-02-01', type: 'deposit', amount: '500' }), { label: 'deposit', now: true }).ok);
  const flowId = s.state.capital.flows[0].id;
  assert.ok(s.run((d) => A.openTrade(d, { symbol: 'AAA', buyDate: '2026-03-01', qty: '10', buyPrice: '10' })).ok);
  // delete the deposit (this is the action the "Restore" toast must undo)
  assert.ok(s.run((d) => A.deleteFlow(d, flowId), { label: 'delete line', now: true }).ok);
  assert.equal(s.state.capital.flows.length, 0);
  // the askRecalc side effect that follows, same as js/ui/capital.js
  assert.ok(s.run((d) => A.recalcCapital(d), { label: 'capital at open', now: true, noUndo: true }).ok);
  // "Restore" (Undo) must bring the deposit back, not undo the recalc
  assert.ok(s.undo());
  assert.equal(s.state.capital.flows.length, 1);
  assert.equal(s.state.capital.flows[0].id, flowId);
});
