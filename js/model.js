import * as D from './decimal.js';
// Data model, defaults and settings for the Trade Journal data file (one JSON file in Google Drive).
// Raise APP_VERSION with EVERY release that goes live: the first time a new version opens the data file,
// a "before update" backup is made (B5).
export const APP_VERSION = '1.8.2';
export const SCHEMA = 1;

export function defaultSettings() {
  return {
    // Stops check (G1): percent distance between last price and Current stop
    stopBelowBuy: { raiseAbove: '6', closeWithin: '1' },
    stopAboveBuy: { raiseAbove: '9', closeWithin: '2' },
    // Next report (G2)
    reportedAgoDays: 6, reportStaleDays: 30,
    // G3..G8
    highestToStop: '10', emaNear: '1.5', stopFarBelowBuy: '5.5', stopFarBelowBuyRisk: '0.2', profitLocked: '15',
    riskWarn: '0.2', riskRed: '0.56',
    posTooBig: '12.01', posNear: '11', posSmallFrom: '1', posSmallTo: '5',
    histLoss: '0.5', histGain: '1',
    stockLoss1: '1', stockLoss2: '1.5', stockGain1: '1', stockGain2: '1.5',
    // F6 labels
    rCategories: [['3', 'BIG WINNER'], ['1.5', 'GOOD WINNER'], ['0.5', 'WINNER'], ['0', 'SMALL GAIN'], ['-0.5', 'CONTROLLED LOSS'], ['-1.11', 'STOP LOSS']],
    rCategoryElse: 'BAD LOSS',
    stopDistance: [['3', 'Tight'], ['7', 'Good'], ['10', 'Wide']], stopDistanceElse: 'High Risk',
    // saving
    saveDelaySec: 3,
    // weekly Excel copy in the Backups folder (readable copy; restore always uses the JSON backups)
    excelCopyDays: 7, excelCopyKeep: 4,
    // price jump check on typed prices. NOT yet decided by the owner: value below is a starting value, shown in Settings.
    bigJumpPct: '20',
    // share calculator in Open trade: the risk % he accepts per trade. Empty = start from his own "orange above" risk limit (riskWarn).
    calcRiskPct: '',
    scanKeepDays: 90, // 1.8.0: Scans — full scan runs kept this many days, then only date, scanner and tickers
    // Performance verdicts (plan step 2): the 5 limits of each scale, lowest first. Start values = his Excel Calculator.
    verdictWin: ['0.5', '1', '1.5', '2.5', '4'], verdictLoss: ['0.5', '0.75', '1', '1.25', '1.5'], verdictRatio: ['1', '1.5', '2', '3', '5'],
  };
}

// 1.7.0 Reports: the 3 example reports a journal starts with (he can change, copy or delete them)
export function exampleReports() {
  return [
    { id: 'RP-1', name: 'Win rate per month', g1: 'month', g2: '', measures: ['winRate', 'trades', 'net', 'avgR'], chart: 'line', filters: { period: 'year' } },
    { id: 'RP-2', name: 'Result by setup', g1: 'setup', g2: '', measures: ['net', 'avgR', 'trades', 'winRate'], chart: 'bar', filters: { period: 'all' } },
    { id: 'RP-3', name: 'Result by sector', g1: 'sector', g2: '', measures: ['net', 'trades', 'winRate', 'capPct'], chart: 'bar', filters: { period: 'year' } },
  ];
}

export function emptyState(now = new Date().toISOString()) {
  return {
    meta: { app: 'trade-journal', schema: SCHEMA, version: APP_VERSION, createdAt: now, savedAt: null, envelope: null },
    counters: { trade: 0, seq: 0, id: 0 },
    settings: defaultSettings(),
    capital: { start: null, flows: [] },
    stocks: [], setups: [], errors: [],
    trades: [], dividends: [],
    trash: [], changeLog: [], stopHistory: [], splits: [],
    reports: exampleReports(), layouts: {}, columnTemplates: {},
    historySeen: null, reminders: {},
    // 1.8.0 Scans tab: dated scan runs grouped by scanner, one status per stock (kept across scans), his reject reasons
    scans: emptyScans(),
    rejects: defaultRejects(),
  };
}

