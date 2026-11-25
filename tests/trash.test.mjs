// 1.8.15 (agreed 25-11-2026): Trash days are his setting (1 to 90, starts at 15) and he can empty the Trash now.
// Also in 1.8.15: the Scans chart opens with bars.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/actions.js';
import * as SC from '../js/scans.js';
import { emptyState, migrate, dataProblems, defaultSettings, APP_VERSION } from '../js/model.js';

const day = 86400000;
function setup() {
  const st = emptyState();
  assert.ok(A.setStartCapital(st, { amount: '6000', date: '2026-01-01' }).ok);
  const a = A.openTrade(st, { symbol: 'WPP', buyDate: '2026-11-02', qty: '11', buyPrice: '27,148', initialStop: '26' }).data;
  const b = A.openTrade(st, { symbol: 'WMT', buyDate: '2026-10-23', qty: '4', buyPrice: '120,42', initialStop: '116' }).data;
  A.editDaily(st, a.id, 'currentStop', '26,5');
  return { st, a, b };
}

test('a new journal and an older file both start with 15 Trash days', () => {
  assert.equal(defaultSettings().trashKeepDays, 15);
  const old = emptyState(); delete old.settings.trashKeepDays;
  const m = migrate(old); assert.equal(m.settings.trashKeepDays, 15); assert.equal(A.trashDays(m), 15);
});

test('Trash days follow his setting; a missing or wrong value means 15', () => {
  const st = emptyState();
  st.settings.trashKeepDays = 3; assert.equal(A.trashDays(st), 3); assert.equal(A.trashText(st), '3 days');
  st.settings.trashKeepDays = 1; assert.equal(A.trashText(st), '1 day');
  for (const bad of [0, 91, -2, 2.5, 'x', null, undefined]) { st.settings.trashKeepDays = bad; assert.equal(A.trashDays(st), 15, String(bad)); }
});

test('the startup clean-up uses his days', () => {
  const { st, a } = setup(); st.settings.trashKeepDays = 3;
  assert.ok(A.deleteTrade(st, a.id).ok); const at = Date.parse(st.trash[0].deletedAt);
  assert.equal(A.purgeTrash(st, at + 2 * day).ok, false); assert.equal(st.trash.length, 1);
  assert.ok(A.purgeTrash(st, at + 3 * day).ok); assert.equal(st.trash.length, 0);
  assert.equal(st.changeLog.some((e) => e.tradeId === a.id), false);
});

test('Empty the Trash: everything goes now, a deleted trade also leaves the logs, other trades keep theirs', () => {
  const { st, a, b } = setup();
  assert.ok(A.deleteTrade(st, a.id).ok);
  assert.ok(A.addScanRun(st, { scanner: 'W1-1M', date: '2026-11-25', cols: ['Ticker'], rows: [{ s: 'NVDA', v: ['NVDA'] }] }).ok);
  assert.ok(A.deleteScanner(st, 'W1-1M').ok);
  assert.equal(st.trash.length, 2);
  const r = A.emptyTrash(st); assert.ok(r.ok); assert.equal(r.data.removed, 2);
  assert.equal(st.trash.length, 0);
  assert.equal(st.changeLog.some((e) => e.tradeId === a.id), false); assert.equal(st.stopHistory.some((e) => e.tradeId === a.id), false);
  assert.equal(st.changeLog.some((e) => e.tradeId === b.id), true);
  assert.equal(st.trades.some((t) => t.id === b.id), true);
  assert.deepEqual(dataProblems(st), []);
});

test('Empty the Trash on an empty Trash changes nothing', () => {
  const st = emptyState(); const r = A.emptyTrash(st); assert.equal(r.ok, false);
});

test('a file with a Trash days value that is not a number is refused', () => {
  const st = emptyState(); st.settings.trashKeepDays = 'abc';
  assert.ok(dataProblems(st).some((p) => p.includes('trashKeepDays')));
});

test('the Scans chart opens with bars (style 0), no colour settings', () => {
  const u = SC.chartUrl('NASDAQ:MSFT', 'https://salwanalmshal-tech.github.io/tj-app/');
  const cfg = JSON.parse(decodeURIComponent(u.split('#')[1]));
  assert.equal(cfg.style, '0'); assert.equal(cfg.overrides, undefined); assert.equal(cfg.studies_overrides, undefined);
  assert.notEqual(APP_VERSION, '1.8.14');
});

test('after Empty the Trash, Undo cannot bring the deleted item back', async () => {
  const { Store } = await import('../js/store.js');
  const s = new Store(emptyState());
  s.run((d) => A.addScanRun(d, { scanner: 'knowledge', date: '2026-11-25', cols: ['Ticker'], rows: [{ s: 'NVDA', v: ['NVDA'] }] }));
  s.run((d) => A.deleteScanner(d, 'knowledge'), { label: 'delete scanner' }); assert.ok(s.canUndo());
  assert.ok(s.run((d) => A.emptyTrash(d), { noUndo: true }).ok); s.clearUndo();
  assert.equal(s.canUndo(), false); assert.equal(s.undo(), false);
  assert.equal(s.state.trash.length, 0); assert.equal(s.state.scans.runs.length, 0);
});
