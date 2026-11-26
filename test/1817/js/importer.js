// Excel import / export logic (pure: works on plain rows, so it can be tested). The Excel reading itself is done by SheetJS in the screen.
// Import has two modes: New start (REPLACES everything) and Update (mergeImport: adds what is new). Any error stops the import and nothing changes.
import * as D from './decimal.js';
import * as C from './calc.js';
import * as A from './actions.js';
import { emptyState, nextId, nextSeq, nextTradeId } from './model.js';
import { parseDMY, addDays } from './dates.js';

const SHEETS = ['Open positions', 'History', 'Sales history', 'Capital start', 'Deposits withdrawals', 'Dividends', 'Stocks list', 'Setups list', 'Errors list'];
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const EX = 'example row (ignored by import)';

// Excel date serial -> ISO (1900 system)
export function serialToISO(n) { return addDays('1899-12-30', Math.floor(n)); }
export function toDate(v) {
  if (v === null || v === undefined || v === '') return { empty: true };
  if (typeof v === 'number') { if (v < 1 || v > 80000) return { bad: true }; return { iso: serialToISO(v) }; }
  const iso = parseDMY(String(v)); return iso ? { iso } : { bad: true };
}
export function toNum(v) {
  if (v === null || v === undefined || String(v).trim() === '') return { empty: true };
  // JS numbers print their shortest exact decimal text; very small or big ones use e-notation, so those are written out (review fix)
  const txt = typeof v === 'number' ? (Number.isFinite(v) ? (/e/i.test(String(v)) ? v.toFixed(8) : String(v)) : '') : String(v);
  const p = D.parse(txt);
  return p === null ? { bad: true } : { v: p };
}

