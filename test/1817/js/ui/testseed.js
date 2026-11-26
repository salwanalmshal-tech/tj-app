// TEMPORARY TEST COPY of 1.8.17 (Demo only, nothing is saved). Sample scans, lists and statuses so the new Scans screen can be tried.
import * as A from '../actions.js';
const C = ['No.', 'Ticker', 'Sector', 'Industry', 'Performance (Quarter)', 'Performance (Half Year)', 'Performance (Year)', 'Price', 'Average True Range', 'Relative Volume', 'Earnings Date'];
const S = [['Technology', 'Semiconductors'], ['Healthcare', 'Biotechnology'], ['Consumer Cyclical', 'Leisure'], ['Industrials', 'Airlines'], ['Technology', 'Software'], ['Healthcare', 'Medical Devices'], ['Energy', 'Oil & Gas'], ['Financial', 'Banks']];
const rnd = (a, b, i) => (a + ((i * 37) % 100) / 100 * (b - a)).toFixed(2);
const row = (t, i) => { const [s, ind] = S[i % S.length]; return { s: t, v: [String(i + 1), t, s, ind, rnd(-5, 60, i) + '%', rnd(-10, 90, i + 3) + '%', rnd(-20, 150, i + 7) + '%', rnd(8, 300, i + 1), rnd(0.4, 9, i + 2), rnd(0.6, 3, i + 4), i % 5 === 0 ? '12/2/2026 4:00:00 PM' : ''] }; };
const W1 = ['ADMA', 'ALGT', 'APP', 'ATEN', 'AXGN', 'AZTA', 'BOBS', 'BRBR', 'CGON', 'ENOV', 'ENR', 'ETON', 'FUN', 'GDYN', 'NVDA', 'CRDO'];
const W2 = ['NVDA', 'CRDO', 'IDXX', 'CROX', 'DXC', 'APP', 'ANET', 'PLTR'];
const W3 = ['ADMA', 'NVDA', 'ETON', 'FUN', 'GME', 'AMPH'];
export function seed(ctx, today) {
  ctx.act((d) => {
    A.addScanRun(d, { scanner: 'W1-1M', date: today, cols: C, rows: W1.map(row) }, { today });
    A.addScanRun(d, { scanner: 'W2-Trend Minervini', date: today, cols: C, rows: W2.map(row) }, { today });
    A.addScanRun(d, { scanner: 'W3-Recovery', date: today, cols: C, rows: W3.map(row) }, { today });
    A.addScanCompare(d, 'W1 + W2 + W3', ['W1-1M', 'W2-Trend Minervini', 'W3-Recovery']);
    A.setScanMark(d, 'CRDO', { status: 'near', date: today }); A.setScanMark(d, 'APP', { status: 'watch', date: today });
    A.setScanMark(d, 'GME', { status: 'rej', reasons: ['rj-vol'], date: today }); A.setScanMark(d, 'ENR', { status: 'rej', reasons: ['rj-char'], date: today });
    const f = A.addScanFolder(d, 'Swing ideas').data; const f2 = A.addScanFolder(d, 'Long term').data;
    const a = A.addScanList(d, 'RAW MATERIAL', f.id).data; const b = A.addScanList(d, 'CLOSE WATCHING', f.id).data; const c = A.addScanList(d, 'CURIOUS', f.id).data; const q = A.addScanList(d, 'QUALITY', f2.id).data;
    A.addToScanList(d, a.id, [{ t: 'FCX' }, { t: 'NEM' }], { date: today }); A.addToScanList(d, b.id, [{ t: 'NVDA' }, { t: 'CRDO' }, { t: 'ADMA' }], { date: today });
    A.addToScanList(d, c.id, [{ t: 'GME' }, { t: 'APP' }], { date: today }); A.addToScanList(d, q.id, [{ t: 'MSFT' }, { t: 'WMT' }], { date: today });
    return { ok: true };
  }, { label: 'sample data', noUndo: true });
}
