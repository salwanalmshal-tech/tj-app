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
test('Not decided takes the status back', () => {
  const st = fresh(); A.setScanMark(st, 'NASDAQ:AAA', { status: 'near', date: '2026-11-22' });
  assert.equal(A.clearScanMark(st, 'AAA').ok, true); assert.equal(st.scans.marks.AAA, undefined); assert.equal(A.clearScanMark(st, 'AAA').ok, false);
});

// ---------- 1.8.1 ----------
const r2 = (s) => ({ s, v: [] });
test('Found in: any ticked scans, most scans first, hits per scan', () => {
  const st = fresh();
  A.addScanRun(st, { scanner: 'S', date: '2026-11-22', rows: [r2('NYSE:AAA'), r2('NYSE:BBB'), r2('NYSE:OLD')] });
  A.addScanRun(st, { scanner: 'S', date: '2026-11-22', rows: [r2('NYSE:AAA'), r2('NYSE:BBB'), r2('NASDAQ:NEW')] });
  A.addScanRun(st, { scanner: 'T', date: '2026-11-21', rows: [r2('NYSE:AAA'), r2('NASDAQ:NEW')] });
  const ids = st.scans.runs.map((r) => r.id); A.setScanMark(st, 'BBB', { status: 'near', date: '2026-11-22' });
  const o = SC.overlap(st, ids, '2026-11-22');
  assert.deepEqual(o.runs.map((r) => r.scanner + r.seq), ['S' + st.scans.runs[0].seq, 'S' + st.scans.runs[1].seq, 'T' + st.scans.runs[2].seq]);
  assert.deepEqual(o.rows.map((r) => `${r.t}:${r.n}`), ['AAA:3', 'NEW:2', 'BBB:2', 'OLD:1']); // NEW (not decided) before BBB (near buy) in "2 of 3"
  assert.deepEqual(o.rows.find((r) => r.t === 'NEW').hits, [false, true, true]); assert.equal(o.inAll, 1);
  assert.equal(SC.runLabel(st, st.scans.runs[1], '2026-11-22'), 'today (2nd)'); assert.equal(SC.runLabel(st, st.scans.runs[2], '2026-11-22'), '21-11-2026');
});
test('filter: status counts, search, RS, earnings, rules with K/M/B numbers and text', () => {
  const rows = [
    { t: 'AAA', rs: 90, mark: null, earnings: { days: 3 }, vals: { 'Mkt cap': '8.72 B USD', Sector: 'Tech', 'ADR %': '4.1%' } },
    { t: 'BBB', rs: 50, mark: { st: 'near' }, earnings: null, vals: { 'Mkt cap': '900 M USD', Sector: 'Health', 'ADR %': '6%' } },
    { t: 'CCC', rs: null, mark: { st: 'rej' }, earnings: null, vals: { 'Mkt cap': '', Sector: 'Tech', 'ADR %': '3%' } }];
  const info = { isOpen: (t) => t === 'BBB', traded: (t) => t === 'CCC' };
  let r = SC.applyFilter(rows, SC.emptyFilter(), info); assert.deepEqual(r.counts, { all: 3, new: 1, watch: 0, near: 1, rej: 1 }); assert.equal(r.rows.length, 3);
  r = SC.applyFilter(rows, { ...SC.emptyFilter(), status: 'near' }, info); assert.deepEqual(r.rows.map((x) => x.t), ['BBB']); assert.equal(r.total, 3);
  r = SC.applyFilter(rows, { ...SC.emptyFilter(), rsMin: 60 }, info); assert.deepEqual(r.rows.map((x) => x.t), ['AAA']);
  r = SC.applyFilter(rows, { ...SC.emptyFilter(), noEarn: true, noOpen: true }, info); assert.deepEqual(r.rows.map((x) => x.t), ['CCC']);
  r = SC.applyFilter(rows, { ...SC.emptyFilter(), rules: [{ col: 'Mkt cap', op: '>=', val: '1B' }] }, info); assert.deepEqual(r.rows.map((x) => x.t), ['AAA']);
  r = SC.applyFilter(rows, { ...SC.emptyFilter(), rules: [{ col: 'Sector', op: 'has', val: 'tech' }, { col: 'ADR %', op: '>=', val: '4' }] }, info); assert.deepEqual(r.rows.map((x) => x.t), ['AAA']);
  r = SC.applyFilter(rows, { ...SC.emptyFilter(), q: 'b', traded: false }, info); assert.deepEqual(r.rows.map((x) => x.t), ['BBB']);
  assert.equal(SC.filterCount({ ...SC.emptyFilter(), rsMin: 80, noEarn: true, rules: [{}] }), 3);
});
test('lists: folders, add with the "also in" choice, remove from all, move, clean up, TradingView files', () => {
  const st = fresh();
  const f = A.addScanFolder(st, 'Swing Dec').data; assert.equal(A.addScanFolder(st, 'swing dec').ok, false);
  const a = A.addScanList(st, 'Tier A', f.id).data, b = A.addScanList(st, 'Earnings play', f.id).data, c = A.addScanList(st, 'Loose').data;
  A.addToScanList(st, a.id, [{ t: 'NVDA', full: 'NASDAQ:NVDA' }, { t: 'WMT', full: 'NYSE:WMT' }], { date: '2026-11-22' });
  A.addToScanList(st, b.id, [{ t: 'NVDA', full: 'NASDAQ:NVDA' }], { date: '2026-11-22' });
  assert.deepEqual(SC.listsOf(st, 'NVDA').map((l) => l.name), ['Tier A', 'Earnings play']);
  A.addToScanList(st, c.id, [{ t: 'NVDA', full: 'NASDAQ:NVDA' }], { removeFrom: [a.id], date: '2026-11-22' });
  assert.deepEqual(SC.listsOf(st, 'NVDA').map((l) => l.name), ['Earnings play', 'Loose']);
  A.removeFromScanList(st, b.id, ['NVDA'], { all: true }); assert.equal(SC.listsOf(st, 'NVDA').length, 0);
  A.moveScanItems(st, a.id, b.id, ['WMT']); assert.equal(a.items.length, 0); assert.equal(b.items[0].full, 'NYSE:WMT');
  A.setScanMark(st, 'WMT', { status: 'rej', date: '2026-11-22' }); assert.deepEqual(A.staleInList(st, b), ['WMT']);
  assert.equal(A.cleanUpScanLists(st, [b.id]).data.n, 1); assert.equal(b.items.length, 0);
  assert.equal(SC.tradingViewSections([{ name: 'Tier, A', items: [{ t: 'X', full: 'NYSE:X' }] }, { name: 'Empty', items: [] }, { name: 'B', items: [{ t: 'Y', full: 'Y' }] }]), '###Tier  A,NYSE:X,###B,Y');
});
test('delete scanner / folder go to the Trash and come back', () => {
  const st = fresh();
  A.addScanRun(st, { scanner: 'S', date: '2026-11-22', rows: [r2('NYSE:AAA')] }); A.addScanRun(st, { scanner: 'S', date: '2026-11-21', rows: [r2('NYSE:BBB')] });
  assert.equal(A.renameScanner(st, 'S', 'Swing').ok, true); assert.ok(st.scans.runs.every((r) => r.scanner === 'Swing'));
  assert.equal(A.deleteScanner(st, 'Swing').data.n, 2); assert.equal(st.scans.runs.length, 0);
  assert.equal(A.restoreFromTrash(st, st.trash.length - 1).ok, true); assert.equal(st.scans.runs.length, 2);
  const f = A.addScanFolder(st, 'F').data; A.addScanList(st, 'L1', f.id);
  A.deleteScanFolder(st, f.id); assert.equal(st.scans.lists.length, 0);
  assert.equal(A.restoreFromTrash(st, st.trash.length - 1).ok, true); assert.equal(st.scans.lists[0].folder, f.id);
});
test('a 1.8.0 file gets lists, folders and fold', () => {
  const old = emptyState(); old.scans = { runs: [], marks: { AAA: { st: 'near', date: '2026-11-22', reasons: [], other: '' } }, showCols: null };
  const m = migrate(old); assert.deepEqual(m.scans.lists, []); assert.deepEqual(m.scans.folders, []); assert.deepEqual(m.scans.fold, {}); assert.equal(m.scans.marks.AAA.st, 'near');
  assert.deepEqual(dataProblems(m), []);
});