// sheets: { 'Sheet name': [ {Header: value, ...}, ... ] }  (header names matched ignoring case/spacing)
export function buildFromSheets(rawSheets, now = new Date().toISOString()) {
  const errors = [], warnings = [], ignoredSheets = [], ignoredColumns = [];
  const err = (sheet, row, msg) => errors.push({ sheet, row, msg }); const warn = (sheet, row, msg) => warnings.push({ sheet, row, msg });
  const byName = new Map(); for (const k of Object.keys(rawSheets)) byName.set(norm(k), k);
  for (const k of Object.keys(rawSheets)) if (!SHEETS.some((s) => norm(s) === norm(k))) ignoredSheets.push(k);
  const rowsOf = (name) => {
    const key = byName.get(norm(name)); if (!key) return null;
    const out = [];
    rawSheets[key].forEach((r, i) => {
      const o = {}; for (const [h, v] of Object.entries(r)) o[norm(h)] = v;
      if (o[EX] !== undefined && String(o[EX]).trim() !== '') return; // example row
      if (Object.values(o).every((v) => v === null || v === undefined || String(v).trim() === '')) return; // empty row
      o.__row = i + 2; out.push(o);
    });
    const known = new Set(); return out;
  };
  const get = (r, name, aliases = []) => { for (const n of [name, ...aliases]) { if (r[norm(n)] !== undefined) return r[norm(n)]; } return undefined; };
  const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

  const st = emptyState(now);
  // ---- capital start
  const capRows = rowsOf('Capital start');
  let startAmt = null, startDate = null;
  if (!capRows || !capRows.length) err('Capital start', '', 'The sheet “Capital start” is missing or empty. It needs the start capital and the start date.');
  else {
    const r = capRows[0]; if (capRows.length > 1) warn('Capital start', r.__row, 'More than one row: only the first row is used.');
    const a = toNum(get(r, 'Start capital (USD)', ['Start capital'])), d = toDate(get(r, 'Start date'));
    if (a.empty || a.bad || a.v < 0n) err('Capital start', r.__row, 'Start capital must be a number.'); else startAmt = a.v;
    if (d.empty || d.bad) err('Capital start', r.__row, 'Start date is missing or not a valid date (dd-mm-yyyy).'); else startDate = d.iso;
  }
  // ---- lists
  const stockMeta = new Map(); // SYMBOL -> info
  const ensureStock = (sym, info = {}) => { const k = sym.toUpperCase(); if (!stockMeta.has(k)) stockMeta.set(k, { symbol: k, sector: '', industry: '', exchange: '' }); Object.assign(stockMeta.get(k), Object.fromEntries(Object.entries(info).filter(([, v]) => v))); return stockMeta.get(k); };
  for (const r of rowsOf('Stocks list') || []) { const s = str(get(r, 'Symbol')); if (!s) { err('Stocks list', r.__row, 'Symbol is missing.'); continue; } const m = ensureStock(s, { sector: str(get(r, 'Sector')), industry: str(get(r, 'Industry')), exchange: str(get(r, 'Exchange')) }); void m; }
  const setupNames = new Map(), errorNames = new Map();
  const addName = (map, v) => { const n = str(v); if (n && !map.has(n.toLowerCase())) map.set(n.toLowerCase(), n); return n ? map.get(n.toLowerCase()) : ''; };
  for (const r of rowsOf('Setups list') || []) addName(setupNames, get(r, 'Setup', ['Name']));
  for (const r of rowsOf('Errors list') || []) addName(errorNames, get(r, 'Error', ['Name']));

  // ---- lines
  const lines = []; // {sheet,row,id,sym,buyDate,buyPrice,...}
  const readCommon = (sheet, r) => {
    const o = { sheet, row: r.__row, id: str(get(r, 'Trade ID')), sym: str(get(r, 'Symbol')).toUpperCase(), setup: str(get(r, 'Setup')), error: str(get(r, 'Error')), comment: str(get(r, 'Comment')) };
    let bad = false; const fail = (m) => { err(sheet, r.__row, m); bad = true; };
    if (!o.sym) fail('Symbol is missing.');
    const bd = toDate(get(r, 'Buy date')); if (bd.empty) fail('Buy date is missing.'); else if (bd.bad) fail('Buy date is not a valid date (dd-mm-yyyy).'); else o.buyDate = bd.iso;
    const bp = toNum(get(r, 'Buy price')); if (bp.empty) fail('Buy price is missing.'); else if (bp.bad || bp.v <= 0n) fail('Buy price must be a number above 0.'); else o.buyPrice = bp.v;
    const is = toNum(get(r, 'Initial stop')); if (is.bad || (!is.empty && is.v <= 0n)) fail('Initial stop must be a number above 0.'); else if (!is.empty) o.initialStop = is.v;
    if (o.initialStop && o.buyPrice && o.initialStop >= o.buyPrice) fail('Initial stop must be below the buy price.');
    // setup rating (2026-11-10): optional; a wrong value is only a warning and is left empty
    const sv = get(r, 'Stars', ['Setup rating']); if (sv !== undefined && String(sv).trim() !== '') { const n = A.normStars(String(sv)); if (n === undefined) warn(sheet, r.__row, `Stars "${sv}" is not 1, 2, 3, 4 or 5. Left empty.`); else o.stars = n; }
    const dnum = (name, alias, key, label, must) => { const x = toNum(get(r, name, alias)); if (x.bad || (!x.empty && x.v < 0n)) fail(label + ' must be a number.'); else if (!x.empty) o[key] = x.v; };
    o.bad = false; o.fail = () => bad; return o;
  };
  for (const r of rowsOf('Open positions') || []) {
    const o = readCommon('Open positions', r); o.kind = 'open';
    const q = toNum(get(r, 'Quantity')); if (q.empty) err(o.sheet, r.__row, 'Quantity is missing.'); else if (q.bad || q.v <= 0n) err(o.sheet, r.__row, 'Quantity must be a number above 0.'); else o.qty = q.v;
    for (const [name, key, label, alias] of [['Current stop', 'currentStop', 'Current stop'], ['Last price', 'last', 'Last price'], ['Highest price', 'highest', 'Highest price'], ['EMA10', 'ema10', 'EMA10'], ['Buy commission', 'buyCommission', 'Buy commission']]) {
      const x = toNum(get(r, name)); if (x.bad || (!x.empty && x.v < 0n)) err(o.sheet, r.__row, label + ' must be a number.'); else if (!x.empty) o[key] = x.v;
    }
    const nr = toDate(get(r, 'Next report')); if (nr.bad) err(o.sheet, r.__row, 'Next report is not a valid date (dd-mm-yyyy).'); else if (!nr.empty) o.nextReport = nr.iso;
    lines.push(o);
  }
  // Excel does not allow a sheet named "History" when writing (SheetJS 0.20), so the program writes "Sales history"; both are read
  const histName = rowsOf('History') ? 'History' : 'Sales history';
  for (const r of rowsOf(histName) || []) {
    const o = readCommon(histName, r); o.kind = 'sale';
    const q = toNum(get(r, 'Quantity sold')); if (q.empty) err(o.sheet, r.__row, 'Quantity sold is missing.'); else if (q.bad || q.v <= 0n) err(o.sheet, r.__row, 'Quantity sold must be a number above 0.'); else o.qty = q.v;
    const sd = toDate(get(r, 'Sell date')); if (sd.empty) err(o.sheet, r.__row, 'Sell date is missing. A closed trade needs its sell date.'); else if (sd.bad) err(o.sheet, r.__row, 'Sell date is not a valid date (dd-mm-yyyy).'); else o.sellDate = sd.iso;
    const sp = toNum(get(r, 'Sell price')); if (sp.empty) err(o.sheet, r.__row, 'Sell price is missing. The result cannot be calculated without it.'); else if (sp.bad || sp.v <= 0n) err(o.sheet, r.__row, 'Sell price must be a number above 0.'); else o.sellPrice = sp.v;
    const bc = toNum(get(r, 'Buy commission (share for these shares)', ['Buy commission'])); if (bc.bad || (!bc.empty && bc.v < 0n)) err(o.sheet, r.__row, 'Buy commission must be a number.'); else if (!bc.empty) o.buyCommission = bc.v;
    const sc = toNum(get(r, 'Sell commission')); if (sc.bad || (!sc.empty && sc.v < 0n)) err(o.sheet, r.__row, 'Sell commission must be a number.'); else if (!sc.empty) o.sellCommission = sc.v;
    if (o.sellDate && o.buyDate && o.sellDate < o.buyDate) err(o.sheet, r.__row, 'Sell date is before the buy date.');
    lines.push(o);
  }
  // ---- group into trades
  const keyOf = (o) => `${o.sym}|${o.buyDate}|${o.buyPrice}`;
  const groups = new Map(); const noId = [];
  for (const o of lines) { if (!o.sym || !o.buyDate || !o.buyPrice) continue; if (o.id) { const k = 'id:' + o.id.toLowerCase(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); } else noId.push(o); }
  for (const o of noId) {
    const matches = [...groups.entries()].filter(([k, g]) => k.startsWith('id:') && keyOf(g[0]) === keyOf(o));
    if (matches.length === 1) matches[0][1].push(o);
    else if (matches.length > 1) err(o.sheet, o.row, `Several trades match ${o.sym} bought ${o.buyDate.split('-').reverse().join('-')} at the same price. Fill in the Trade ID.`);
    else { const k = 'key:' + keyOf(o); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
  }
  const trades = [];
  for (const [k, g] of groups) {
    const first = g[0]; const opens = g.filter((x) => x.kind === 'open'), sales = g.filter((x) => x.kind === 'sale');
    if (g.some((x) => keyOf(x) !== keyOf(first))) { const bad = g.find((x) => keyOf(x) !== keyOf(first)); err(bad.sheet, bad.row, `Trade ID ${bad.id} is used for different buy lines (symbol, buy date or buy price differ). Check the rows.`); continue; }
    if (opens.length > 1) { err(opens[1].sheet, opens[1].row, `Trade ${opens[0].id || opens[0].sym} appears twice in Open positions. One row per buy line.`); continue; }
    const open = opens[0]; const soldQty = sales.reduce((a, s) => a + (typeof s.qty === 'bigint' ? s.qty : 0n), 0n); const qty = soldQty + (typeof open?.qty === 'bigint' ? open.qty : 0n); // a missing quantity is already listed as an error (review fix: no crash)
    const stops = [...new Set(g.map((x) => x.initialStop).filter(Boolean).map(String))];
    if (stops.length > 1) { err(first.sheet, first.row, `Rows of this trade have different Initial stops (${stops.join(', ')}).`); continue; }
    const comms = g.map((x) => x.buyCommission).filter((x) => x !== undefined);
    trades.push({ g, open, sales, qty, buyDate: first.buyDate, buyPrice: first.buyPrice, sym: first.sym, initialStop: stops[0] ? BigInt(stops[0]) : null, buyCommission: comms.length ? comms.reduce((a, b) => a + b, 0n) : null,
      setup: open?.setup || g.find((x) => x.setup)?.setup || '', error: open?.error || g.find((x) => x.error)?.error || '', comment: open?.comment || g.find((x) => x.comment)?.comment || '', stars: open?.stars ?? g.find((x) => x.stars != null)?.stars ?? null, rows: g });
    if (!stops.length) warn(first.sheet, first.row, `${first.sym}: no Initial stop. The trade is “No SL” and stays out of R statistics.`);
    if (!comms.length) warn(first.sheet, first.row, `${first.sym}: no buy commission. The result is calculated without it.`);
  }
  // ---- flows and dividends
  const flowRows = [];
  for (const r of rowsOf('Deposits withdrawals') || []) {
    const d = toDate(get(r, 'Date')), a = toNum(get(r, 'Amount (USD)', ['Amount'])), t = norm(get(r, 'Type (Deposit or Withdrawal)', ['Type']));
    if (d.empty || d.bad) { err('Deposits withdrawals', r.__row, 'Date is missing or not valid (dd-mm-yyyy).'); continue; }
    if (a.empty || a.bad || a.v <= 0n) { err('Deposits withdrawals', r.__row, 'Amount must be a number above 0.'); continue; }
    if (t !== 'deposit' && t !== 'withdrawal') { err('Deposits withdrawals', r.__row, 'Type must be Deposit or Withdrawal.'); continue; }
    if (startDate && d.iso < startDate) { err('Deposits withdrawals', r.__row, 'The date is before the start capital date.'); continue; }
    flowRows.push({ date: d.iso, type: t, amount: a.v });
  }
  const divRows = [];
  for (const r of rowsOf('Dividends') || []) {
    const d = toDate(get(r, 'Pay date')), a = toNum(get(r, 'Net amount (USD)', ['Net amount'])), s = str(get(r, 'Symbol')).toUpperCase();
    if (d.empty || d.bad) { err('Dividends', r.__row, 'Pay date is missing or not valid (dd-mm-yyyy).'); continue; }
    if (a.empty || a.bad || a.v <= 0n) { err('Dividends', r.__row, 'Net amount must be a number above 0.'); continue; }
    if (!s) { err('Dividends', r.__row, 'Symbol is missing.'); continue; }
    divRows.push({ payDate: d.iso, amount: a.v, sym: s });
  }
  if (startDate) for (const t of trades) if (t.buyDate < startDate) err(t.g[0].sheet, t.g[0].row, `${t.sym}: the buy date is before the start capital date (${startDate.split('-').reverse().join('-')}).`);
  if (errors.length) return { ok: false, errors, warnings, ignoredSheets, ignoredColumns };

  // ---- build the state
  st.capital.start = { amount: D.toStr(startAmt), date: startDate, seq: 0 };
  for (const t of trades) ensureStock(t.sym); for (const d of divRows) ensureStock(d.sym);
  for (const m of [...stockMeta.values()].sort((a, b) => a.symbol.localeCompare(b.symbol))) st.stocks.push({ id: nextId(st, 's'), symbol: m.symbol, sector: m.sector, industry: m.industry, exchange: m.exchange, archived: false });
  const sid = (sym) => st.stocks.find((x) => x.symbol === sym).id;
  for (const t of trades) { addName(setupNames, t.setup); addName(errorNames, t.error); }
  for (const n of setupNames.values()) st.setups.push({ id: nextId(st, 'u'), name: n, archived: false });
  for (const n of errorNames.values()) st.errors.push({ id: nextId(st, 'e'), name: n, archived: false });
  const listId = (list, name) => (name ? st[list].find((x) => x.name.toLowerCase() === name.toLowerCase())?.id ?? null : null);
  // events in time order; on the same day: deposits, dividends, buys, then sales
  const ev = [];
  for (const f of flowRows) ev.push({ date: f.date, o: 1, f });
  for (const d of divRows) ev.push({ date: d.payDate, o: 2, d });
  trades.sort((a, b) => (a.buyDate < b.buyDate ? -1 : a.buyDate > b.buyDate ? 1 : a.g[0].row - b.g[0].row));
  for (const t of trades) { ev.push({ date: t.buyDate, o: 3, t }); for (const s of t.sales) ev.push({ date: s.sellDate, o: 4, t, s }); }
  ev.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.o - b.o));
  const built = new Map(); let sameDay = false;
  st.capital.start.seq = nextSeq(st);
  for (const e of ev) {
    if (e.f) st.capital.flows.push({ id: nextId(st, 'f'), date: e.f.date, type: e.f.type, amount: D.toStr(e.f.amount), seq: nextSeq(st) });
    else if (e.d) st.dividends.push({ id: nextId(st, 'v'), stockId: sid(e.d.sym), payDate: e.d.payDate, amount: D.toStr(e.d.amount), seq: nextSeq(st) });
    else if (e.s === undefined) {
      const t = e.t; const open = t.open; const S = D.toStr;
      const tr = { id: nextTradeId(st), seq: nextSeq(st), stockId: sid(t.sym), buyDate: t.buyDate, qty: S(t.qty), buyPrice: S(t.buyPrice), buyCommission: t.buyCommission === null ? '' : S(t.buyCommission), initialStop: t.initialStop ? S(t.initialStop) : '',
        currentStop: open?.currentStop ? S(open.currentStop) : '', last: open?.last ? S(open.last) : S(t.buyPrice), highest: open?.highest ? S(open.highest) : S(t.buyPrice), ema10: open?.ema10 ? S(open.ema10) : '', nextReport: open?.nextReport || '',
        setupId: listId('setups', t.setup), errorId: listId('errors', t.error), comment: t.comment, direction: 'Long', capitalAtOpen: '', sales: [] };
      tr.stars = A.canRate(st, tr.setupId) ? t.stars : null; // only a real setup keeps its stars
      if (open && !tr.currentStop) tr.currentStop = tr.initialStop; // an open line with an Initial stop and no Current stop starts with the Initial stop
      st.trades.push(tr); built.set(t, tr);
    } else {
      const tr = built.get(e.t); if (e.t.rows.some((x) => x.kind === 'sale') && st.trades.some((x) => x.buyDate === e.s.sellDate && x !== tr)) sameDay = true;
      tr.sales.push({ id: nextId(st, 'x'), seq: nextSeq(st), date: e.s.sellDate, qty: D.toStr(e.s.qty), price: D.toStr(e.s.sellPrice), commission: e.s.sellCommission === undefined ? '' : D.toStr(e.s.sellCommission) });
    }
  }
  if (sameDay) warnings.push({ sheet: '', row: '', msg: 'Some sales happened on the same day as a buy. The order within a day is not in the file: buys are counted before sales for “capital at open”.' });
  A.recalcCapital(st);
  const probs = st.trades.flatMap((t) => C.quantityProblems(t)); if (probs.length) return { ok: false, errors: [{ sheet: '', row: '', msg: 'Quantities do not add up.' }], warnings, ignoredSheets, ignoredColumns };
  st.meta.importedAt = now;
  return { ok: true, state: st, errors, warnings, ignoredSheets, ignoredColumns, summary: { trades: st.trades.length, open: st.trades.filter((t) => C.openQty(t) > 0n).length, closed: st.trades.filter((t) => C.openQty(t) === 0n).length, sales: st.trades.reduce((a, t) => a + t.sales.length, 0), flows: st.capital.flows.length, dividends: st.dividends.length, stocks: st.stocks.length } };
}

