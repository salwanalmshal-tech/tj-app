// 1.8.0 — Scans tab: pure logic (no page code here, so it can be tested on its own).
// His choices (2026-11-22): every scan run is kept as its own dated list, grouped by scanner; the comparison opens with the
// newest run of every scanner ticked and shows only stocks found in ALL ticked runs; a status per stock (Watching / Near
// buy / Rejected + reason chips) is kept across scans; RS (scan) rank among the scanned stocks; marks Open / Traded before /
// Seen N× / Earnings in N days; "Download for TradingView" takes only the Near buy stocks; full runs kept 90 days (Settings).

export const PAYLOAD_TAG = 'TJSCAN1';
export const SEEN_DAYS = 14;
export const STATUS = { watch: 'Watching', near: 'Near buy', rej: 'Rejected' };

const SYM = /^([A-Z0-9_]{1,20}:)?[A-Z0-9][A-Z0-9.\-!/]{0,19}$/;
export const tickerOf = (s) => String(s).toUpperCase().split(':').pop();
export const exchangeOf = (s) => (String(s).includes(':') ? String(s).toUpperCase().split(':')[0] : '');
export const validSymbol = (s) => SYM.test(String(s).toUpperCase());

// ---------- reading what he pastes ----------
// Two kinds: the TJ Collect bookmark's text (tag + JSON), or plain tickers separated by commas, spaces or new lines.
export function parsePaste(text) {
  const t = String(text ?? '').trim();
  if (!t) return { ok: false, error: 'Nothing to paste. Click TJ Collect on your TradingView scanner first.' };
  if (t.startsWith(PAYLOAD_TAG)) {
    let p; try { p = JSON.parse(t.slice(PAYLOAD_TAG.length)); } catch { return { ok: false, error: 'The copied scan could not be read. Click TJ Collect again.' }; }
    const cols = Array.isArray(p.cols) ? p.cols.map((c) => String(c ?? '').trim()).slice(0, 60) : [];
    const rows = (Array.isArray(p.rows) ? p.rows : []).map((r) => ({ s: String(r?.s ?? '').toUpperCase(), v: Array.isArray(r?.v) ? r.v.slice(0, cols.length).map((x) => String(x ?? '').slice(0, 80)) : [] })).filter((r) => validSymbol(r.s));
    if (!rows.length) return { ok: false, error: 'The copied scan has no stocks.' };
    const shown = Number.isInteger(p.shown) && p.shown > 0 ? p.shown : null;
    return { ok: true, kind: 'collect', scanner: String(p.scanner ?? '').trim().slice(0, 60), date: /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : null, cols, rows: dedupe(rows), shown };
  }
  const words = t.split(/[\s,;]+/).map((w) => w.trim().toUpperCase()).filter(Boolean);
  const good = words.filter(validSymbol); const bad = words.filter((w) => !validSymbol(w));
  if (!good.length) return { ok: false, error: 'No tickers found in what you pasted.' };
  return { ok: true, kind: 'plain', scanner: '', date: null, cols: [], rows: dedupe(good.map((s) => ({ s, v: [] }))), shown: null, skipped: bad };
}
function dedupe(rows) { const seen = new Set(); return rows.filter((r) => { const k = tickerOf(r.s); if (seen.has(k)) return false; seen.add(k); return true; }); }

// ---------- numbers inside screener text ("−18.86%", "+5.52 %", "12.95%") ----------
export function pctNum(text) {
  if (text === null || text === undefined) return null;
  const s = String(text).replace(/[−–]/g, '-').replace(/[%+\s\u202f\u00a0]/g, '').replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null; const v = Number(s); return Number.isFinite(v) ? v : null;
}
const findCol = (cols, re) => cols.findIndex((c) => re.test(c));
const PERF = { m3: /perf\w*\W*%?\W*3\s*m|3\s*month/i, m6: /perf\w*\W*%?\W*6\s*m|6\s*month/i, y1: /perf\w*\W*%?\W*(1\s*y|12\s*m|1\s*year|year)/i };
export const EARN = /earning/i;

