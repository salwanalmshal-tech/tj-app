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

export function compare(st, pickIds, today) {
  const runs = (st.scans?.runs || []).filter((r) => pickIds.includes(r.id));
  if (!runs.length) return { runs, rows: [], cols: [], universe: 0 };
  const sets = runs.map((r) => new Set(r.rows.map((x) => tickerOf(x.s))));
  const common = [...sets[0]].filter((t) => sets.every((s) => s.has(t)));
  // RS group = every stock in the ticked runs (not only the common ones), so a 90 means strong among all candidates
  const universe = new Set(sets.flatMap((s) => [...s]));
  const newestFirst = [...runs].sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq);
  const valueOf = (t, re) => { for (const r of newestFirst) { const v = cellOf(r, t, re); if (v !== null && v !== '') return v; } return null; };
  const scores = new Map([...universe].map((t) => [t, rsScore(pctNum(valueOf(t, PERF.m3)), pctNum(valueOf(t, PERF.m6)), pctNum(valueOf(t, PERF.y1)))]));
  const ranks = rsRanks(scores);
  const cols = [...new Set(newestFirst.flatMap((r) => r.cols || []))].filter((c) => !/^symbol$/i.test(c));
  const rows = common.map((t) => {
    const src = newestFirst.find((r) => r.rows.some((x) => tickerOf(x.s) === t));
    const full = src.rows.find((x) => tickerOf(x.s) === t).s;
    const vals = Object.fromEntries(cols.map((c) => { for (const r of newestFirst) { const i = (r.cols || []).indexOf(c); if (i < 0) continue; const x = r.rows.find((y) => tickerOf(y.s) === t); if (x && x.v?.[i]) return [c, x.v[i]]; } return [c, '']; }));
    const mark = st.scans?.marks?.[t] || null;
    return { t, full: full.includes(':') ? full : (exchangeOf(full) ? full : t), rs: ranks.get(t) ?? null, vals, mark, earnings: earningsDays(valueOf(t, EARN), today), earningsText: valueOf(t, EARN) };
  });
  // his order: New first, then Watching and Near buy, then Rejected (dimmed); inside each group by RS, strongest first
  const grp = (r) => (!r.mark ? 0 : r.mark.st === 'rej' ? 2 : 1);
  rows.sort((a, b) => grp(a) - grp(b) || (b.rs ?? -1) - (a.rs ?? -1) || a.t.localeCompare(b.t));
  return { runs, rows, cols, universe: universe.size };
}

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
