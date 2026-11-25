// 1.8.16 (agreed 25-11-2026): RS reads the long column names of the Finviz export (his export of 25-11-2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/actions.js';
import * as SC from '../js/scans.js';
import { emptyState, APP_VERSION } from '../js/model.js';

const P = SC.PERF_COLS;
const kind = (c) => [P.m3.test(c) && '3M', P.m6.test(c) && '6M', P.y1.test(c) && '1Y'].filter(Boolean).join('');

test('the Finviz export names are read as 3M, 6M and 1Y', () => {
  assert.equal(kind('Performance (Quarter)'), '3M');
  assert.equal(kind('Performance (Half Year)'), '6M');
  assert.equal(kind('Performance (Year)'), '1Y');
});
test('the old names still work (Finviz screen and TradingView)', () => {
  assert.equal(kind('Perf Quart'), '3M'); assert.equal(kind('Perf Half'), '6M'); assert.equal(kind('Perf Year'), '1Y');
  assert.equal(kind('Perf % 3M'), '3M'); assert.equal(kind('3 Month'), '3M');
});
test('other Finviz columns are never taken for 3M, 6M or 1Y', () => {
  for (const c of ['Performance (1 Minute)', 'Performance (3 Minutes)', 'Performance (30 Minutes)', 'Performance (1 Hour)', 'Performance (Week)', 'Performance (Month)', 'Performance (MTD)',
    'Performance (YTD)', 'Performance (3 Years)', 'Performance (5 Years)', 'Performance (10 Years)', 'Sales Growth Quarter Over Quarter', 'EPS Growth Quarter Over Quarter', 'Dividend Growth 1 Year'])
    assert.equal(kind(c), '', c);
});
test('a Finviz fetch with every performance column gets RS from Quarter, Half Year and Year (not from 3 Minutes)', () => {
  const st = emptyState();
  const cols = ['No.', 'Ticker', 'Performance (3 Minutes)', 'Performance (Week)', 'Performance (Quarter)', 'Performance (Half Year)', 'Performance (YTD)', 'Performance (3 Years)', 'Performance (Year)', 'Earnings Date'];
  const rows = [
    { s: 'AAA', v: ['1', 'AAA', '-9.00%', '1%', '30.00%', '40.00%', '5%', '500%', '60.00%', '12/3/2026 8:00:00 AM'] },
    { s: 'BBB', v: ['2', 'BBB', '9.00%', '1%', '10.00%', '10.00%', '50%', '1%', '10.00%', ''] },
    { s: 'CCC', v: ['3', 'CCC', '0.00%', '1%', '20.00%', '', '1%', '1%', '', ''] }];
  assert.ok(A.addScanRun(st, { scanner: 'W1-1M', date: '2026-11-25', cols, rows }).ok);
  const v = SC.sourceView(st, { kind: 'scanner', name: 'W1-1M' }, '2026-11-25');
  const rs = Object.fromEntries(v.rows.map((r) => [r.t, r.rs]));
  // scores: AAA (60+40+60)/4 = 40, CCC 3M only = 20, BBB (20+10+10)/4 = 10 → ranks 99, 50, 1
  assert.deepEqual(rs, { AAA: 99, CCC: 50, BBB: 1 });
  assert.deepEqual(v.rows.find((r) => r.t === 'AAA').earnings, { days: 8, iso: '2026-12-03' });
  assert.notEqual(APP_VERSION, '1.8.15');
});