// value of one column for one stock in one run
export function cellOf(run, ticker, re) {
  const i = findCol(run.cols || [], re); if (i < 0) return null;
  const r = run.rows.find((x) => tickerOf(x.s) === ticker); return r ? r.v?.[i] ?? null : null;
}

// RS score: the usual weighting, recent months count double: 2 x 3M + 6M + 1Y (missing parts are left out, weights rescaled).
export function rsScore(p3, p6, p12) {
  if (p3 === null) return null; let s = 2 * p3, w = 2;
  if (p6 !== null) { s += p6; w += 1; } if (p12 !== null) { s += p12; w += 1; }
  return (s / w) * 4;
}
// rank 1–99 within the group (the stocks of the ticked runs); stronger than 95 % of the group = 95
export function rsRanks(scores) {
  const list = [...scores].filter(([, v]) => v !== null).sort((a, b) => a[1] - b[1]);
  const out = new Map(); const n = list.length;
  list.forEach(([k], i) => out.set(k, n === 1 ? 99 : Math.round(1 + (98 * i) / (n - 1))));
  return out;
}

// ---------- the comparison ----------
export function runsByScanner(st) {
  const g = new Map();
  for (const r of [...(st.scans?.runs || [])].sort((a, b) => (b.date + String(b.seq).padStart(9, '0')).localeCompare(a.date + String(a.seq).padStart(9, '0')))) {
    if (!g.has(r.scanner)) g.set(r.scanner, []); g.get(r.scanner).push(r);
  }
  return [...g].map(([scanner, runs]) => ({ scanner, runs })).sort((a, b) => b.runs[0].date.localeCompare(a.runs[0].date) || a.scanner.localeCompare(b.scanner));
}
// default ticks: the newest run of every scanner
export const defaultPick = (st) => runsByScanner(st).map((g) => g.runs[0].id);

// rows for a set of tickers, RS ranked among every stock in the given runs (shared by "common" and "what changed")
function buildRows(st, runs, tickers, today) {
  const sets = runs.map((r) => new Set(r.rows.map((x) => tickerOf(x.s))));
  const universe = new Set(sets.flatMap((x) => [...x]));
  const newestFirst = [...runs].sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq);
  const valueOf = (t, re) => { for (const r of newestFirst) { const v = cellOf(r, t, re); if (v !== null && v !== '') return v; } return null; };
  const scores = new Map([...universe].map((t) => [t, rsScore(pctNum(valueOf(t, PERF.m3)), pctNum(valueOf(t, PERF.m6)), pctNum(valueOf(t, PERF.y1)))]));
  const ranks = rsRanks(scores);
  const cols = [...new Set(newestFirst.flatMap((r) => r.cols || []))].filter((c) => !/^symbol$/i.test(c));
  const rows = tickers.map((t) => {
    const src = newestFirst.find((r) => r.rows.some((x) => tickerOf(x.s) === t));
    const full = src ? src.rows.find((x) => tickerOf(x.s) === t).s : fullOf(st, t);
    const vals = Object.fromEntries(cols.map((c) => { for (const r of newestFirst) { const i = (r.cols || []).indexOf(c); if (i < 0) continue; const x = r.rows.find((y) => tickerOf(y.s) === t); if (x && x.v?.[i]) return [c, x.v[i]]; } return [c, '']; }));
    return { t, full, rs: ranks.get(t) ?? null, vals, mark: st.scans?.marks?.[t] || null, earnings: earningsDays(valueOf(t, EARN), today), earningsText: valueOf(t, EARN), chg: null };
  });
  return { rows, cols, universe: universe.size };
}
const grp = (r) => (!r.mark ? 0 : r.mark.st === 'rej' ? 2 : 1);
const byRs = (a, b) => (b.rs ?? -1) - (a.rs ?? -1) || a.t.localeCompare(b.t);

