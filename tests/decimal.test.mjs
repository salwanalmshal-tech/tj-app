import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../js/decimal.js';
test('parse', () => {
  assert.equal(D.toStr(D.d('1 234,56')), '1234.56');
  assert.equal(D.toStr(D.d('245.9905')), '245.9905');
  assert.equal(D.toStr(D.d('−0,5')), '-0.5');
  assert.equal(D.parse('abc'), null); assert.equal(D.parse(''), null);
  assert.equal(D.toStr(D.d('1,000.50')), '1000.5');
});
test('arithmetic exact', () => {
  assert.equal(D.toStr(D.add(D.d('0.1'), D.d('0.2'))), '0.3');
  assert.equal(D.toStr(D.mul(D.d('58.4'), D.d('100'))), '5840');
  assert.equal(D.fmt(D.div(D.d('837.5'), D.d('300')), 2), '2,79');
  assert.equal(D.fmt(D.d('1234567.891'), 2), '1 234 567,89');
  assert.equal(D.fmt(D.d('-47.8'), 2, { sign: true }), '−47,80');
  assert.equal(D.fmt(D.d('105'), 2, { sign: true }), '+105,00');
  assert.equal(D.fmt(D.d('0'), 2, { sign: true }), '0,00');
});
test('split puts remainder on last part', () => {
  const parts = D.split(D.d('1.00'), [D.d('1'), D.d('1'), D.d('1')]);
  assert.equal(parts.reduce((a, b) => a + b, 0n), D.d('1.00'));
  const p2 = D.split(D.d('2'), [D.d('3'), D.d('7')]);
  assert.equal(p2[0] + p2[1], D.d('2'));
});
test('pct', () => { assert.equal(D.fmt(D.pct(D.d('-47.8'), D.d('24000')), 2), '−0,20'); assert.equal(D.pct(1n, 0n), null); });
