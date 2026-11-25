// 1.8.13 (24-11-2026, first version after the restart): damaged values the file check used to miss.
// A file with any of these is reported when it opens (and refused by Restore) instead of stopping the program or a screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import * as A from '../js/actions.js';
import * as SC from '../js/scans.js';

const bad = (mutate) => { const s = M.emptyState(); mutate(s); return M.checkFile(s); };

test('a new journal and the default settings have no problems', () => {
  assert.deepEqual(M.dataProblems(M.emptyState()), []);
  assert.equal(M.checkFile(M.emptyState()).ok, true);
});

test('Trash, change log, stop history, splits and reports must be lists', () => {
  for (const k of ['trash', 'changeLog', 'stopHistory', 'splits', 'reports']) {
    const c = bad((s) => { s[k] = null; }); assert.equal(c.ok, false, k); assert.ok(c.problems.length, k);
  }
  const c = bad((s) => { s.trash = [null]; }); assert.equal(c.ok, false);
});

test('settings: every value must fit the shape the screens read (numbers as text where the default is text)', () => {
  assert.equal(bad((s) => { s.settings.riskWarn = 'abc'; }).ok, false);
  assert.equal(bad((s) => { s.settings.posTooBig = null; }).ok, false);
  assert.equal(bad((s) => { s.settings.stopBelowBuy = { raiseAbove: 'x', closeWithin: '1' }; }).ok, false);
  assert.equal(bad((s) => { s.settings.rCategories = [['3']]; }).ok, false);
  assert.equal(bad((s) => { s.settings.verdictWin = ['1', 'x']; }).ok, false);
  assert.equal(bad((s) => { s.settings.verdictWin = ['1', '2']; }).ok, true, 'a list of another length is not refused (older files)');
  assert.equal(bad((s) => { s.settings.riskWarn = 0.2; }).ok, false, 'the screens read riskWarn as text');
  assert.equal(bad((s) => { s.settings.saveDelaySec = 3; s.settings.calcRiskPct = ''; s.settings.rCategoryElse = ''; }).ok, true);
  assert.equal(bad((s) => { delete s.settings.riskWarn; s.settings.somethingNew = 'x'; }).ok, true, 'missing or unknown settings are fine');
  assert.equal(bad((s) => { s.settings = null; }).ok, false);
});

test('counters must be whole numbers', () => {
  assert.equal(bad((s) => { s.counters.id = 'x'; }).ok, false);
  assert.equal(bad((s) => { s.counters = null; }).ok, false);
});

test('a scan row without a ticker is reported, and adding one is refused without a crash', () => {
  const c = bad((s) => { s.scans.runs.push({ id: 'sr1', scanner: 'X', date: '2026-11-24', seq: 1, cols: [], rows: [{ s: 'NVDA', v: [] }, { v: [] }] }); });
  assert.equal(c.ok, false);
  assert.equal(SC.validSymbol(undefined), false); assert.equal(SC.validSymbol(null), false); assert.equal(SC.validSymbol(123), false); assert.equal(SC.validSymbol('NASDAQ:NVDA'), true);
  const st = M.emptyState(); const r = A.addScanRun(st, { scanner: 'X', date: '2026-11-24', rows: [{ v: [] }] }, { today: '2026-11-24' });
  assert.equal(r.ok, false); assert.equal(st.scans.runs.length, 0);
});

test('a version after the restart (1.8.13 or later) opens an older file with the before-update backup', () => {
  const [a, b, c] = M.APP_VERSION.split('.').map(Number); assert.ok(a > 1 || b > 8 || (b === 8 && c >= 13), M.APP_VERSION);
  const old = M.emptyState(); old.meta.version = '1.8.12';
  assert.equal(M.needsUpdateBackup(old), true); assert.equal(M.needsUpdateBackup(M.migrate(old)), false);
});