// stocks found in ALL the given runs; his order: New, then Watching and Near buy, then Rejected; inside each by RS
export function compare(st, pickIds, today) {
  const runs = (st.scans?.runs || []).filter((r) => pickIds.includes(r.id));
  if (!runs.length) return { runs, rows: [], cols: [], universe: 0, mode: 'common' };
  const sets = runs.map((r) => new Set(r.rows.map((x) => tickerOf(x.s))));
  const common = [...sets[0]].filter((t) => sets.every((x) => x.has(t)));
  const b = buildRows(st, runs, common, today);
  b.rows.sort((a, c) => grp(a) - grp(c) || byRs(a, c));
  return { runs, ...b, mode: runs.length === 1 ? 'one' : 'common' };
}
// 1.8.1 "Found in" (his choice A, 21:40): ONE view for any ticked scans, from any scanners. Every stock of the ticked scans,
// with which scans have it (hits, one per scan) and how many (n). Order: found in the most scans first, then New before
// decided before Rejected, then RS. Scans are ordered by scanner, then date, then 1st/2nd of the day.
export function overlap(st, pickIds, today) {
  const runs = (st.scans?.runs || []).filter((r) => pickIds.includes(r.id)).sort((a, b) => a.scanner.localeCompare(b.scanner) || a.date.localeCompare(b.date) || a.seq - b.seq);
  if (!runs.length) return { runs, rows: [], cols: [], universe: 0, mode: 'overlap' };
  const sets = runs.map((r) => new Set(r.rows.map((x) => tickerOf(x.s))));
  const all = [...new Set(sets.flatMap((x) => [...x]))];
  const bt = buildRows(st, runs, all, today);
  for (const r of bt.rows) { r.hits = sets.map((x) => x.has(r.t)); r.n = r.hits.filter(Boolean).length; }
  bt.rows.sort((a, c) => c.n - a.n || grp(a) - grp(c) || byRs(a, c));
  return { runs, ...bt, mode: 'overlap', inAll: bt.rows.filter((r) => r.n === runs.length).length };
}
// "Breakout · today (2nd)": the label of one scan, with 1st/2nd when a scanner was collected more than once that day
export function runLabel(st, r, today) {
  const same = (st.scans?.runs || []).filter((x) => x.scanner === r.scanner && x.date === r.date).sort((a, b) => a.seq - b.seq);
  const nth = same.length > 1 ? ` (${['1st', '2nd', '3rd'][same.indexOf(r)] ?? same.indexOf(r) + 1 + 'th'})` : '';
  return (r.date === today ? 'today' : r.date.slice(8, 10) + '-' + r.date.slice(5, 7) + '-' + r.date.slice(0, 4)) + nth;
}

// ---------- 1.8.1 filter ----------
// number inside screener text: "71.76 USD" 71.76, "8.72 B USD" 8.72e9, "241.92 M" 2.4192e8, "−3.91%" -3.91; text gives null
export function numOf(text) {
  if (text === null || text === undefined) return null;
  const s = String(text).replace(/[−–]/g, '-').replace(/[\s\u202f\u00a0,+]/g, '');
  const m = s.match(/^(-?\d+(?:\.\d+)?)%?([KMBT])?/);
  if (!m) return null; const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[(m[2] || '').toUpperCase()] || 1;
  const v = Number(m[1]) * mult; return Number.isFinite(v) ? v : null;
}
export const emptyFilter = () => ({ status: 'all', q: '', rsMin: null, noEarn: false, traded: false, noOpen: false, rules: [] });
export const STATUS_KEYS = ['all', 'new', 'watch', 'near', 'rej'];
const statusOf = (r) => (r.mark ? r.mark.st : 'new');
// info: { isOpen(t), traded(t) }. Status counts are taken after the other filters, so the buttons match what you would see.
export function applyFilter(rows, f, info) {
  const q = (f.q || '').trim().toUpperCase();
  const pass = rows.filter((r) => {
    if (q && !r.t.includes(q)) return false;
    if (f.rsMin !== null && f.rsMin !== '' && !(r.rs !== null && r.rs >= Number(f.rsMin))) return false;
    if (f.noEarn && r.earnings && r.earnings.days >= 0 && r.earnings.days <= 7) return false;
    if (f.traded && !info.traded(r.t)) return false;
    if (f.noOpen && info.isOpen(r.t)) return false;
    for (const ru of f.rules || []) {
      const v = r.vals?.[ru.col];
      if (ru.op === 'has') { if (!String(v || '').toLowerCase().includes(String(ru.val).toLowerCase())) return false; continue; }
      const a = numOf(v), b = numOf(ru.val); if (a === null || b === null) return false;
      if (ru.op === '>=' && !(a >= b)) return false; if (ru.op === '<=' && !(a <= b)) return false;
    }
    return true;
  });
  const counts = Object.fromEntries(STATUS_KEYS.map((k) => [k, k === 'all' ? pass.length : pass.filter((r) => statusOf(r) === k).length]));
  const shown = f.status === 'all' ? pass : pass.filter((r) => statusOf(r) === f.status);
  return { rows: shown, counts, total: rows.length };
}
// how many filters are on (the Filter button shows it); status and search have their own place on the row
export const filterCount = (f) => (f.rsMin !== null && f.rsMin !== '' ? 1 : 0) + (f.noEarn ? 1 : 0) + (f.traded ? 1 : 0) + (f.noOpen ? 1 : 0) + (f.rules || []).length;

