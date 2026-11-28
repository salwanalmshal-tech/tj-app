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
  const st = fresh(); assert.equal(st.rejects.length, 7); // 1.8.17: + No character (the old four archived)
  A.setScanMark(st, 'AAA', { status: 'rej', reasons: ['rj-ext', 'rj-vol'], date: '2026-11-22' });
  assert.equal(A.listUsage(st, 'rejects', 'rj-ext'), 1);
  const r = A.renameListItem(st, 'rejects', 'rj-ext', 'Weak volume', { merge: true });
  assert.equal(r.ok, true, r.error); assert.deepEqual(st.scans.marks.AAA.reasons, ['rj-vol']); assert.equal(st.rejects.length, 6);
});
test('file check: old files get scans; broken scan data is reported', () => {
  const old = emptyState(); delete old.scans; delete old.rejects; const m = migrate(old);
  assert.deepEqual(m.scans.runs, []); assert.equal(m.rejects.length, 7); assert.equal(m.settings.scanKeepDays, 90);
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
  assert.deepEqual(o.rows.map((r) => `${r.t}:${r.n}`), ['AAA:3', 'BBB:2', 'NEW:2', 'OLD:1']); // 1.8.17: Near buy no longer moves a stock (only Rejected goes last)
  assert.deepEqual(o.rows.find((r) => r.t === 'NEW').hits, [false, true, true]); assert.equal(o.inAll, 1);
  assert.equal(SC.runLabel(st, st.scans.runs[1], '2026-11-22'), 'today (2nd)'); assert.equal(SC.runLabel(st, st.scans.runs[2], '2026-11-22'), '21-11-2026');
});
test('filter (1.8.17, Finviz style): search, RS from–to, earnings days, number and text columns, status', () => {
  const rows = [
    { t: 'AAA', rs: 90, mark: null, earnings: { days: 3 }, vals: { 'Mkt cap': '8.72 B USD', Sector: 'Tech', 'ADR %': '4.1%' } },
    { t: 'BBB', rs: 50, mark: { st: 'near' }, earnings: null, vals: { 'Mkt cap': '900 M USD', Sector: 'Health', 'ADR %': '6%' } },
    { t: 'CCC', rs: null, mark: { st: 'watch' }, earnings: null, vals: { 'Mkt cap': '', Sector: 'Tech', 'ADR %': '3%' } },
    { t: 'DDD', rs: 70, mark: null, earnings: null, vals: {} }];
  const cols = ['Mkt cap', 'Sector', 'ADR %'];
  let r = SC.applyFilter(rows, SC.emptyFilter(), { cols }); assert.equal(r.rows.length, 4); assert.equal(r.total, 4);
  r = SC.applyFilter(rows, { ...SC.emptyFilter(), rsMin: 60 }, { cols }); assert.deepEqual(r.rows.map((x) => x.t), ['AAA', 'DDD']);
  r = SC.applyFilter(rows, { ...SC.emptyFilter(), rsMin: 60, rsMax: 80 }, { cols }); assert.deepEqual(r.rows.map((x) => x.t), ['DDD']);
  r = SC.applyFilter(rows, { ...SC.emptyFilter(), earnDays: 7 }, { cols }); assert.deepEqual(r.rows.map((x) => x.t), ['BBB', 'CCC', 'DDD']);
  r = SC.applyFilter(rows, { ...SC.emptyFilter(), cols: { 'Mkt cap': { min: '1B' } } }, { cols }); assert.deepEqual(r.rows.map((x) => x.t), ['AAA']); assert.equal(r.noData, 2, 'CCC (empty) and DDD (never scanned)');
  r = SC.applyFilter(rows, { ...SC.emptyFilter(), cols: { Sector: { is: 'tech' }, 'ADR %': { min: '4' } } }, { cols }); assert.deepEqual(r.rows.map((x) => x.t), ['AAA']);
  r = SC.applyFilter(rows, { ...SC.emptyFilter(), cols: { 'ADR %': { min: '', max: '' } } }, { cols }); assert.equal(r.rows.length, 4, 'empty boxes are not a filter');
  r = SC.applyFilter(rows, { ...SC.emptyFilter(), cols: { 'Float %': { min: '10' } } }, { cols }); assert.equal(r.rows.length, 4, 'a column the stocks shown do not have is ignored');
  r = SC.applyFilter(rows, { ...SC.emptyFilter(), q: 'b' }, { cols }); assert.deepEqual(r.rows.map((x) => x.t), ['BBB']);
  r = SC.applyFilter(rows, SC.emptyFilter(), { cols, statuses: new Set(['near', 'none']) }); assert.deepEqual(r.rows.map((x) => x.t), ['AAA', 'BBB', 'DDD']);
  assert.equal(SC.filterCount({ ...SC.emptyFilter(), rsMin: 80, earnDays: 7, cols: { a: { min: '1' }, b: { is: '' }, c: { is: 'Tech' } } }), 4);
  const k = SC.colKinds(rows, cols); assert.equal(k['ADR %'].kind, 'num'); assert.equal(k.Sector.kind, 'text'); assert.deepEqual(k.Sector.options, ['Health', 'Tech']);
  assert.deepEqual(SC.filterableCols(['No.', 'Ticker', 'Company', 'Sector', 'Price']), ['Sector', 'Price']);
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

// ---------- 1.8.9 Finviz ----------
test('Finviz: page 1 starts a scan, page 2 joins it, RS reads Perf Quart / Half / Year, earnings "Nov 20/a"', () => {
  const st = fresh(); const cols = ['No.', 'Ticker', 'Perf Week', 'Perf Quart', 'Perf Half', 'Perf Year', 'Earnings'];
  const p1 = SC.parsePaste(SC.PAYLOAD_TAG + JSON.stringify({ source: 'finviz', scanner: 'FV breakout', key: 'f=ta_sma50_pa&v=141', page: 1, date: '2026-11-23', cols, rows: [{ s: 'AAPL', v: ['1', 'AAPL', '1%', '30%', '40%', '50%', 'Nov 26/a'] }, { s: 'MSFT', v: ['2', 'MSFT', '1%', '10%', '10%', '10%', ''] }], shown: 23 }));
  assert.equal(p1.ok, true); assert.equal(p1.source, 'finviz'); assert.deepEqual(p1.fv, { key: 'f=ta_sma50_pa&v=141', page: 1 });
  const r1 = A.addScanRun(st, { scanner: p1.scanner, date: p1.date, cols: p1.cols, rows: p1.rows, shown: p1.shown, fv: p1.fv }).data.run;
  assert.deepEqual(r1.fvPages, [1]); assert.equal(A.finvizRunFor(st, 'FV breakout', '2026-11-23', 'f=ta_sma50_pa&v=141').id, r1.id);
  const j = A.joinFinvizPage(st, r1.id, { cols, rows: [{ s: 'NVDA', v: ['21', 'NVDA', '1%', '5%', '5%', '5%', ''] }, { s: 'AAPL', v: [] }], page: 2, shown: 23 });
  assert.equal(j.data.added, 1); assert.deepEqual(r1.fvPages, [1, 2]); assert.equal(r1.rows.length, 3);
  assert.equal(A.joinFinvizPage(st, r1.id, { cols, rows: [], page: 2 }).ok, false);
  const v = SC.sourceView(st, { kind: 'scanner', name: 'FV breakout' }, '2026-11-23');
  assert.equal(v.rows.find((r) => r.t === 'AAPL').rs, 99); assert.deepEqual(v.rows.find((r) => r.t === 'AAPL').earnings, { days: 3, iso: '2026-11-26' });
  assert.equal(SC.earningsDays('Feb 03/b', '2026-11-23').iso, '2027-02-03');
});
test('Finviz tickers take the exchange from a TradingView scan when there is one', () => {
  const st = fresh(); A.addScanRun(st, { scanner: 'TV', date: '2026-11-22', rows: [r2('NASDAQ:AAPL')] }); A.addScanRun(st, { scanner: 'FV', date: '2026-11-23', rows: [{ s: 'AAPL', v: [] }, { s: 'ZZZ', v: [] }] });
  assert.equal(SC.fullOf(st, 'AAPL'), 'NASDAQ:AAPL'); assert.equal(SC.fullOf(st, 'ZZZ'), 'ZZZ');
  assert.equal(SC.sourceView(st, { kind: 'scanner', name: 'FV' }, '2026-11-23').rows.find((r) => r.t === 'AAPL').full, 'NASDAQ:AAPL');
});
test('the Finviz bookmark has no % or # and is valid JavaScript', () => {
  assert.equal(SC.COLLECT_FV_SRC.includes('%'), false); assert.equal(SC.COLLECT_FV_SRC.includes('#'), false);
  assert.doesNotThrow(() => new Function(SC.collectFvHref().slice('javascript:'.length)));
});

// ---------- 1.8.10 Finviz Elite through his helper ----------
test('Finviz CSV: quotes, commas inside quotes, header → scan rows', () => {
  const csv = '﻿"No.","Ticker","Company","Perf Quart","Market Cap"\r\n"1","AAPL","Apple, Inc.","12.5%","3500000"\r\n"2","BRK-B","Berkshire ""B""","4%",""\r\n';
  assert.deepEqual(SC.parseCsv(csv)[2], ['2', 'BRK-B', 'Berkshire "B"', '4%', '']);
  const r = SC.finvizCsvToScan(csv); assert.equal(r.ok, true); assert.deepEqual(r.cols, ['No.', 'Ticker', 'Company', 'Perf Quart', 'Market Cap']);
  assert.deepEqual(r.rows.map((x) => x.s), ['AAPL', 'BRK-B']); assert.equal(r.rows[0].v[2], 'Apple, Inc.');
  assert.equal(SC.finvizCsvToScan('<!DOCTYPE html><html>login</html>').ok, false); assert.equal(SC.finvizCsvToScan('').ok, false);
});
test('Finviz screener address: only filters are kept, the key is always dropped, type=stocks added, non-table views warned', () => {
  const q = SC.finvizQuery('https://elite.finviz.com/screener?v=141&f=exch_nyse,cap_midover&o=-perf4w&r=21&auth=SECRET');
  assert.equal(q.ok, true); assert.equal(q.q.includes('auth'), false); assert.equal(q.q.includes('r=21'), false); assert.match(q.q, /type=stocks/); assert.equal(q.perf, true); assert.equal(q.warn, null);
  assert.ok(SC.finvizQuery('https://elite.finviz.com/screener.ashx?v=211&f=x').warn); assert.equal(SC.finvizQuery('https://example.com/x').ok, false); assert.equal(SC.finvizQuery('hello').ok, false);
  const st = fresh(); const a = A.addFvScreen(st, 'Breakout', 'https://elite.finviz.com/screener?v=141&f=x&auth=K'); assert.equal(a.ok, true);
  assert.equal(JSON.stringify(st).includes('auth'), false); assert.equal(A.addFvScreen(st, 'breakout', 'https://elite.finviz.com/screener?v=141').ok, false);
  A.markFvFetched(st, a.data.screen.id, '2026-11-23'); assert.equal(st.scans.fvScreens[0].last, '2026-11-23');
  assert.match(SC.HELPER_CODE, /PASTE_YOUR_FINVIZ_KEY_HERE/); assert.match(SC.HELPER_CODE, /p\.secret !== TJ_SECRET/);
});

// ---------- 1.8.17 his test fixes (A4, A5) ----------
test('A4 his own order inside a scanner: saved, new stocks first, dropped leave, renamed with the scanner, back to RS', () => {
  const st = fresh();
  A.addScanRun(st, { scanner: 'W1', date: '2026-11-26', cols: COLS, rows: [row('AAA', '30%', '', ''), row('BBB', '20%', '', ''), row('CCC', '10%', '', '')] }, { today: '2026-11-26' });
  A.addScanRun(st, { scanner: 'W1', date: '2026-11-27', cols: COLS, rows: [row('AAA', '30%', '', ''), row('CCC', '10%', '', ''), row('DDD', '50%', '', '')] }, { today: '2026-11-27' });
  const v0 = SC.sourceView(st, { kind: 'scanner', name: 'W1' }, '2026-11-27'); assert.deepEqual(v0.rows.map((r) => r.t), ['DDD', 'AAA', 'CCC']); assert.equal(v0.own, false);
  assert.equal(A.setScannerOwnOrder(st, 'W1', ['CCC', 'AAA', 'BBB']).ok, true);
  const v = SC.sourceView(st, { kind: 'scanner', name: 'W1' }, '2026-11-27');
  assert.deepEqual(v.rows.map((r) => r.t), ['DDD', 'CCC', 'AAA']); assert.equal(v.own, true); // DDD is new: on top; BBB dropped: gone
  assert.equal(A.setScannerOwnOrder(st, 'Nope', ['AAA']).ok, false); assert.equal(A.setScannerOwnOrder(st, 'W1', ['<x>']).ok, false);
  A.renameScanner(st, 'W1', 'W1-1M'); assert.deepEqual(st.scans.own['W1-1M'], ['CCC', 'AAA', 'BBB']); assert.equal(st.scans.own.W1, undefined);
  A.setScannerOwnOrder(st, 'W1-1M', null); assert.equal(st.scans.own['W1-1M'], undefined);
  assert.deepEqual(dataProblems(st), []);
  st.scans.own = { W1: 'x' }; assert.ok(dataProblems(st).some((p) => /own order/.test(p)));
});
test('A4 his own order: a rejected stock stays last (and hidden on screen)', () => {
  const st = fresh();
  A.addScanRun(st, { scanner: 'W1', date: '2026-11-27', cols: COLS, rows: [row('AAA', '30%', '', ''), row('BBB', '20%', '', ''), row('CCC', '10%', '', '')] }, { today: '2026-11-27' });
  A.setScanMark(st, 'AAA', { status: 'rej', date: '2026-11-27' }); A.setScannerOwnOrder(st, 'W1', ['AAA', 'CCC', 'BBB']);
  assert.deepEqual(SC.sourceView(st, { kind: 'scanner', name: 'W1' }, '2026-11-27').rows.map((r) => r.t), ['CCC', 'BBB', 'AAA']);
});
test('A5 filter: date columns from–to (Finviz writes month/day/year), kinds and groups of his Finviz columns', () => {
  assert.equal(SC.dateIso('11/7/2026 4:30:00 PM'), '2026-11-07'); assert.equal(SC.dateIso('2026-12-01'), '2026-12-01'); assert.equal(SC.dateIso(''), null); assert.equal(SC.dateIso('soon'), null);
  const rows = [{ t: 'A', rs: 50, vals: { 'Earnings Date': '12/2/2026 4:00:00 PM' } }, { t: 'B', rs: 60, vals: { 'Earnings Date': '1/20/2027 8:00:00 AM' } }, { t: 'C', rs: 70, vals: { 'Earnings Date': '' } }];
  const f = { ...SC.emptyFilter(), cols: { 'Earnings Date': { from: '2026-12-01', to: '2026-12-31' } } };
  const r = SC.applyFilter(rows, f, { cols: ['Earnings Date'] }); assert.deepEqual(r.rows.map((x) => x.t), ['A']); assert.equal(r.noData, 1);
  assert.equal(SC.filterCount(f), 1); assert.equal(SC.colActive({ from: '', to: '' }), false);
  assert.deepEqual(SC.filterColInfo('Earnings Date'), { kind: 'date', group: 'Descriptive' });
  assert.deepEqual(SC.filterColInfo('Industry'), { kind: 'list', group: 'Descriptive' });
  assert.deepEqual(SC.filterColInfo('Performance (Quarter)'), { kind: 'num', group: 'Technical' });
  assert.deepEqual(SC.filterColInfo('P/E'), { kind: 'num', group: 'Fundamental' });
  assert.deepEqual(SC.filterableCols(['No.', 'Ticker', 'Company', 'News Title', '52-Week Range', 'Price']), ['Price']);
  const st = fresh(); A.addScanRun(st, { scanner: 'W1', date: '2026-11-27', cols: ['No.', 'Ticker', 'Price'], rows: [{ s: 'AAA', v: ['1', 'AAA', '10'] }] }, { today: '2026-11-27' });
  A.addScanRun(st, { scanner: 'W2', date: '2026-11-27', cols: ['Ticker', 'Sector'], rows: [{ s: 'BBB', v: ['BBB', 'Tech'] }] }, { today: '2026-11-27' });
  assert.deepEqual(SC.allScanCols(st).sort(), ['Price', 'Sector']); // every scan he has, not only the one open
});

// ---------- 1.8.17 review 28-11-2026: tests for the new data logic ----------
test('his own statuses: add above Rejected, rename, colour, move, delete → Trash brings the status and its stocks back', () => {
  const st = fresh();
  const a = A.addStatus(st, 'Pilot', 'amber'); assert.equal(a.ok, true);
  assert.deepEqual(SC.statusesOf(st).map((x) => x.name), ['Watching', 'Near buy', 'Pilot', 'Rejected']);
  assert.equal(A.addStatus(st, 'pilot').ok, false); assert.equal(A.renameStatus(st, a.data.id, 'Watching').ok, false);
  assert.equal(A.renameStatus(st, a.data.id, 'Test buy').ok, true); assert.equal(A.setStatusColor(st, a.data.id, 'pink').ok, false);
  assert.equal(A.setStatusColor(st, a.data.id, 'grey').ok, true); A.moveStatus(st, a.data.id, 0); assert.equal(SC.statusesOf(st)[0].name, 'Test buy');
  A.setScanMark(st, 'AAA', { status: a.data.id, date: '2026-11-28' }); A.setScanMark(st, 'BBB', { status: 'watch', date: '2026-11-28' });
  assert.equal(A.deleteStatus(st, 'rej').ok, false);
  const d = A.deleteStatus(st, a.data.id); assert.equal(d.ok, true); assert.equal(d.data.n, 1);
  assert.equal(st.scans.marks.AAA, undefined); assert.equal(st.scans.marks.BBB.st, 'watch'); assert.deepEqual(dataProblems(st), []);
  const i = st.trash.findIndex((e) => e.kind === 'scanStatus'); assert.equal(A.restoreFromTrash(st, i).ok, true);
  assert.equal(st.scans.marks.AAA.st, a.data.id); assert.equal(SC.statusesOf(st)[0].name, 'Test buy'); assert.deepEqual(dataProblems(st), []);
  // a name clash refuses the restore and keeps it in the Trash
  A.deleteStatus(st, a.data.id); A.addStatus(st, 'Test buy');
  const j = st.trash.findIndex((e) => e.kind === 'scanStatus'); assert.equal(A.restoreFromTrash(st, j).ok, false); assert.ok(st.trash[j]);
});
test('My lists: move a section to another list, a stock between sections (also when it is already there), lists in order', () => {
  const st = fresh();
  const L1 = A.addScanFolder(st, 'Swing').data, L2 = A.addScanFolder(st, 'Long').data;
  const s1 = A.addScanList(st, 'Raw', L1.id).data, s2 = A.addScanList(st, 'Close', L1.id).data, s3 = A.addScanList(st, 'Raw', L2.id).data;
  assert.equal(A.placeSection(st, s1.id, L2.id).ok, false); // "Raw" already in Long
  assert.equal(A.placeSection(st, s2.id, L2.id, s3.id).ok, true); assert.equal(st.scans.lists.find((x) => x.id === s2.id).folder, L2.id);
  assert.deepEqual(st.scans.lists.filter((x) => x.folder === L2.id).map((x) => x.name), ['Close', 'Raw']);
  assert.equal(A.placeSection(st, s1.id, 'sf999').ok, false);
  A.addToScanList(st, s1.id, [{ t: 'AAA' }, { t: 'BBB' }], { date: '2026-11-27' }); A.addToScanList(st, s3.id, [{ t: 'BBB' }], { date: '2026-11-27' });
  assert.equal(A.placeScanItem(st, s1.id, s1.id, 'BBB', 'AAA').ok, true); assert.deepEqual(st.scans.lists.find((x) => x.id === s1.id).items.map((y) => y.t), ['BBB', 'AAA']);
  const m = A.placeScanItem(st, s1.id, s3.id, 'BBB', null, { date: '2026-11-28' }); assert.equal(m.data.merged, true);
  assert.deepEqual(st.scans.lists.find((x) => x.id === s1.id).items.map((y) => y.t), ['AAA']); assert.deepEqual(st.scans.lists.find((x) => x.id === s3.id).items.map((y) => y.t), ['BBB']);
  assert.equal(A.placeScanItem(st, s1.id, s2.id, 'AAA', null, { date: '2026-11-28' }).ok, true); assert.equal(st.scans.lists.find((x) => x.id === s2.id).items[0].added, '2026-11-28');
  assert.equal(A.placeScanItem(st, s1.id, s2.id, 'ZZZ').ok, false);
  A.placeScanFolder(st, L2.id, L1.id); assert.deepEqual(st.scans.folders.map((f) => f.name), ['Long', 'Swing']);
  A.placeScanFolder(st, L2.id, null); assert.deepEqual(st.scans.folders.map((f) => f.name), ['Swing', 'Long']);
  assert.deepEqual(dataProblems(st), []);
});
test('1.8.17 opening a 1.8.16 file: loose sections go into "My list", the old reject chips are archived — once only', () => {
  const st = fresh(); delete st.meta.scans1817; st.meta.version = '1.8.16';
  st.scans.lists = [{ id: 'sl1', name: 'Ideas', folder: null, items: [{ t: 'AAA' }] }]; st.scans.folders = [];
  st.rejects = defaultRejectsOld();
  const m = migrate(JSON.parse(JSON.stringify(st)));
  assert.equal(m.scans.folders.length, 1); assert.equal(m.scans.folders[0].name, 'My list'); assert.equal(m.scans.lists[0].folder, m.scans.folders[0].id);
  assert.deepEqual(m.rejects.filter((r) => !r.archived).map((r) => r.name), ['No character', 'Weak volume', 'Low RS']);
  assert.equal(m.meta.scans1817, true); assert.deepEqual(dataProblems(m), []);
  // he later deletes "My list" contents and un-archives a chip: opening again changes nothing
  m.rejects.find((r) => r.id === 'rj-ext').archived = false; m.scans.lists.push({ id: 'sl2', name: 'Loose', folder: null, items: [] });
  const m2 = migrate(JSON.parse(JSON.stringify(m)));
  assert.equal(m2.rejects.find((r) => r.id === 'rj-ext').archived, false); assert.equal(m2.scans.lists.find((x) => x.id === 'sl2').folder, null);
});
function defaultRejectsOld() { return [['rj-ext', 'Extended'], ['rj-vol', 'Weak volume'], ['rj-earn', 'Earnings soon'], ['rj-sma50', 'Below SMA 50'], ['rj-base', 'Bad base'], ['rj-rs', 'Low RS']].map(([id, name]) => ({ id, name, archived: false })); }
test('bad values: statuses, scanner order, own order', () => {
  const st = fresh(); assert.deepEqual(dataProblems(st), []);
  A.setScanMark(st, 'AAA', { status: 'watch', date: '2026-11-28' });
  st.scans.statuses = []; assert.deepEqual(dataProblems(st), [], 'an empty list means the three built-in ones');
  st.scans.statuses = 'x'; assert.ok(dataProblems(st).some((p) => /statuses are not readable/.test(p)));
  st.scans.statuses = [{ id: 'watch', name: 'A' }, { id: 'watch', name: 'B' }]; assert.ok(dataProblems(st).some((p) => /same ID/.test(p)));
  st.scans.statuses = [{ id: 'near', name: 'Near buy' }]; assert.ok(dataProblems(st).some((p) => /Scan status of AAA/.test(p)));
  st.scans.statuses = undefined; st.scans.order = ['S:W1', 5]; assert.ok(dataProblems(st).some((p) => /scanner order/.test(p)));
  st.scans.order = 'x'; assert.ok(dataProblems(st).some((p) => /scanner order/.test(p)));
  st.scans.order = []; st.scans.own = { W1: ['AAA', 3] }; assert.ok(dataProblems(st).some((p) => /own order/.test(p)));
  st.scans.own = []; assert.ok(dataProblems(st).some((p) => /own order/.test(p)));
});
test('review fixes: deleting a scanner forgets its order; odd scanner names; filter boxes read "1,5"; dates only in Finviz forms', () => {
  const st = fresh();
  A.addScanRun(st, { scanner: 'W1', date: '2026-11-27', cols: COLS, rows: [row('AAA', '30%', '', ''), row('BBB', '20%', '', '')] }, { today: '2026-11-27' });
  A.setScannerOwnOrder(st, 'W1', ['BBB', 'AAA']); A.deleteScanner(st, 'W1'); assert.equal(st.scans.own.W1, undefined);
  A.addScanRun(st, { scanner: 'constructor', date: '2026-11-27', cols: COLS, rows: [row('AAA', '30%', '', '')] }, { today: '2026-11-27' });
  assert.equal(SC.sourceView(st, { kind: 'scanner', name: 'constructor' }, '2026-11-27').own, false);
  A.renameScanner(st, 'constructor', 'W9'); assert.equal(st.scans.own.W9, undefined);
  assert.equal(SC.boxNum('1,5'), 1.5); assert.equal(SC.boxNum(' 2.25 '), 2.25); assert.equal(SC.boxNum('−3'), -3); assert.equal(SC.boxNum('x'), null); assert.equal(SC.boxNum(''), null);
  const rows = [{ t: 'A', rs: 50, vals: { ADR: '1.2%' } }, { t: 'B', rs: 60, vals: { ADR: '1.8%' } }];
  assert.deepEqual(SC.applyFilter(rows, { ...SC.emptyFilter(), cols: { ADR: { min: '1,5' } } }, { cols: ['ADR'] }).rows.map((r) => r.t), ['B']);
  assert.deepEqual(SC.applyFilter(rows, { ...SC.emptyFilter(), rsMin: 'x' }, { cols: [] }).rows.length, 2);
  assert.equal(SC.dateIso('Dec 2'), null); assert.equal(SC.dateIso('5'), null);
});