// ---- export: same layout as the import template; dates as {d:'yyyy-mm-dd'} for the screen to turn into Excel dates
export function toSheets(state) {
  const sym = (t) => state.stocks.find((s) => s.id === t.stockId)?.symbol ?? '';
  const nm = (list, id) => state[list].find((x) => x.id === id)?.name ?? '';
  const n = (s) => (s === '' || s === null || s === undefined ? '' : { n: s });
  const dt = (iso) => (iso ? { d: iso } : '');
  const open = [], hist = [];
  const trades = state.trades.slice().sort((a, b) => a.seq - b.seq);
  for (const t of trades) {
    const det = C.salesDetail(t); const shares = det.reduce((a, x) => a + x.buyShare, 0n); const oq = C.openQty(t);
    if (oq > 0n) open.push({ 'Trade ID': t.id, Symbol: sym(t), 'Buy date': dt(t.buyDate), Quantity: n(D.toStr(oq)), 'Buy price': n(t.buyPrice), 'Initial stop': n(t.initialStop), 'Current stop': n(t.currentStop), 'Last price': n(t.last), 'Highest price': n(t.highest), EMA10: n(t.ema10), 'Next report': dt(t.nextReport), 'Buy commission': t.buyCommission === '' ? '' : n(D.toStr(D.d(t.buyCommission) - shares)), Setup: nm('setups', t.setupId), Stars: t.stars ?? '', Error: nm('errors', t.errorId), Comment: t.comment });
    for (const x of det) hist.push({ 'Trade ID': t.id, Symbol: sym(t), 'Buy date': dt(t.buyDate), 'Sell date': dt(x.sale.date), 'Quantity sold': n(x.sale.qty), 'Buy price': n(t.buyPrice), 'Sell price': n(x.sale.price), 'Buy commission (share for these shares)': t.buyCommission === '' ? '' : n(D.toStr(x.buyShare)), 'Sell commission': n(x.sale.commission), 'Initial stop': n(t.initialStop), Setup: nm('setups', t.setupId), Stars: t.stars ?? '', Error: nm('errors', t.errorId), Comment: t.comment });
  }
  return {
    'Open positions': open, 'Sales history': hist,
    'Capital start': state.capital.start ? [{ 'Start capital (USD)': n(state.capital.start.amount), 'Start date': dt(state.capital.start.date) }] : [],
    'Deposits withdrawals': state.capital.flows.map((f) => ({ Date: dt(f.date), 'Type (Deposit or Withdrawal)': f.type === 'deposit' ? 'Deposit' : 'Withdrawal', 'Amount (USD)': n(f.amount), Note: '' })),
    Dividends: state.dividends.map((d) => ({ 'Pay date': dt(d.payDate), Symbol: state.stocks.find((s) => s.id === d.stockId)?.symbol ?? '', 'Net amount (USD)': n(d.amount) })),
    'Stocks list': state.stocks.map((s) => ({ Symbol: s.symbol, Sector: s.sector, Industry: s.industry, Exchange: s.exchange })),
    'Setups list': state.setups.map((s) => ({ Setup: s.name })), 'Errors list': state.errors.map((s) => ({ Error: s.name })),
  };
}
// the screen turns {n:'12.5'} into a number cell and {d:'2026-01-05'} into a date cell; this plain version is used by tests
export function plainSheets(sheets) {
  const iso2serial = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };
  return Object.fromEntries(Object.entries(sheets).map(([k, rows]) => [k, rows.map((r) => Object.fromEntries(Object.entries(r).map(([h, v]) => [h, v && v.d ? iso2serial(v.d) : v && v.n !== undefined ? Number(v.n) : v])))]));
}