// ---------- 1.8.1 lists ----------
export function fullOf(st, t) {
  for (const r of [...(st.scans?.runs || [])].sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq)) { const x = r.rows.find((y) => tickerOf(y.s) === t); if (x) return x.s; }
  for (const l of st.scans?.lists || []) { const x = l.items.find((y) => y.t === t); if (x) return x.full; }
  return t;
}
export const listsOf = (st, t) => (st.scans?.lists || []).filter((l) => l.items.some((x) => x.t === t));
// ready-made lists from his statuses: Near buy (all), Near buy per scanner, Watching
export function readyLists(st) {
  const marks = Object.entries(st.scans?.marks || {}); const tickers = (s) => marks.filter(([, m]) => m.st === s).map(([t]) => t).sort();
  const item = (t) => ({ t, full: fullOf(st, t) });
  const near = tickers('near'); const out = [{ id: 'ready-near', name: 'Near buy (all)', ready: true, items: near.map(item) }];
  for (const g of runsByScanner(st)) {
    const inIt = new Set(g.runs.flatMap((r) => r.rows.map((x) => tickerOf(x.s)))); const n = near.filter((t) => inIt.has(t));
    if (n.length) out.push({ id: 'ready-near-' + g.scanner, name: 'Near buy · ' + g.scanner, ready: true, items: n.map(item) });
  }
  out.push({ id: 'ready-watch', name: 'Watching', ready: true, items: tickers('watch').map(item) });
  return out;
}
// TradingView file with sections: ###Name,EX:A,EX:B,###Name2,... (the ### line is a section, like TradingView's own export)
const sym = (x) => (x.full && x.full.includes(':') ? x.full : x.t);
export function tradingViewSections(sections) {
  return sections.filter((x) => x.items.length).flatMap((x) => ['###' + String(x.name).replace(/[,#]/g, ' ').trim(), ...x.items.map(sym)]).join(',');
}
export const tradingViewList = (items) => items.map(sym).join(',');
export const safeFileName = (s) => String(s).replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'list';

// ---------- marks ----------
export function earningsDays(text, today) {
  if (!text) return null; const s = String(text).trim();
  let iso = /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  if (!iso) { const t = Date.parse(s.replace(/(\d)(st|nd|rd|th)/, '$1')); if (Number.isNaN(t)) return null; const d = new Date(t); iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  const days = Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);
  return Number.isFinite(days) ? { days, iso } : null;
}
export function seenCount(st, ticker, today) {
  const from = addDays(today, -(SEEN_DAYS - 1));
  // counted in DAYS, so two scanners finding it on the same day is 1 day (it is "keeps coming back", not "many scanners")
  return new Set((st.scans?.runs || []).filter((r) => r.date >= from && r.date <= today && r.rows.some((x) => tickerOf(x.s) === ticker)).map((r) => r.date)).size;
}
export function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// ---------- the TradingView file: exchange-prefixed, comma separated, .txt (TradingView's own import format) ----------
export function tradingViewText(rows) { return rows.map((r) => (r.full.includes(':') ? r.full : r.t)).join(','); }

// ---------- cleanup: full runs for N days, after that only date, scanner and tickers (his statuses are kept apart) ----------
export function trimOld(st, today, keepDays) {
  const limit = addDays(today, -keepDays); const linked = new Set((st.trades || []).flatMap((t) => t.fromScans || []));
  let n = 0;
  for (const r of st.scans?.runs || []) {
    if (r.trimmed || r.date >= limit || linked.has(r.id)) continue;
    r.rows = r.rows.map((x) => ({ s: x.s, v: [] })); r.cols = []; r.trimmed = true; n++;
  }
  return n;
}

// ---------- the TJ Collect bookmark ----------
// Runs on his TradingView screener page when he clicks it. It reads ONLY the scanner table (the table whose rows carry
// data-rowkey — his test on 22-11-2026 showed the watchlist and market summary sit elsewhere), every visible column,
// the scanner name (asked once, best guess filled in) and today's date, then copies it for Trade Journal → Scans.
// No % sign anywhere in this text: browsers decode %xx inside bookmark addresses.
export const COLLECT_SRC = `(()=>{const tabs=[...document.querySelectorAll('table')].map(t=>[t,t.querySelectorAll('tr[data-rowkey]').length]).sort((a,b)=>b[1]-a[1]);
if(!tabs.length||!tabs[0][1]){alert('Trade Journal: no scanner table on this page. Open your scanner results on TradingView, then click TJ Collect again.');return;}
const tb=tabs[0][0];const hr=tb.querySelector('thead tr')||tb.querySelector('tr');const ths=hr?[...hr.querySelectorAll('th')]:[];
let shown=null;const cols=ths.map((th,i)=>{const ls=(th.innerText||'').split('\\n').map(s=>s.trim()).filter(Boolean);if(ls.length>1&&/^\\d+$/.test(ls[ls.length-1])){if(shown===null)shown=+ls[ls.length-1];ls.pop();}return ls.join(' ')||('Column '+(i+1));});
const rows=[...tb.querySelectorAll('tr[data-rowkey]')].map(tr=>{const tds=[...tr.querySelectorAll('td')].map(td=>(td.innerText||'').replace(/\\s+/g,' ').trim());const off=tds.length-cols.length;return{s:tr.getAttribute('data-rowkey'),v:cols.map((c,i)=>tds[i+(off>0?off:0)]??'')};}).filter(r=>/^[A-Za-z0-9_]+:[A-Za-z0-9.\\-!\\/]+$/.test(r.s||''));
let guess='';const top=tb.getBoundingClientRect().top;let best=1e9;document.querySelectorAll('h1,h2,h3,div,span,button').forEach(e=>{if(e.children.length)return;const t=(e.textContent||'').trim();if(t.length<2||t.length>60||/screener/i.test(t))return;const fs=parseFloat(getComputedStyle(e).fontSize)||0;const r=e.getBoundingClientRect();if(fs<19||r.bottom>top||!r.width)return;const d=top-r.bottom;if(d<best){best=d;guess=t;}});
const name=prompt('Trade Journal: name of this scanner',guess);if(name===null)return;
const d=new Date();const date=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const text='${PAYLOAD_TAG}'+JSON.stringify({scanner:name.trim()||guess||'Scanner',date,cols,rows,shown});
const box=document.createElement('div');box.style.cssText='position:fixed;top:16px;right:16px;z-index:2147483647;width:360px;background:white;color:rgb(21,35,59);border:1px solid rgb(201,211,223);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:16px;font:14px/1.45 Arial,sans-serif';
const say=(ok)=>{box.innerHTML='';const b=document.createElement('b');b.textContent=ok?('Copied '+rows.length+' stocks from '+(name.trim()||guess)):'Copy did not work. Select the text below and press Ctrl+C.';box.append(b);
if(shown&&rows.length<shown){const w=document.createElement('div');w.style.cssText='color:rgb(163,65,45);margin-top:6px';w.textContent='TradingView shows '+shown+' but only '+rows.length+' were loaded. Scroll to the bottom of the list and click TJ Collect again.';box.append(w);}
const p=document.createElement('div');p.style.cssText='margin-top:6px;color:rgb(91,107,128)';p.textContent=ok?'Now open Trade Journal, go to Scans and press Ctrl+V.':'';box.append(p);
if(!ok){const a=document.createElement('textarea');a.value=text;a.style.cssText='width:326px;height:90px;margin-top:6px';box.append(a);a.select();}
const c=document.createElement('button');c.textContent='Close';c.style.cssText='margin-top:10px;padding:6px 14px;border-radius:8px;border:1px solid rgb(201,211,223);background:rgb(243,246,250);cursor:pointer';c.onclick=()=>box.remove();box.append(c);};
document.getElementById('tj-collect')?.remove();box.id='tj-collect';document.body.append(box);
const fallback=()=>{const a=document.createElement('textarea');a.value=text;document.body.append(a);a.select();let ok=false;try{ok=document.execCommand('copy');}catch(e){}a.remove();say(ok);};
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(()=>say(true),fallback);}else fallback();})();`;
export const collectHref = () => 'javascript:' + COLLECT_SRC.replace(/\n/g, '');


// ---------- 1.8.2 one-screen Scans: "sources" ----------
// A source is anything that holds stocks: a scanner (one of its scans), a saved comparison (newest scan of each of its
// scanners on a chosen day), a ready-made list, or one of his lists. sourceView turns it into rows for the list + chart.
export const scannerRuns = (st, name) => (st.scans?.runs || []).filter((r) => r.scanner === name).sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq);
const tickSet = (run) => new Set(run.rows.map((x) => tickerOf(x.s)));
// the scan of each scanner that was newest on that day (or before it); null when a scanner has none yet
function pickOn(st, scanners, date) {
  return scanners.map((n) => scannerRuns(st, n).find((r) => r.date <= date) || null);
}
export function compareDates(st, scanners) {
  const first = Math.max(...scanners.map((n) => { const rs = scannerRuns(st, n); return rs.length ? Date.parse(rs[rs.length - 1].date) : Infinity; }));
  if (!Number.isFinite(first)) return [];
  return [...new Set(scanners.flatMap((n) => scannerRuns(st, n).map((r) => r.date)))].filter((d) => Date.parse(d) >= first).sort().reverse();
}
function rowsFromItems(st, items, today) {
  const tks = items.map((x) => tickerOf(x.t));
  const runs = []; const seen = new Set();
  for (const r of [...(st.scans?.runs || [])].sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq)) if (!seen.has(r.scanner) && r.rows.some((x) => tks.includes(tickerOf(x.s)))) { seen.add(r.scanner); runs.push(r); }
  const b = buildRows(st, runs, tks, today);
  for (const r of b.rows) { const it = items.find((x) => tickerOf(x.t) === r.t); if (it?.full?.includes(':')) r.full = it.full; r.added = it?.added || null; }
  return b;
}
export function sourceView(st, src, today) {
  const empty = { kind: src?.kind, title: '', rows: [], dropped: [], N: 1, runs: [], cols: [], picker: null, hasNewDrop: false };
  if (!src) return empty;
  if (src.kind === 'scanner') {
    const runs = scannerRuns(st, src.name); if (!runs.length) return empty;
    const run = runs.find((r) => r.id === src.run) || runs[0]; const prev = runs[runs.indexOf(run) + 1] || null;
    const cur = compare(st, [run.id], today); const ps = prev ? tickSet(prev) : null; const now = tickSet(run);
    for (const r of cur.rows) r.isNew = !!ps && !ps.has(r.t);
    const dropped = ps ? buildRows(st, [prev], [...ps].filter((t) => !now.has(t)), today).rows : [];
    return { kind: 'scanner', title: src.name, sub: runLabel(st, run, today), rows: cur.rows, dropped, N: 1, runs: [run], cols: cur.cols, run, prev,
      picker: { value: run.id, options: runs.map((r) => ({ value: r.id, label: runLabel(st, r, today) + ` · ${r.rows.length}` })) }, hasNewDrop: !!prev };
  }
  if (src.kind === 'compare') {
    const c = (st.scans?.compares || []).find((x) => x.id === src.id); if (!c) return empty;
    const names = c.scanners.filter((n) => scannerRuns(st, n).length); const dates = compareDates(st, names);
    if (names.length < 2 || !dates.length) return { ...empty, kind: 'compare', title: c.name, missing: c.scanners.filter((n) => !names.includes(n)) };
    const date = dates.includes(src.date) ? src.date : dates[0]; const runs = pickOn(st, names, date);
    const ov = overlap(st, runs.map((r) => r.id), today); const N = ov.runs.length;
    const inAll = new Set(ov.rows.filter((r) => r.n === N).map((r) => r.t));
    const prevDate = dates.find((d) => d < date) || null; let dropped = []; let prevAll = null;
    if (prevDate) {
      const pr = pickOn(st, names, prevDate); const po = overlap(st, pr.map((r) => r.id), today);
      prevAll = new Set(po.rows.filter((r) => r.n === po.runs.length).map((r) => r.t));
      const gone = [...prevAll].filter((t) => !inAll.has(t)); dropped = buildRows(st, po.runs, gone, today).rows;
    }
    for (const r of ov.rows) r.isNew = !!prevAll && r.n === N && !prevAll.has(r.t);
    return { kind: 'compare', title: c.name, sub: `${ov.inAll} in all ${N} · ${date === today ? 'today' : date.slice(8, 10) + '-' + date.slice(5, 7) + '-' + date.slice(0, 4)}`, rows: ov.rows, dropped, N, runs: ov.runs, cols: ov.cols, inAll: ov.inAll,
      picker: { value: date, options: dates.map((d) => ({ value: d, label: d === today ? 'today' : d.slice(8, 10) + '-' + d.slice(5, 7) + '-' + d.slice(0, 4) })) }, hasNewDrop: !!prevDate, missing: c.scanners.filter((n) => !names.includes(n)) };
  }
  if (src.kind === 'ready' || src.kind === 'list') {
    const l = src.kind === 'ready' ? readyLists(st).find((x) => x.id === src.id) : (st.scans?.lists || []).find((x) => x.id === src.id);
    if (!l) return empty; const b = rowsFromItems(st, l.items, today);
    b.rows.sort((a, c) => grp(a) - grp(c) || byRs(a, c));
    return { kind: src.kind, title: l.name, sub: `${l.items.length} stock${l.items.length === 1 ? '' : 's'}`, rows: b.rows, dropped: [], N: 1, runs: [], cols: b.cols, list: l, picker: null, hasNewDrop: false };
  }
  return empty;
}
// quick views above the list (his 6): All, In all scans (comparisons), New today, Dropped today, Not decided, Near buy
export const QUICK = [['all', 'All'], ['inall', 'In all scans'], ['new', 'New today'], ['dropped', 'Dropped today'], ['undecided', 'Not decided'], ['near', 'Near buy']];
export function quickRows(v, q) {
  switch (q) {
    case 'inall': return v.rows.filter((r) => r.n === v.N);
    case 'new': return v.rows.filter((r) => r.isNew);
    case 'dropped': return v.dropped.map((r) => ({ ...r, isDropped: true }));
    case 'undecided': return v.rows.filter((r) => !r.mark);
    case 'near': return v.rows.filter((r) => r.mark?.st === 'near');
    default: return v.rows;
  }
}
export const quickShown = (v, q) => (q === 'inall' ? v.kind === 'compare' : q === 'new' || q === 'dropped' ? v.hasNewDrop : true);
// the chart: TradingView's own chart page in a frame (1.8.2 fix: their loader script left the box white on his PC, so the
// frame is loaded directly). His choice: Daily, Volume (built in), EMA 10, SMA 20.
export const CHART_STUDIES = [{ id: 'MAExp@tv-basicstudies', inputs: { length: 10 } }, { id: 'MASimple@tv-basicstudies', inputs: { length: 20 } }];
export function chartUrl(symbol) {
  const q = new URLSearchParams({ frameElementId: 'tj-chart', symbol, interval: 'D', hidesidetoolbar: '0', symboledit: '0', saveimage: '0', toolbarbg: 'f1f3f6', studies: JSON.stringify(CHART_STUDIES), theme: 'light', style: '1', timezone: 'exchange', withdateranges: '1', locale: 'en' });
  return 'https://s.tradingview.com/widgetembed/?' + q.toString();
}
export const KEY_DEFAULT = [/^adr/i, /sector/i, /earning/i, /float\s*%|float %/i, /^price$/i, /^chg\s*%|change %/i];
