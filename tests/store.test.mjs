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
