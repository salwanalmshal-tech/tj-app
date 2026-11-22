import test from 'node:test'; import assert from 'node:assert/strict';
import * as SC from '../js/scans.js'; import * as A from '../js/actions.js'; import { emptyState, migrate, dataProblems } from '../js/model.js';

const payload = (o) => SC.PAYLOAD_TAG + JSON.stringify(o);
const COLS = ['Symbol', 'Price', 'Perf % 3M', 'Perf % 6M', 'Perf % 1Y', 'Upcoming earnings date', 'Sector'];
const row = (s, p3, p6, p1, earn = '', sector = 'Tech') => ({ s, v: ['', '10', p3, p6, p1, earn, sector] });
const fresh = () => migrate(emptyState());

test('paste: TJ Collect text is read; bad symbols left out; duplicates once', () => {
  const p = SC.parsePaste(payload({ scanner: 'Breakout', date: '2026-11-22', cols: COLS, rows: [row('NASDAQ:NVDA', '10%', '', ''), row('NASDAQ:NVDA', '1', '', ''), { s: '<img>', v: [] }], shown: 5 }));
  assert.equal(p.ok, true); assert.equal(p.kind, 'collect'); assert.equal(p.rows.length, 1); assert.equal(p.shown, 5); assert.equal(p.scanner, 'Breakout');
});
test('paste: plain tickers with commas, spaces and new lines', () => {
  const p = SC.parsePaste('nvda, AAPL\nNYSE:WMT  ???');
  assert.equal(p.ok, true); assert.equal(p.kind, 'plain'); assert.deepEqual(p.rows.map((r) => r.s), ['NVDA', 'AAPL', 'NYSE:WMT']); assert.deepEqual(p.skipped, ['???']);
  assert.equal(SC.parsePaste('   ').ok, false); assert.equal(SC.parsePaste(SC.PAYLOAD_TAG + '{bad').ok, false);
});
test('numbers in screener text', () => {
  assert.equal(SC.pctNum('−18.86%'), -18.86); assert.equal(SC.pctNum('+5.52 %'), 5.52); assert.equal(SC.pctNum('1,234.5'), 1234.5); assert.equal(SC.pctNum('—'), null); assert.equal(SC.pctNum(''), null);
});
test('RS rank 1–99: strongest = 99, weakest = 1; 3 months weigh double', () => {
  const r = SC.rsRanks(new Map([['A', SC.rsScore(50, 10, 10)], ['B', SC.rsScore(10, 30, 30)], ['C', SC.rsScore(-5, 0, 0)], ['D', SC.rsScore(null, 5, 5)]]));
  assert.equal(r.get('A'), 99); assert.equal(r.get('C'), 1); assert.ok(r.get('B') > 1 && r.get('B') < 99); assert.equal(r.has('D'), false);
});
test('compare: only stocks in ALL ticked runs; order New, then decided, then Rejected; RS among all candidates', () => {
  const st = fresh();
  A.addScanRun(st, { scanner: 'S1', date: '2026-11-22', cols: COLS, rows: [row('NASDAQ:AAA', '40', '', ''), row('NYSE:BBB', '20', '', ''), row('NYSE:CCC', '5', '', ''), row('NYSE:ONLY1', '90', '', '')] });
  A.addScanRun(st, { scanner: 'S2', date: '2026-11-22', cols: COLS, rows: [row('NASDAQ:AAA', '40', '', ''), row('NYSE:BBB', '20', '', ''), row('NYSE:CCC', '5', '', '')] });
  A.addScanRun(st, { scanner: 'S3', date: '2026-11-21', cols: [], rows: [{ s: 'AAA', v: [] }, { s: 'BBB', v: [] }, { s: 'CCC', v: [] }, { s: 'DDD', v: [] }] });
  A.setScanMark(st, 'CCC', { status: 'near', date: '2026-11-22' }); A.setScanMark(st, 'AAA', { status: 'rej', reasons: ['rj-ext', 'nope'], other: ' late ', date: '2026-11-22' });
  const pick = SC.defaultPick(st); assert.equal(pick.length, 3);
  const c = SC.compare(st, pick, '2026-11-22');
  assert.deepEqual(c.rows.map((r) => r.t), ['BBB', 'CCC', 'AAA']);
  assert.equal(c.universe, 5); assert.equal(c.rows.find((r) => r.t === 'AAA').full, 'NASDAQ:AAA');
  assert.deepEqual(st.scans.marks.AAA.reasons, ['rj-ext']); assert.equal(st.scans.marks.AAA.other, 'late');
  assert.equal(c.rows.find((r) => r.t === 'AAA').rs, 66); // 3rd of the 4 with numbers (ONLY1 90 is the strongest): 1 + 98 x 2/3
  assert.equal(SC.seenCount(st, 'AAA', '2026-11-22'), 2); // 2 days (21st and 22nd), not 3 runs
});
test('same scanner twice on a day: replace removes the first one, keep both keeps it', () => {
  const st = fresh(); const one = { scanner: 'S1', date: '2026-11-22', rows: [{ s: 'AAA', v: [] }] };
  A.addScanRun(st, one); assert.equal(A.scanRunExists(st, 'S1', '2026-11-22'), true);
  A.addScanRun(st, one); assert.equal(st.scans.runs.length, 2);
  A.addScanRun(st, one, { replace: true }); assert.equal(st.scans.runs.length, 1);
  assert.equal(A.addScanRun(st, { scanner: ' ', date: '2026-11-22', rows: [{ s: 'AAA' }] }).ok, false);
});
test('cleanup after N days keeps tickers only; scans linked to a trade are kept whole', () => {
  const st = fresh();
  A.addScanRun(st, { scanner: 'Old', date: '2026-07-01', cols: COLS, rows: [row('NYSE:AAA', '1', '', '')] });
  A.addScanRun(st, { scanner: 'Linked', date: '2026-07-01', cols: COLS, rows: [row('NYSE:BBB', '1', '', '')] });
  st.trades.push({ fromScans: [st.scans.runs[1].id] });
  const r = A.addScanRun(st, { scanner: 'New', date: '2026-11-22', cols: COLS, rows: [row('NYSE:CCC', '1', '', '')] });
  assert.equal(r.data.trimmed, 1); assert.equal(st.scans.runs[0].trimmed, true); assert.deepEqual(st.scans.runs[0].rows, [{ s: 'NYSE:AAA', v: [] }]);
  assert.equal(st.scans.runs[1].trimmed, false);
});
test('earnings days and the TradingView file', () => {
  assert.deepEqual(SC.earningsDays('2026-11-29', '2026-11-22'), { days: 7, iso: '2026-11-29' });
  assert.equal(SC.earningsDays('Dec 2, 2026', '2026-11-22').days, 10); assert.equal(SC.earningsDays('—', '2026-11-22'), null);
  assert.equal(SC.tradingViewText([{ t: 'AAA', full: 'NASDAQ:AAA' }, { t: 'BBB', full: 'BBB' }]), 'NASDAQ:AAA,BBB');
});
test('reject reasons: a list like the others; usage counts stocks; merge moves the stocks', () => {
  const st = fresh(); assert.equal(st.rejects.length, 6);
  A.setScanMark(st, 'AAA', { status: 'rej', reasons: ['rj-ext', 'rj-vol'], date: '2026-11-22' });
  assert.equal(A.listUsage(st, 'rejects', 'rj-ext'), 1);
  const r = A.renameListItem(st, 'rejects', 'rj-ext', 'Weak volume', { merge: true });
  assert.equal(r.ok, true, r.error); assert.deepEqual(st.scans.marks.AAA.reasons, ['rj-vol']); assert.equal(st.rejects.length, 5);
});
test('file check: old files get scans; broken scan data is reported', () => {
  const old = emptyState(); delete old.scans; delete old.rejects; const m = migrate(old);
  assert.deepEqual(m.scans.runs, []); assert.equal(m.rejects.length, 6); assert.equal(m.settings.scanKeepDays, 90);
  assert.deepEqual(dataProblems(m), []);
  const bad = migrate(emptyState()); bad.scans.runs.push({ id: 'x y', date: 'no', rows: [] }); bad.scans.marks.ZZ = { st: 'maybe' };
  assert.ok(dataProblems(bad).length >= 2);
});
test('the TJ Collect bookmark text has no % sign and is valid JavaScript', () => {
  assert.equal(SC.COLLECT_SRC.includes('%'), false); assert.equal(SC.COLLECT_SRC.includes('#'), false);
  assert.doesNotThrow(() => new Function(SC.collectHref().slice('javascript:'.length)));
});