// 1.8.1: his own folders and lists (folder = one TradingView watchlist, list = a section), folded scanners
export function emptyScans() { return { runs: [], marks: {}, showCols: null, lists: [], folders: [], fold: {}, compares: [], keyCols: null }; } // 1.8.2: saved comparisons, key values under the chart
// 1.8.0: the reject reason chips he starts with (his choice A); he adds, renames and archives them in Lists
export function defaultRejects() {
  return [['rj-ext', 'Extended'], ['rj-vol', 'Weak volume'], ['rj-earn', 'Earnings soon'], ['rj-sma50', 'Below SMA 50'], ['rj-base', 'Bad base'], ['rj-rs', 'Low RS']].map(([id, name]) => ({ id, name, archived: false }));
}

export function nextId(state, prefix = 'x') { state.counters.id += 1; return prefix + state.counters.id.toString(36); }
export function nextSeq(state) { state.counters.seq += 1; return state.counters.seq; }
export function nextTradeId(state) { state.counters.trade += 1; return 'T-' + String(state.counters.trade).padStart(4, '0'); }

// A file written by a newer program is refused (the old program can never damage it).
export function checkFile(data) {
  if (!data || data.meta?.app !== 'trade-journal') return { ok: false, reason: 'This is not a Trade Journal data file.' };
  if (data.meta.schema > SCHEMA) return { ok: false, reason: 'This data file was saved by a newer version of the program. Update the program first.' };
  const probs = dataProblems(data);
  if (probs.length) return { ok: false, reason: 'Some values in this file are not valid, so it is not used:\n• ' + probs.slice(0, 8).join('\n• ') + (probs.length > 8 ? `\n… and ${probs.length - 8} more` : ''), problems: probs };
  return { ok: true };
}
// Review fix 2026-11-09: every number and date the program calculates with is checked before a file is used,
// so one wrong value can never make the program unusable. Returns a list of plain-language problems (empty = fine).
export function dataProblems(data) {
  const out = []; const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const isNum = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && D.parse(v) !== null);
  const num = (v, where, { opt = false, pos = false } = {}) => {
    if ((v === '' || v === null || v === undefined) && opt) return;
    if (!isNum(v)) return out.push(`${where}: "${v ?? ''}" is not a number`);
    if (pos && D.parse(String(v)) <= 0n) out.push(`${where}: must be above 0`);
  };
  const date = (v, where, { opt = false } = {}) => { if ((v === '' || v === null || v === undefined) && opt) return; if (typeof v !== 'string' || !ISO.test(v) || Number.isNaN(Date.parse(v))) out.push(`${where}: "${v ?? ''}" is not a valid date`); };
  const arr = (v, where) => { if (v !== undefined && !Array.isArray(v)) { out.push(`${where} is not a list`); return []; } return v || []; };
  const stocks = arr(data.stocks, 'Stocks'); const ids = new Set(stocks.map((x) => x?.id));
  // IDs are only letters, digits, - _ . (they are used inside the page and to find things again)
  const ID = /^[A-Za-z0-9_.-]{1,40}$/;
  for (const [list, name] of [['stocks', 'Stock'], ['setups', 'Setup'], ['errors', 'Mistake'], ['rejects', 'Reject reason']]) for (const x of arr(data[list], name + 's')) if (!x || !ID.test(String(x.id))) out.push(`${name} "${x?.id ?? ''}": not a valid ID`);
  for (const t of arr(data.trades, 'Trades')) {
    const w = `Trade ${t?.id ?? '?'}`; if (!t || typeof t !== 'object') { out.push('A trade is empty'); continue; }
    if (!ID.test(String(t.id))) out.push(`${w}: not a valid trade ID`);
    if (!ids.has(t.stockId)) out.push(`${w}: its stock is missing`);
    date(t.buyDate, w + ' buy date'); num(t.qty, w + ' shares', { pos: true }); num(t.buyPrice, w + ' buy price', { pos: true });
    for (const k of ['buyCommission', 'initialStop', 'currentStop', 'last', 'highest', 'ema10', 'capitalAtOpen']) num(t[k], `${w} ${k}`, { opt: true });
    date(t.nextReport, w + ' next report', { opt: true });
    // half stars (1.4.8) are still read here; migrate() clears them (decision 2026-11-10: whole stars only)
    if (t.stars !== undefined && t.stars !== null && !(typeof t.stars === 'number' && t.stars >= 0.5 && t.stars <= 5 && Math.round(t.stars * 2) === t.stars * 2)) out.push(`${w} stars: "${t.stars}" is not 1 to 5`);
    for (const x of arr(t.sales, w + ' sales')) { if (!ID.test(String(x?.id))) out.push(w + ': a sale has no valid ID'); date(x?.date, w + ' sale date'); num(x?.qty, w + ' sold shares', { pos: true }); num(x?.price, w + ' sell price'); num(x?.commission, w + ' sell commission', { opt: true }); }
  }
  const cap = data.capital || {};
  if (cap.start) { num(cap.start.amount, 'Start capital'); date(cap.start.date, 'Start capital date'); }
  for (const f of arr(cap.flows, 'Deposits and withdrawals')) { num(f?.amount, 'Deposit/withdrawal amount', { pos: true }); date(f?.date, 'Deposit/withdrawal date'); }
  for (const dv of arr(data.dividends, 'Dividends')) { num(dv?.amount, 'Dividend amount'); date(dv?.payDate, 'Dividend date'); }
  // 1.8.0 Scans: runs need an ID, a date and a list of stocks; statuses need a known status (bad scan data can never stop the program)
  if (data.scans !== undefined) {
    if (!data.scans || typeof data.scans !== 'object') out.push('Scans are not readable');
    else {
      for (const r of arr(data.scans.runs, 'Scan runs')) { if (!r || !ID.test(String(r.id))) { out.push('A scan run has no valid ID'); continue; } date(r.date, `Scan run ${r.id} date`); arr(r.rows, `Scan run ${r.id} stocks`); }
      for (const l of arr(data.scans.lists ?? [], 'Scan lists')) { if (!l || !ID.test(String(l.id))) { out.push('A scan list has no valid ID'); continue; } arr(l.items, `Scan list ${l.name} stocks`); }
      for (const c of arr(data.scans.compares ?? [], 'Scan comparisons')) if (!c || !ID.test(String(c.id)) || !Array.isArray(c.scanners)) out.push('A saved comparison is not readable');
      for (const f of arr(data.scans.folders ?? [], 'Scan folders')) if (!f || !ID.test(String(f.id))) out.push('A scan folder has no valid ID');
      const m = data.scans.marks; if (m !== undefined && (typeof m !== 'object' || Array.isArray(m) || m === null)) out.push('Scan statuses are not readable');
      else for (const [k, v] of Object.entries(m || {})) if (!v || !['watch', 'near', 'rej'].includes(v.st)) out.push(`Scan status of ${k} is not valid`);
    }
  }
  return out;
}
// Migration hook: each future structure change is one step. Returns the (possibly upgraded) data.
export function migrate(data) {
  const out = structuredClone(data);
  const base = emptyState();
  for (const k of Object.keys(base)) if (out[k] === undefined) out[k] = base[k];
  out.settings = { ...base.settings, ...out.settings };
  // 1.8.1: scans from 1.8.0 get the new parts (lists, folders, folded scanners)
  if (out.scans && typeof out.scans === 'object') out.scans = { ...emptyScans(), ...out.scans };
  // 1.7.0: a journal from before the Reports page gets the 3 example reports once (never again after he deletes them)
  if (!out.meta.reportsSeeded) { if (!Array.isArray(out.reports) || !out.reports.length) out.reports = exampleReports(); out.meta.reportsSeeded = true; }
  // 1.4.9: whole stars only. A half-star rating from 1.4.8 is cleared, so the trade shows as not rated and can be rated again.
  for (const t of out.trades || []) if (t && t.stars !== undefined && t.stars !== null && !Number.isInteger(t.stars)) t.stars = null;
  out.meta.schema = SCHEMA; out.meta.version = APP_VERSION;
  return out;
}

// B5: a new program version (or a structure change) is opening this file for the first time -> back up first
export function needsUpdateBackup(data) { return !!data && (data.meta?.version !== APP_VERSION || (data.meta?.schema ?? 0) < SCHEMA); }