// ---- import mode "Update" (Q10): keep the program's data and ADD what is new in the file.
// `inc` is the state built by buildFromSheets. Rows already in the program are skipped and listed; conflicts stop the
// whole import (nothing changes). New trades get the next T-numbers; lists are merged by name. Nothing is recalculated
// for existing trades: the caller asks the user (D2) if their capital at open no longer matches.
export function mergeImport(current, inc) {
  const st = structuredClone(current); const S = D.toStr;
  const added = { trades: 0, sales: 0, flows: 0, dividends: 0, stocks: 0, setups: 0, errors: 0 }; const skipped = [], conflicts = [];
  const symOf = (state, stockId) => state.stocks.find((x) => x.id === stockId)?.symbol ?? '?';
  const key = (sym, date, price) => `${sym.toUpperCase()}|${date}|${S(D.d(price))}`;
  // start capital
  const a = current.capital.start, b = inc.capital.start;
  if (!a && b) st.capital.start = { amount: b.amount, date: b.date, seq: nextSeq(st) };
  else if (a && b && (S(D.d(a.amount)) !== S(D.d(b.amount)) || a.date !== b.date)) conflicts.push(`Start capital differs: the program has ${S(D.d(a.amount))} on ${a.date.split('-').reverse().join('-')}, the file has ${S(D.d(b.amount))} on ${b.date.split('-').reverse().join('-')}. Make them the same, or use New start.`);
  // lists by name
  const mapList = (list, field, extra) => {
    const m = new Map();
    for (const x of inc[list]) {
      let y = st[list].find((z) => z[field].toLowerCase() === x[field].toLowerCase());
      if (!y) { y = { id: nextId(st, list === 'stocks' ? 's' : list === 'setups' ? 'u' : 'e'), [field]: x[field], archived: false, ...(extra ? extra(x) : {}) }; st[list].push(y); added[list]++; }
      else if (list === 'stocks') for (const k of ['sector', 'industry', 'exchange']) if (!y[k] && x[k]) y[k] = x[k];
      m.set(x.id, y.id);
    }
    return m;
  };
  const stockMap = mapList('stocks', 'symbol', (x) => ({ sector: x.sector, industry: x.industry, exchange: x.exchange }));
  const setupMap = mapList('setups', 'name'), errorMap = mapList('errors', 'name');
  // trades: same Symbol + Buy date + Buy price = the same trade (K4 key)
  const have = new Map(current.trades.map((t) => [key(symOf(current, t.stockId), t.buyDate, t.buyPrice), t]));
  const soldOf = (t) => t.sales.reduce((s, x) => s + D.d(x.qty), 0n);
  const startDate = st.capital.start?.date; const newTrades = [];
  for (const t of inc.trades.slice().sort((x, y) => x.seq - y.seq)) {
    const sym = symOf(inc, t.stockId); const k = key(sym, t.buyDate, t.buyPrice); const old = have.get(k);
    const label = `${sym} bought ${t.buyDate.split('-').reverse().join('-')} at ${S(D.d(t.buyPrice))}`;
    if (old) {
      if (D.d(old.qty) === D.d(t.qty) && soldOf(old) === soldOf(t)) skipped.push(`${label}: already in the program as ${old.id}.`);
      else conflicts.push(`${label} is already in the program as ${old.id}, but with ${D.d(old.qty) !== D.d(t.qty) ? 'a different quantity' : 'different sales'}. Correct it in the program, or use New start.`);
      continue;
    }
    if (startDate && t.buyDate < startDate) { conflicts.push(`${label}: the buy date is before the start capital date.`); continue; }
    const nt = { ...structuredClone(t), id: nextTradeId(st), seq: nextSeq(st), stockId: stockMap.get(t.stockId), setupId: t.setupId ? setupMap.get(t.setupId) : null, errorId: t.errorId ? errorMap.get(t.errorId) : null };
    nt.sales = t.sales.map((s) => ({ ...s, id: nextId(st, 'x'), seq: nextSeq(st) }));
    st.trades.push(nt); newTrades.push(nt); added.trades++; added.sales += nt.sales.length;
  }
  // deposits / withdrawals and dividends: same date and amount (and type / stock) = already there
  for (const f of inc.capital.flows) {
    if (current.capital.flows.some((x) => x.date === f.date && x.type === f.type && D.d(x.amount) === D.d(f.amount))) { skipped.push(`${f.type === 'deposit' ? 'Deposit' : 'Withdrawal'} of ${S(D.d(f.amount))} on ${f.date.split('-').reverse().join('-')}: already in the program.`); continue; }
    if (startDate && f.date < startDate) { conflicts.push(`${f.type} on ${f.date.split('-').reverse().join('-')}: the date is before the start capital date.`); continue; }
    st.capital.flows.push({ ...f, id: nextId(st, 'f'), seq: nextSeq(st) }); added.flows++;
  }
  for (const dv of inc.dividends) {
    const sid = stockMap.get(dv.stockId);
    if (current.dividends.some((x) => x.stockId === sid && x.payDate === dv.payDate && D.d(x.amount) === D.d(dv.amount))) { skipped.push(`Dividend ${symOf(inc, dv.stockId)} ${S(D.d(dv.amount))} on ${dv.payDate.split('-').reverse().join('-')}: already in the program.`); continue; }
    if (startDate && dv.payDate < startDate) { conflicts.push(`Dividend on ${dv.payDate.split('-').reverse().join('-')}: the date is before the start capital date.`); continue; }
    st.dividends.push({ ...dv, id: nextId(st, 'd'), stockId: sid, seq: nextSeq(st) }); added.dividends++;
  }
  // review fix 2026-11-09: capital at open of new trades only after the file's deposits, withdrawals and dividends are in
  for (const nt of newTrades) nt.capitalAtOpen = S(C.capitalBefore(st, nt.buyDate, nt.seq));
  if (!conflicts.length) for (const t of st.trades) if (C.quantityProblems(t).length) conflicts.push(`${symOf(st, t.stockId)} ${t.id}: quantities do not add up.`);
  if (conflicts.length) return { ok: false, conflicts, skipped, added };
  st.changeLog.push({ ts: new Date().toISOString(), type: 'import-update', added: Object.entries(added).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing new' });
  return { ok: true, state: st, conflicts, skipped, added };
}