// ---------- 1.8.2 sources ----------
test('sources: scanner with New today / Dropped today; comparison on newest scans with day picker', () => {
  const st = fresh();
  A.addScanRun(st, { scanner: 'S', date: '2026-11-20', rows: [r2('NYSE:AAA'), r2('NYSE:BBB'), r2('NYSE:OLD')] });
  A.addScanRun(st, { scanner: 'S', date: '2026-11-22', rows: [r2('NYSE:AAA'), r2('NYSE:BBB'), r2('NASDAQ:NEW')] });
  A.addScanRun(st, { scanner: 'T', date: '2026-11-20', rows: [r2('NYSE:AAA'), r2('NYSE:OLD')] });
  A.addScanRun(st, { scanner: 'T', date: '2026-11-22', rows: [r2('NYSE:AAA'), r2('NASDAQ:NEW')] });
  let v = SC.sourceView(st, { kind: 'scanner', name: 'S' }, '2026-11-22');
  assert.deepEqual(SC.quickRows(v, 'new').map((r) => r.t), ['NEW']); assert.deepEqual(SC.quickRows(v, 'dropped').map((r) => r.t), ['OLD']);
  assert.equal(v.picker.options.length, 2); assert.equal(SC.quickShown(v, 'inall'), false);
  const c = A.addScanCompare(st, '', ['S', 'T']).data; assert.equal(c.name, 'S + T'); assert.equal(A.addScanCompare(st, 'x', ['S']).ok, false);
  v = SC.sourceView(st, { kind: 'compare', id: c.id }, '2026-11-22');
  assert.equal(v.N, 2); assert.deepEqual(SC.quickRows(v, 'inall').map((r) => r.t).sort(), ['AAA', 'NEW']);
  assert.deepEqual(SC.quickRows(v, 'new').map((r) => r.t), ['NEW']); assert.deepEqual(SC.quickRows(v, 'dropped').map((r) => r.t), ['OLD']);
  v = SC.sourceView(st, { kind: 'compare', id: c.id, date: '2026-11-20' }, '2026-11-22');
  assert.deepEqual(SC.quickRows(v, 'inall').map((r) => r.t).sort(), ['AAA', 'OLD']); assert.equal(v.hasNewDrop, false);
  A.renameScanner(st, 'T', 'Tee'); assert.deepEqual(st.scans.compares[0].scanners, ['S', 'Tee']);
  A.deleteScanCompare(st, c.id); assert.equal(st.scans.compares.length, 0); assert.equal(A.restoreFromTrash(st, st.trash.length - 1).ok, true);
});
test('sources: lists show their stocks with scanner values; stocks never scanned still show', () => {
  const st = fresh(); A.addScanRun(st, { scanner: 'S', date: '2026-11-22', cols: COLS, rows: [row('NYSE:AAA', '40%', '', '')] });
  const l = A.addScanList(st, 'Tier A').data; A.addToScanList(st, l.id, [{ t: 'AAA', full: 'NYSE:AAA' }, { t: 'ZZZ', full: 'NASDAQ:ZZZ' }], { date: '2026-11-22' });
  const v = SC.sourceView(st, { kind: 'list', id: l.id }, '2026-11-22');
  assert.deepEqual(v.rows.map((r) => r.t).sort(), ['AAA', 'ZZZ']); assert.equal(v.rows.find((r) => r.t === 'AAA').vals['Perf % 3M'], '40%'); assert.equal(v.rows.find((r) => r.t === 'ZZZ').full, 'NASDAQ:ZZZ');
  const u = new URL(SC.chartUrl('NYSE:AAA', 'https://x.github.io/tj-app/')); const cfg = JSON.parse(decodeURIComponent(u.hash.slice(1)));
  assert.equal(u.host, 'www.tradingview-widget.com'); assert.equal(cfg.symbol, 'NYSE:AAA'); assert.equal(cfg.interval, 'D'); assert.equal(cfg.studies.length, 2); assert.equal(cfg['page-uri'], 'x.github.io/tj-app/'); assert.equal(cfg.studies_overrides, undefined);
});
test('the page safety rule lets only TradingView\'s chart frame in (besides Google sign-in)', async () => {
  const fs = await import('node:fs'); const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const fr = html.match(/frame-src ([^;]*)/)[1].trim().split(/\s+/);
  assert.deepEqual(fr, ['https://accounts.google.com', 'https://www.tradingview-widget.com']);
  assert.equal(new URL(SC.chartUrl('NYSE:AAA', 'https://x/')).origin, 'https://www.tradingview-widget.com');
});
test('quick comparison (ticked scanners, not saved) works like a saved one', () => {
  const st = fresh();
  A.addScanRun(st, { scanner: 'S', date: '2026-11-22', rows: [r2('NYSE:AAA'), r2('NYSE:BBB')] }); A.addScanRun(st, { scanner: 'T', date: '2026-11-22', rows: [r2('NYSE:AAA')] });
  const v = SC.sourceView(st, { kind: 'quick', scanners: ['S', 'T'] }, '2026-11-22');
  assert.equal(v.kind, 'compare'); assert.equal(v.quick, true); assert.deepEqual(SC.quickRows(v, 'inall').map((r) => r.t), ['AAA']); assert.equal(v.title, 'S + T');
});
