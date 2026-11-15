// Performance verdicts (plan step 2): one word per average, from limits in Settings. Start values = his Excel Calculator:
// average winner R: <0,5 very weak, <1 weak, <1,5 acceptable, <2,5 good, <4 very good, else excellent;
// average loser R (size): <0,5 excellent, <0,75 good, <=1 acceptable, <=1,25 weak, <=1,5 bad, else very bad;
// winner ÷ loser: <1 very bad, <1,5 weak, <2 acceptable, <3 good, <5 very good, else excellent.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/calc.js';
import { emptyState, migrate, defaultSettings } from '../js/model.js';

const S = defaultSettings();
const word = (k, x) => C.verdictOf(k, x, C.verdictLimits(S, k))?.name;

test('Verdicts: average winner follows the Excel limits (a value equal to a limit belongs to the next word)', () => {
  assert.deepEqual([0.49, 0.5, 0.99, 1, 1.49, 1.5, 2.49, 2.5, 3.99, 4, 9].map((x) => word('win', x)),
    ['Very weak', 'Weak', 'Weak', 'Acceptable', 'Acceptable', 'Good', 'Good', 'Very good', 'Very good', 'Excellent', 'Excellent']);
});

test('Verdicts: average loser size — below 0,5 and 0,75, but "up to" 1, 1,25 and 1,5 (as in the Excel)', () => {
  assert.deepEqual([0.49, 0.5, 0.74, 0.75, 1, 1.01, 1.25, 1.26, 1.5, 1.51].map((x) => word('loss', x)),
    ['Excellent', 'Good', 'Good', 'Acceptable', 'Acceptable', 'Weak', 'Weak', 'Bad', 'Bad', 'Very bad']);
});

test('Verdicts: winner ÷ loser', () => {
  assert.deepEqual([0.9, 1, 1.49, 1.5, 2, 2.99, 3, 5].map((x) => word('ratio', x)),
    ['Very bad', 'Weak', 'Weak', 'Acceptable', 'Good', 'Good', 'Very good', 'Excellent']);
});

test('Verdicts: no value gives no word; the knob stays on the 0–100 scale inside its zone', () => {
  assert.equal(C.verdictOf('win', null, C.verdictLimits(S, 'win')), null);
  assert.equal(C.verdictOf('win', NaN, C.verdictLimits(S, 'win')), null);
  const r = C.verdictOf('win', 1.9, C.verdictLimits(S, 'win')); assert.equal(r.at, 3); assert.ok(r.pos > 50 && r.pos < 66.7, String(r.pos));
  assert.equal(C.verdictOf('win', 0, C.verdictLimits(S, 'win')).pos, 0);
  assert.ok(C.verdictOf('win', 99, C.verdictLimits(S, 'win')).pos <= 100);
});

test('Verdicts: changed limits change the word; an old data file gets the Excel start values', () => {
  const S2 = { ...S, verdictWin: ['0.5', '1', '1.5', '1.8', '4'] };
  assert.equal(C.verdictOf('win', 1.9, C.verdictLimits(S2, 'win')).name, 'Very good');
  const old = emptyState(); delete old.settings.verdictWin; delete old.settings.verdictLoss; delete old.settings.verdictRatio;
  const m = migrate(old); assert.deepEqual(m.settings.verdictWin, ['0.5', '1', '1.5', '2.5', '4']);
  assert.deepEqual(m.settings.verdictLoss, ['0.5', '0.75', '1', '1.25', '1.5']); assert.deepEqual(m.settings.verdictRatio, ['1', '1.5', '2', '3', '5']);
});
