// All changes to the data go through these actions. Each one works on a copy and returns { ok, error?, data? }.
// Nothing is changed when an action fails. Money values are stored as exact text.
import * as SC from './scans.js';
import * as D from './decimal.js';
import * as C from './calc.js';
import { nextId, nextSeq, nextTradeId } from './model.js';
import { diffDays } from './dates.js';

const err = (message, extra = {}) => ({ ok: false, error: message, ...extra });
const ok = (data) => ({ ok: true, data });
const S = D.toStr;
const need = (v) => v !== null && v !== undefined && String(v).trim() !== '';
export const findStock = (st, sym) => st.stocks.find((x) => x.symbol.toUpperCase() === String(sym).trim().toUpperCase());
export const stockById = (st, id) => st.stocks.find((x) => x.id === id);
export const symbolOf = (st, t) => stockById(st, t.stockId)?.symbol ?? '?';
export const tradeById = (st, id) => st.trades.find((t) => t.id === id);

// ---------- setup rating (stars, 2026-11-10) ----------
// 1 to 5 whole stars per trade, beside Setup (half stars removed 2026-11-10, version 1.4.9). Only a REAL setup can be rated:
// "Unclassified" (setup missing) and "No setup" (traded without a setup) have nothing to rate.
// Changing the setup of a trade clears its stars (a rating for one setup does not fit another).
const setupNameNorm = (st, id) => (st.setups.find((x) => x.id === id)?.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
export const isNoSetupName = (n) => (n || '').trim().toLowerCase().replace(/\s+/g, ' ') === 'no setup';
export const canRate = (st, setupId) => { if (!setupId) return false; const n = setupNameNorm(st, setupId); return !!n && n !== 'unclassified' && n !== 'no setup'; };
// a valid rating as a number (1 … 5), or null for "not rated"; undefined when the value is not valid
export function normStars(v) {
  if (v === null || v === undefined || v === '' || v === 0 || v === '0') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 1 || n > 5 || !Number.isInteger(n)) return undefined;
  return n;
}
// set the setup of a trade; when it really changes, the stars are cleared
export function setTradeSetup(t, setupId) { const v = setupId || null; if ((t.setupId || null) !== v) { t.setupId = v; t.stars = null; } }
export function setTradeStars(st, t, raw) {
  const n = normStars(raw); if (n === undefined) return err('Stars must be 1, 2, 3, 4 or 5.');
  if (n !== null && !canRate(st, t.setupId)) return err('Choose a setup first. “Unclassified” and “No setup” have no stars.');
  t.stars = n; return ok(t);
}
function log(st, entry) { st.changeLog.push({ ts: new Date().toISOString(), ...entry }); }

// ---------- capital ----------
export function setStartCapital(st, { amount, date }) {
  const a = D.parse(amount); if (a === null || a < 0n) return err('Enter the start capital as a number.');
  if (!date) return err('Enter the start capital date.');
  const earlier = st.trades.find((t) => t.buyDate < date);
  if (earlier) return err(`A trade (${symbolOf(st, earlier)} bought ${earlier.buyDate}) is older than this date. Move the start date back.`);
  // review fix 2026-11-09: deposits, withdrawals and dividends count from the start date too
  const fl = st.capital.flows.find((f) => f.date < date); if (fl) return err(`A ${fl.type} (${fl.date.split('-').reverse().join('-')}) is older than this date. Move the start date back.`);
  const dv = st.dividends.find((x) => x.payDate < date); if (dv) return err(`A dividend (${dv.payDate.split('-').reverse().join('-')}) is older than this date. Move the start date back.`);
  st.capital.start = { amount: S(a), date, seq: st.capital.start?.seq ?? nextSeq(st) };
  return ok();
}
export function addFlow(st, { date, type, amount }) {
  const a = D.parse(amount); if (a === null || a <= 0n) return err('Enter the amount as a positive number.');
  if (!['deposit', 'withdrawal'].includes(type)) return err('Choose deposit or withdrawal.');
  if (!st.capital.start) return err('Set the start capital first.');
  if (date < st.capital.start.date) return err('The date is before the start capital date.');
  // 1.5.2 (his choice: block): a withdrawal can never be more than the capital, on its own date or today
  if (type === 'withdrawal') {
    const dm = (x) => D.fmt(x, 2); const on = C.capitalBefore(st, date, Infinity), now = C.capitalNow(st);
    if (a > on) return err(`This withdrawal (${dm(a)}) is more than your capital on ${date.split('-').reverse().join('-')} (${dm(on)}). Nothing was saved.`, { overCapital: true });
    if (a > now) return err(`This withdrawal (${dm(a)}) is more than your capital today (${dm(now)}). Nothing was saved.`, { overCapital: true });
  }
  const f = { id: nextId(st, 'f'), date, type, amount: S(a), seq: nextSeq(st) }; st.capital.flows.push(f); return ok(f);
}
export function deleteFlow(st, id) {
  const i = st.capital.flows.findIndex((f) => f.id === id); if (i < 0) return err('Not found.');
  st.trash.push({ kind: 'flow', deletedAt: new Date().toISOString(), item: st.capital.flows[i] }); st.capital.flows.splice(i, 1); return ok();
}
export function addDividend(st, { stockId, payDate, amount }) {
  const a = D.parse(amount); if (a === null || a <= 0n) return err('Enter the net amount as a positive number.');
  if (!stockById(st, stockId)) return err('Choose a stock.'); if (!payDate) return err('Enter the pay date.');
  if (st.capital.start && payDate < st.capital.start.date) return err('The date is before the start capital date.'); // same rule as deposits (review fix)
  const dv = { id: nextId(st, 'd'), stockId, payDate, amount: S(a), seq: nextSeq(st) }; st.dividends.push(dv); return ok(dv);
}
export function deleteDividend(st, id) {
  const i = st.dividends.findIndex((x) => x.id === id); if (i < 0) return err('Not found.');
  st.trash.push({ kind: 'dividend', deletedAt: new Date().toISOString(), item: st.dividends[i] }); st.dividends.splice(i, 1); return ok();
}

// ---------- lists ----------
const LISTS = { stocks: 'stock', setups: 'setup', errors: 'error', rejects: 'reason' };
// 1.8.0: reject reasons are 'used' by the scan statuses that carry them
const rejectUse = (st, id) => Object.values(st.scans?.marks || {}).filter((m) => (m.reasons || []).includes(id)).length;
export function addListItem(st, list, name, extra = {}) {
  const nm = String(name ?? '').trim(); if (!nm) return err('Enter a name.');
  const key = list === 'stocks' ? 'symbol' : 'name';
  const norm = list === 'stocks' ? nm.toUpperCase() : nm;
  if (st[list].some((x) => x[key].toLowerCase() === norm.toLowerCase())) return err(`“${norm}” already exists.`);
  const it = { id: nextId(st, list[0]), [key]: norm, archived: false, ...(list === 'stocks' ? { sector: extra.sector ?? '', industry: extra.industry ?? '', exchange: extra.exchange ?? '' } : {}) };
  st[list].push(it); return ok(it);
}
export function listUsage(st, list, id) { // total references (trades + dividends), used only to decide "is this still in use"
  if (list === 'rejects') return rejectUse(st, id);
  const f = list === 'stocks' ? 'stockId' : list === 'setups' ? 'setupId' : 'errorId';
  return st.trades.filter((t) => t[f] === id).length + (list === 'stocks' ? st.dividends.filter((d) => d.stockId === id).length : 0);
}
// #14: trades and dividends counted separately, so the "Trades" column and the delete warning say exactly
// what they mean, instead of one number that silently mixes two different kinds of entry.
export function listUsageDetail(st, list, id) {
  if (list === 'rejects') return { trades: 0, dividends: 0, stocks: rejectUse(st, id) };
  const f = list === 'stocks' ? 'stockId' : list === 'setups' ? 'setupId' : 'errorId';
  const trades = st.trades.filter((t) => t[f] === id).length;
  const dividends = list === 'stocks' ? st.dividends.filter((d) => d.stockId === id).length : 0;
  return { trades, dividends };
}
export function renameListItem(st, list, id, newName, { merge = false } = {}) {
  const key = list === 'stocks' ? 'symbol' : 'name';
  const it = st[list].find((x) => x.id === id); if (!it) return err('Not found.');
  const nm = list === 'stocks' ? String(newName).trim().toUpperCase() : String(newName).trim(); if (!nm) return err('Enter a name.');
  const other = st[list].find((x) => x.id !== id && x[key].toLowerCase() === nm.toLowerCase());
  if (other && !merge) return err('exists', { exists: other });
  if (other && merge) { // move all links to the existing item in one step, then remove the old one
    if (list === 'rejects') { for (const m of Object.values(st.scans?.marks || {})) if ((m.reasons || []).includes(id)) m.reasons = [...new Set(m.reasons.map((x) => (x === id ? other.id : x)))]; st[list] = st[list].filter((x) => x.id !== id); return ok({ merged: other }); }
    const f = list === 'stocks' ? 'stockId' : list === 'setups' ? 'setupId' : 'errorId';
    for (const t of st.trades) if (t[f] === id) t[f] = other.id;
    if (list === 'stocks') for (const d of st.dividends) if (d.stockId === id) d.stockId = other.id;
    st[list] = st[list].filter((x) => x.id !== id); return ok({ merged: other });
  }
  it[key] = nm; return ok(it);
}
export function archiveListItem(st, list, id, archived = true) {
  const it = st[list].find((x) => x.id === id); if (!it) return err('Not found.');
  if (archived && list === 'stocks') {
    const open = st.trades.find((t) => t.stockId === id && C.openQty(t) > 0n);
    if (open) return err(`${it.symbol} still has an open position. Close it first, then archive.`, { blocked: true });
  }
  it.archived = archived; return ok(it);
}
export function deleteListItem(st, list, id) {
  const it = st[list].find((x) => x.id === id); if (!it) return err('Not found.');
  if (listUsage(st, list, id) > 0) return err('Trades use this item. Archive it instead.');
  st.trash.push({ kind: list, deletedAt: new Date().toISOString(), item: it }); st[list] = st[list].filter((x) => x.id !== id); return ok();
}
export function updateStock(st, id, patch) { const s = stockById(st, id); if (!s) return err('Not found.'); Object.assign(s, { sector: patch.sector ?? s.sector, industry: patch.industry ?? s.industry, exchange: patch.exchange ?? s.exchange }); return ok(s); }

// ---------- open a trade ----------
export function validateOpen(st, f) {
  const errors = [], warnings = [];
  const q = D.parse(f.qty), bp = D.parse(f.buyPrice), is = need(f.initialStop) ? D.parse(f.initialStop) : null, bc = need(f.buyCommission) ? D.parse(f.buyCommission) : null;
  if (!need(f.symbol)) errors.push('Enter the symbol.');
  if (!f.buyDate) errors.push('Enter a valid buy date (dd-mm-yyyy).');
  if (q === null || q <= 0n) errors.push('Quantity must be a number above 0.');
  if (bp === null || bp <= 0n) errors.push('Buy price must be a number above 0.');
  if (need(f.initialStop) && is === null) errors.push('Initial stop must be a number.');
  if (is !== null && bp !== null && is >= bp) errors.push('Initial stop must be below the buy price.');
  if (need(f.buyCommission) && bc === null) errors.push('Buy commission must be a number.');
  // review fix 2026-11-09: the same rule as when you edit them later — a number above 0, or empty
  for (const [k, name] of [['currentStop', 'Current stop'], ['last', 'Last price'], ['highest', 'Highest price'], ['ema10', 'EMA10']]) if (need(f[k])) { const p = D.parse(f[k]); if (p === null) errors.push(`${name} must be a number.`); else if (p <= 0n) errors.push(`${name} must be above 0.`); }
  if (normStars(f.stars) === undefined) errors.push('Stars must be 1, 2, 3, 4 or 5.');
  if (!st.capital.start) errors.push('Capital is not set. Set the start capital first.');
  else if (f.buyDate && f.buyDate < st.capital.start.date) errors.push(`Your start capital date is ${st.capital.start.date.split('-').reverse().join('-')}, but the buy date is earlier. Change the buy date or the start date.`);
  if (!need(f.initialStop)) warnings.push('No Initial stop: the line is “No SL” and stays out of R statistics.');
  if (!need(f.buyCommission)) warnings.push('Buy commission is empty: the result is calculated without it.');
  return { errors, warnings };
}
export function openTrade(st, f) {
  const v = validateOpen(st, f); if (v.errors.length) return err(v.errors[0], { errors: v.errors });
  let stock = findStock(st, f.symbol);
  if (!stock) { const r = addListItem(st, 'stocks', f.symbol, f.stockInfo ?? {}); stock = r.data; }
  else if (f.stockInfo) for (const k of ['sector', 'industry', 'exchange']) { const v = (f.stockInfo[k] || '').trim(); if (v && !(stock[k] || '').trim()) stock[k] = v; } // fills only what is missing (2026-11-09)
  if (stock.archived) stock.archived = false;
  const seq = nextSeq(st);
  const t = {
    id: nextTradeId(st), seq, stockId: stock.id, buyDate: f.buyDate, qty: S(D.d(f.qty)), buyPrice: S(D.d(f.buyPrice)),
    buyCommission: need(f.buyCommission) ? S(D.d(f.buyCommission)) : '', initialStop: need(f.initialStop) ? S(D.d(f.initialStop)) : '',
    currentStop: need(f.currentStop) ? S(D.d(f.currentStop)) : (need(f.initialStop) ? S(D.d(f.initialStop)) : ''),
    last: need(f.last) ? S(D.d(f.last)) : S(D.d(f.buyPrice)), highest: need(f.highest) ? S(D.d(f.highest)) : S(D.d(f.buyPrice)),
    ema10: need(f.ema10) ? S(D.d(f.ema10)) : '', nextReport: f.nextReport || '', setupId: f.setupId || null, stars: null, errorId: f.errorId || null, comment: f.comment || '',
    direction: 'Long', capitalAtOpen: '', sales: [],
  };
  if (canRate(st, t.setupId)) t.stars = normStars(f.stars);
  t.capitalAtOpen = S(C.capitalBefore(st, t.buyDate, seq));
  const held = sameStockOpen(st, t);
  st.trades.push(t); log(st, { type: 'open', tradeId: t.id });
  // the buy itself is the newest price: the new line's last price (its buy price, or a typed one) goes to all lines
  if (held.length) joinShared(t, held, { last: true, ema10: need(f.ema10), nextReport: !!f.nextReport });
  return ok(t);
}
// A trade that (re)joins a stock already held: it takes the shared last price, EMA10 and next report
// (a value typed in that same step wins and goes to all), and the higher highest price is used for all.
function joinShared(t, held, typed = {}) {
  const all = [...held, t];
  for (const f of ['last', 'ema10', 'nextReport']) { const v = typed[f] ? t[f] : held[0][f]; for (const x of all) x[f] = v; }
  const hi = maxHighest(all); if (hi !== null) for (const x of all) x.highest = S(hi);
}

// ---------- daily edits (saved at once, Undo for the last one) ----------
const NUM_FIELDS = new Set(['last', 'highest', 'ema10', 'currentStop']);
export function editDaily(st, id, field, raw) {
  const t = tradeById(st, id); if (!t) return err('Not found.');
  if (!['last', 'highest', 'ema10', 'currentStop', 'nextReport', 'comment', 'setupId', 'errorId', 'stars'].includes(field)) return err('This value cannot be edited here.');
  if (field === 'stars') return setTradeStars(st, t, raw);
  if (field === 'setupId') { setTradeSetup(t, raw); return ok(t); }
  let val = raw;
  if (NUM_FIELDS.has(field)) {
    if (!need(raw)) val = '';
    else { const p = D.parse(raw); if (p === null) return err('Enter a number.'); if (p <= 0n) return err('The value must be above 0.'); val = S(p); }
  }
  if (field === 'nextReport') val = raw || '';
  if (field === 'currentStop' && val !== t.currentStop) {
    // every change goes to the stop history, also emptying the stop (C7)
    st.stopHistory.push({ ts: new Date().toISOString(), tradeId: t.id, old: t.currentStop, new: val });
  }
  if (SHARED.includes(field) && C.openQty(t) > 0n) {
    const group = sameStockOpen(st, t);
    if (field === 'highest' && val !== '') {
      // strictly highest wins (2026-11-06): a lower value only through "Correct highest price".
      // Clearing it (val === '') is not "lower": it must work, like every other field (#11).
      const cur = maxHighest(group);
      const p = D.parse(val);
      if (cur !== null && p < cur) return err(`The highest price can only go up (now ${D.fmt(cur, 2)}). Use “Correct highest price” to set a lower value.`, { lower: true });
    }
    for (const x of group) x[field] = val;
    return ok(t);
  }
  t[field] = val; return ok(t);
}

// ---------- same stock, several open trades: shared daily values (2026-11-06) ----------
// Last price, highest price, EMA10 and next report belong to the stock: every open trade of that stock shows the same.
// Closed trades are not part of it. Highest price: strictly the highest wins.
export const SHARED = ['last', 'highest', 'ema10', 'nextReport'];
export const sameStockOpen = (st, t) => st.trades.filter((x) => x.stockId === t.stockId && C.openQty(x) > 0n);
function maxHighest(trades) { let m = null; for (const x of trades) { const p = D.parse(x.highest); if (p !== null && (m === null || p > m)) m = p; } return m; }
// Lower the highest price on purpose (only way to go down); applies to every open trade of the stock and is logged.
export function correctHighest(st, id, raw) {
  const t = tradeById(st, id); if (!t) return err('Not found.');
  const p = D.parse(raw); if (p === null || p <= 0n) return err('Enter a number above 0.');
  for (const x of C.openQty(t) > 0n ? sameStockOpen(st, t) : [t]) {
    if (x.highest !== S(p)) log(st, { type: 'highest', tradeId: x.id, old: x.highest, new: S(p) });
    x.highest = S(p);
  }
  return ok(t);
}
// Where open trades of the same stock differ. Highest is never a question (the higher value is used);
// last price, EMA10 and next report: the program cannot know which is newer, so it asks him.
export function sharedDiffs(st) {
  const out = []; const seen = new Set();
  for (const t of st.trades) {
    if (seen.has(t.stockId) || C.openQty(t) <= 0n) continue; seen.add(t.stockId);
    const group = sameStockOpen(st, t); if (group.length < 2) continue;
    const fields = [];
    for (const f of ['last', 'ema10', 'nextReport']) {
      const vals = [...new Set(group.map((x) => x[f] ?? ''))];
      if (vals.length > 1) fields.push({ field: f, options: vals.map((v) => ({ value: v, trades: group.filter((x) => (x[f] ?? '') === v).map((x) => x.id) })) });
    }
    const hiVals = new Set(group.map((x) => x.highest ?? ''));
    const hi = hiVals.size > 1 ? maxHighest(group) : null;
    if (fields.length || hi !== null) out.push({ stockId: t.stockId, symbol: symbolOf(st, t), trades: group.map((x) => x.id), fields, highest: hi === null ? null : S(hi) });
  }
  return out;
}
// Apply: the higher highest price everywhere, and his choices ({ [stockId]: { last: v, ema10: v, nextReport: v } }).
// Fields without a choice stay as they are (asked again next time).
export function alignShared(st, choices = {}) {
  for (const g of sharedDiffs(st)) {
    const group = g.trades.map((id) => tradeById(st, id));
    if (g.highest !== null) for (const x of group) x.highest = g.highest;
    const ch = choices[g.stockId] || {};
    for (const f of ['last', 'ema10', 'nextReport']) if (ch[f] !== undefined) for (const x of group) x[f] = ch[f];
  }
  return ok();
}
export function jumpPct(oldV, newV) { const o = D.parse(oldV), n2 = D.parse(newV); if (o === null || n2 === null || o === 0n) return null; return D.abs(D.pct(D.sub(n2, o), o)); }

// ---------- buy data edits (pop-up with before -> after is shown by the screen) ----------
export function editBuyData(st, id, patch) {
  const t = tradeById(st, id); if (!t) return err('Not found.');
  const nt = { ...t };
  for (const k of ['qty', 'buyPrice', 'buyCommission']) if (patch[k] !== undefined) { const p = D.parse(patch[k]); if (k !== 'buyCommission' && (p === null || p <= 0n)) return err('Enter a number above 0.'); if (k === 'buyCommission' && patch[k] !== '' && p === null) return err('Enter a number.'); nt[k] = patch[k] === '' ? '' : S(p); }
  if (patch.buyDate !== undefined) { if (!patch.buyDate) return err('Enter a valid date.'); nt.buyDate = patch.buyDate; }
  const probs = C.quantityProblems(nt);
  if (probs.length) return err(`${symbolOf(st, t)}: ${S(D.d(nt.qty))} is less than the ${S(probs[0].sold)} shares already sold. Nothing was changed.`, { quantity: probs[0] });
  const is = D.parse(nt.initialStop);
  if (is !== null && is >= D.d(nt.buyPrice)) return err('Initial stop must be below the buy price. Correct the Initial stop first.');
  if (st.capital.start && nt.buyDate < st.capital.start.date) return err('The buy date is before the start capital date.');
  // 1.5.1 fix: a trade cannot be bought after it was sold
  const early = t.sales.filter((x) => x.date < nt.buyDate).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  if (early) return err(`${symbolOf(st, t)} ${t.id} has a sale on ${early.date.split('-').reverse().join('-')}. The buy date cannot be later than that. Nothing was changed.`);
  for (const k of ['qty', 'buyPrice', 'buyCommission', 'buyDate']) if (t[k] !== nt[k]) { log(st, { type: 'edit', tradeId: t.id, field: k, old: t[k], new: nt[k] }); t[k] = nt[k]; }
  t.capitalAtOpen = S(C.capitalBefore(st, t.buyDate, t.seq)); // this trade only (the dialog shows it); other trades are asked about (D2)
  return ok(t);
}
export function correctInitialStop(st, id, raw) {
  const t = tradeById(st, id); if (!t) return err('Not found.');
  const p = D.parse(raw); if (p === null || p <= 0n) return err('Enter a number above 0.');
  if (p >= D.d(t.buyPrice)) return err('Initial stop must be below the buy price.');
  log(st, { type: 'initialStop', tradeId: t.id, old: t.initialStop, new: S(p) }); t.initialStop = S(p); return ok(t);
}

// ---------- close (sell) ----------
// allocations: [{ tradeId, qty }]. Sell commission is split by shares sold, remainder on the last line.
export function closeSale(st, { date, price, commission, allocations }) {
  const pr = D.parse(price); if (pr === null || pr <= 0n) return err('Sell price must be a number above 0.');
  if (!date) return err('Enter a valid sell date.');
  const cm = need(commission) ? D.parse(commission) : null; if (need(commission) && cm === null) return err('Sell commission must be a number.');
  const al = allocations.map((a) => ({ ...a, q: D.parse(a.qty) })).filter((a) => a.q !== null && a.q > 0n);
  if (!al.length) return err('Assign the shares to at least one line.');
  for (const a of al) {
    const t = tradeById(st, a.tradeId); if (!t) return err('Line not found.');
    if (a.q > C.openQty(t)) return err(`${symbolOf(st, t)} ${t.id}: you assigned more shares than are open (${S(C.openQty(t))}).`);
    if (date < t.buyDate) return err(`The sell date is before the buy date of ${t.id}.`);
  }
  const parts = cm === null ? al.map(() => null) : D.split(cm, al.map((a) => a.q));
  const created = al.map((a, i) => {
    const t = tradeById(st, a.tradeId);
    const s = { id: nextId(st, 's'), seq: nextSeq(st), date, qty: S(a.q), price: S(pr), commission: parts[i] === null ? '' : S(parts[i]) };
    t.sales.push(s); return { tradeId: t.id, sale: s };
  });
  log(st, { type: 'sale', trades: created.map((c) => c.tradeId) });
  return ok(created);
}
export function editSale(st, tradeId, saleId, patch) {
  const t = tradeById(st, tradeId); const s = t?.sales.find((x) => x.id === saleId); if (!s) return err('Not found.');
  const ns = { ...s };
  if (patch.date !== undefined) { if (!patch.date) return err('Enter a valid date.'); if (patch.date < t.buyDate) return err('The sell date is before the buy date.'); ns.date = patch.date; }
  if (patch.price !== undefined) { const p = D.parse(patch.price); if (p === null || p <= 0n) return err('Sell price must be above 0.'); ns.price = S(p); }
  if (patch.commission !== undefined) { const p = D.parse(patch.commission); if (patch.commission !== '' && p === null) return err('Enter a number.'); ns.commission = patch.commission === '' ? '' : S(p); }
  if (patch.qty !== undefined) { const p = D.parse(patch.qty); if (p === null || p <= 0n) return err('Quantity must be above 0.'); ns.qty = S(p); }
  const trial = { ...t, sales: t.sales.map((x) => (x.id === saleId ? ns : x)) };
  const probs = C.quantityProblems(trial);
  if (probs.length) return err(`Sold (${S(probs[0].sold)}) would be more than bought (${S(probs[0].bought)}). Nothing was changed.`, { quantity: probs[0] });
  for (const k of ['date', 'price', 'commission', 'qty']) if (s[k] !== ns[k]) { log(st, { type: 'editSale', tradeId, saleId, field: k, old: s[k], new: ns[k] }); s[k] = ns[k]; }
  return ok(s);
}
export function reopenSales(st, tradeId, saleIds) {
  const t = tradeById(st, tradeId); if (!t) return err('Not found.'); if (!saleIds.length) return err('Tick at least one sale.');
  const rm = t.sales.filter((s) => saleIds.includes(s.id));
  st.trash.push({ kind: 'sales', deletedAt: new Date().toISOString(), item: { tradeId, sales: rm } });
  const wasOpen = C.openQty(t) > 0n;
  t.sales = t.sales.filter((s) => !saleIds.includes(s.id)); log(st, { type: 'reopen', tradeId, sales: saleIds });
  if (!wasOpen) { const held = sameStockOpen(st, t).filter((x) => x !== t); if (held.length) joinShared(t, held); }
  return ok(t);
}
export function deleteTrade(st, id) {
  const i = st.trades.findIndex((t) => t.id === id); if (i < 0) return err('Not found.');
  st.trash.push({ kind: 'trade', deletedAt: new Date().toISOString(), item: st.trades[i] }); st.trades.splice(i, 1); log(st, { type: 'delete', tradeId: id }); return ok();
}
export function restoreFromTrash(st, index) {
  const e = st.trash[index]; if (!e) return err('Not found.');
  const back = { trade: () => st.trades.push(e.item), dividend: () => st.dividends.push(e.item), flow: () => st.capital.flows.push(e.item), rejects: () => st.rejects.push(e.item), scanRun: () => { st.scans ??= { runs: [], marks: {}, showCols: null }; st.scans.runs.push(e.item); }, scanCompare: () => { const sc = scansOf(st); sc.compares ??= []; if (sc.compares.some((c) => same(c.name, e.item.name))) return false; sc.compares.push(e.item); }, scanner: () => { const sc = scansOf(st); if (sc.runs.some((r) => r.scanner === e.item.scanner)) return false; sc.runs.push(...e.item.runs); }, scanList: () => { const sc = scansOf(st); if (sc.lists.some((l) => same(l.name, e.item.name))) return false; if (e.item.folder && !sc.folders.some((f) => f.id === e.item.folder)) e.item.folder = null; sc.lists.push(e.item); }, scanFolder: () => { const sc = scansOf(st); if (sc.folders.some((f) => same(f.name, e.item.folder.name)) || e.item.lists.some((l) => sc.lists.some((x) => same(x.name, l.name)))) return false; sc.folders.push(e.item.folder); sc.lists.push(...e.item.lists); }, stocks: () => st.stocks.push(e.item), setups: () => st.setups.push(e.item), errors: () => st.errors.push(e.item), sales: () => { const t = tradeById(st, e.item.tradeId); if (!t) return false; t.sales.push(...e.item.sales); } };
  if (!back[e.kind]) return err('This item cannot be restored.');
  // review fix 2026-11-09: the same checks as everywhere else, before anything comes back
  const nameKey = { stocks: 'symbol', setups: 'name', errors: 'name', rejects: 'name' }[e.kind];
  if (nameKey && st[e.kind].some((x) => String(x[nameKey]).toUpperCase() === String(e.item[nameKey]).toUpperCase())) return err(`“${e.item[nameKey]}” is already in the list again, so the deleted one cannot come back.`);
  if ((e.kind === 'trade' || e.kind === 'dividend') && !st.stocks.some((x) => x.id === e.item.stockId)) return err('Its stock was deleted from the list. Restore the stock first.');
  if (e.kind === 'trade' && st.trades.some((x) => x.id === e.item.id)) return err('A trade with the same ID exists.');
  if (e.kind === 'sales') { const t = tradeById(st, e.item.tradeId); if (t && C.quantityProblems({ ...t, sales: [...t.sales, ...e.item.sales] }).length) return err(`${symbolOf(st, t)} ${t.id}: the restored sales would sell more shares than were bought. Nothing was restored.`); }
  if (e.kind === 'trade' && C.quantityProblems(e.item).length) return err('This trade sells more shares than it bought. Nothing was restored.');
  if (back[e.kind]() === false) return err(['scanner', 'scanList', 'scanFolder', 'scanCompare'].includes(e.kind) ? 'Something with the same name exists again, so it cannot come back. Rename that first.' : 'The trade of these sales no longer exists.');
  st.trash.splice(index, 1); return ok();
}
// After 15 days the Trash is emptied for good. A deleted trade is then gone everywhere (2026-11-06): its lines in the
// change log and stop history are removed too. Returns an error when there is nothing to empty (so nothing is saved).
export function purgeTrash(st, now = Date.now(), days = 15) {
  const old = st.trash.filter((e) => now - Date.parse(e.deletedAt) >= days * 86400000); if (!old.length) return err('Nothing to empty.');
  const gone = new Set(old.filter((e) => e.kind === 'trade').map((e) => e.item.id));
  st.trash = st.trash.filter((e) => !old.includes(e));
  if (gone.size) {
    st.changeLog = st.changeLog.filter((e) => !gone.has(e.tradeId) && !(e.trades || []).some((id) => gone.has(id)));
    st.stopHistory = st.stopHistory.filter((e) => !gone.has(e.tradeId));
  }
  return ok({ removed: old.length });
}

// ---------- capital at open: preview and recalculation (D2) ----------
export function capitalDiffs(st) {
  const at = C.capitalLookup(st); const out = [];
  for (const t of st.trades) { const c = at(t.buyDate, t.seq); if (S(c) !== t.capitalAtOpen) out.push({ id: t.id, symbol: symbolOf(st, t), before: t.capitalAtOpen, after: S(c) }); }
  return out;
}
export function recalcCapital(st) { const at = C.capitalLookup(st); for (const t of st.trades) t.capitalAtOpen = S(at(t.buyDate, t.seq)); return ok(); }

// ---------- split (D5) ----------
export function splitPreview(st, stockId, ratioNew, ratioOld, date) {
  const rn = D.parse(ratioNew), ro = D.parse(ratioOld); if (rn === null || ro === null || rn <= 0n || ro <= 0n) return err('Enter the ratio as two numbers above 0.');
  // review fix 2026-11-09: shares × new ÷ old and price × old ÷ new, each rounded once (a 1:3 reverse split of 300 gives exactly 100)
  const f = D.div(rn, ro); const rows = []; const skipped = []; const sq = (q) => D.div(D.mul(q, rn), ro), sp = (p) => D.div(D.mul(p, ro), rn);
  for (const t of st.trades.filter((x) => x.stockId === stockId)) {
    const open = C.openQty(t) > 0n; if (!open) continue; // trades fully closed before the split stay untouched
    // 1.5.1 fix: a line bought on or after the split date was already bought at the new price, so it is never converted
    if (date && t.buyDate >= date) { skipped.push(t); continue; }
    rows.push({ trade: t, qtyBefore: D.d(t.qty), qtyAfter: sq(D.d(t.qty)), priceBefore: D.d(t.buyPrice), priceAfter: sp(D.d(t.buyPrice)) });
  }
  return ok({ factor: f, rows, skipped, sq, sp });
}
export function applySplit(st, stockId, ratioNew, ratioOld, date) {
  const p = splitPreview(st, stockId, ratioNew, ratioOld, date); if (!p.ok) return p;
  const { sq, sp } = p.data; const conv = (v) => (v === '' || v === null || v === undefined ? v : S(sp(D.d(v))));
  for (const { trade: t } of p.data.rows) {
    t.qty = S(sq(D.d(t.qty))); t.buyPrice = conv(t.buyPrice); t.initialStop = conv(t.initialStop); t.currentStop = conv(t.currentStop);
    // last price, highest and EMA10 are shared with every open line of the stock. When a line bought after the split is
    // open too, these values are already at the new price (it was bought at it), so they stay as they are.
    if (!p.data.skipped.length) { t.last = conv(t.last); t.highest = conv(t.highest); t.ema10 = conv(t.ema10); }
    for (const s of t.sales) { s.qty = S(sq(D.d(s.qty))); s.price = conv(s.price); } // sold parts of the same trade convert too, so totals add up
  }
  st.splits.push({ id: nextId(st, 'p'), stockId, date, ratio: `${S(D.d(ratioNew))}:${S(D.d(ratioOld))}`, trades: p.data.rows.map((r) => r.trade.id) }); log(st, { type: 'split', stockId });
  return ok(p.data);
}

// ---------- settings ----------
export function setSetting(st, key, value) { st.settings[key] = value; return ok(); }
// the risk % typed in the share calculator is remembered for the next trade (a number above 0, at most 100)
export function rememberCalcRisk(st, raw) { const p = D.parse(raw); if (p === null || p <= 0n || p > D.d('100')) return err('Not a valid risk %.'); st.settings.calcRiskPct = S(p); return ok(); }

// 1.5.5: the highest price of a CLOSED trade, typed later in History so "how much of the move did I keep" can be shown.
// It must make sense: not below the buy price and not below a price he sold at. Empty clears it. Logged like other corrections.
export function setClosedHighest(st, id, raw) {
  const t = tradeById(st, id); if (!t) return err('Trade not found.');
  if (C.openQty(t) > 0n) return err('This trade is still open: change its highest price on Open positions.');
  let val = '';
  if (need(raw)) {
    const p = D.parse(raw); if (p === null || p <= 0n) return err('Enter a number above 0.');
    const buy = D.d(t.buyPrice); let maxSale = 0n; for (const x of t.sales) { const q = D.d(x.price); if (q > maxSale) maxSale = q; }
    if (p < buy) return err(`The highest price cannot be below your buy price (${D.fmt(buy, 2)}).`);
    if (p < maxSale) return err(`The highest price cannot be below a price you sold at (${D.fmt(maxSale, 2)}).`);
    val = S(p);
  }
  if (t.highest !== val) log(st, { type: 'highest', tradeId: t.id, old: t.highest, new: val });
  t.highest = val; return ok(t);
}

// ---------- "On Open positions" ticks on the Dashboard number cards (max 4) ----------
export function toggleOpenCard(st, key) {
  if (!C.OPEN_CARD_KEYS.includes(key)) return { ok: false, error: 'Unknown card.' };
  const cur = C.openCards(st);
  let next;
  if (cur.includes(key)) next = cur.filter((k) => k !== key);
  else { if (cur.length >= C.OPEN_CARD_MAX) return { ok: false, error: `Max ${C.OPEN_CARD_MAX} — untick one first` }; next = [...cur, key]; } // a new card goes last
  st.layouts ??= {}; st.layouts.dashboard = { ...(st.layouts.dashboard || {}), onOpen: next };
  return ok(next);
}
// his own order on Open positions: only the ticked cards, each once; anything else is refused (nothing is added or lost by dragging)
export function orderOpenCards(st, ids) {
  const cur = C.openCards(st);
  if (!Array.isArray(ids) || ids.length !== cur.length || new Set(ids).size !== ids.length || !ids.every((k) => cur.includes(k))) return { ok: false, error: 'The order does not match the cards shown.' };
  st.layouts ??= {}; st.layouts.dashboard = { ...(st.layouts.dashboard || {}), onOpen: [...ids] };
  return ok(ids);
}

// ===================================================================== Reports and placement (plan step 3, 1.7.0)
// Placement: what each screen shows, in order (calc.js placement). Every change writes the whole list of that screen,
// so nothing else can be lost. A number card only stands among cards, a block or report only among blocks.
function writePlace(st, screen, p) { st.layouts ??= {}; st.layouts.place = { ...(st.layouts.place || {}) }; st.layouts.place[screen] = { cards: [...p.cards], blocks: [...p.blocks] }; }
const kindOf = (st, id) => (C.isReportId(id) ? 'block' : C.BUILTIN_BY_ID[id]?.kind);
export function setShown(st, screen, id, on) {
  if (!C.SCREENS.includes(screen)) return err('Unknown screen.');
  const kind = kindOf(st, id); if (!kind || !C.placeable(st, id, kind) || (screen === 'history' && kind === 'card')) return err('This cannot be shown there.');
  const p = C.placement(st, screen); const list = kind === 'card' ? p.cards : p.blocks;
  if (on) { if (list.includes(id)) return ok(p); const max = kind === 'card' ? C.PLACE_CARD_MAX[screen] : null; if (max && list.length >= max) return err(`Max ${max} number cards on ${C.SCREEN_NAME[screen]} — switch one off first.`); list.push(id); }
  else { const i = list.indexOf(id); if (i < 0) return ok(p); list.splice(i, 1); }
  writePlace(st, screen, p); return ok(p);
}
// swap: the new one takes the old one's place; if the new one is already shown there, the two change places
export function swapShown(st, screen, oldId, newId) {
  const p = C.placement(st, screen); const kind = kindOf(st, oldId);
  if (!kind || kind !== kindOf(st, newId) || !C.placeable(st, newId, kind)) return err(kind === 'card' ? 'A number card can only be swapped for another number card.' : 'This cannot be swapped here.');
  const list = kind === 'card' ? p.cards : p.blocks; const i = list.indexOf(oldId); if (i < 0) return err('That block is not on this screen.');
  const j = list.indexOf(newId); if (j >= 0) list[j] = oldId; list[i] = newId;
  writePlace(st, screen, p); return ok(p);
}
export function orderShown(st, screen, kind, ids) {
  const p = C.placement(st, screen); const cur = kind === 'card' ? p.cards : p.blocks;
  if (!Array.isArray(ids) || ids.length !== cur.length || new Set(ids).size !== ids.length || !ids.every((x) => cur.includes(x))) return err('The order does not match what is shown.');
  if (kind === 'card') p.cards = [...ids]; else p.blocks = [...ids];
  writePlace(st, screen, p); return ok(p);
}
export function resetShownOrder(st, screen) { const p = C.placement(st, screen); writePlace(st, screen, { cards: C.standardOrder(p.cards, screen), blocks: C.standardOrder(p.blocks, screen) }); return ok(true); }

// Reports: { id, name, g1, g2, measures: [...], chart: 'bar'|'line', filters: {...History filter choices} }
export const REPORT_GROUPS = ['month', 'year', 'setup', 'rating', 'mistake', 'sector', 'industry', 'exchange', 'stock', 'label', 'sd', 'days', 'how', 'kept', 'stopdn'];
export const REPORT_MEASURES = ['trades', 'wins', 'losses', 'winRate', 'be', 'net', 'capPct', 'avgR', 'winR', 'lossR', 'ratio', 'days', 'best', 'worst', 'sales'];
export { exampleReports } from './model.js';
function cleanReport(r) {
  const name = String(r.name ?? '').trim(); if (!name) return err('Give the report a name.');
  if (!REPORT_GROUPS.includes(r.g1)) return err('Choose what to group by.');
  if (r.g2 && (!REPORT_GROUPS.includes(r.g2) || r.g2 === r.g1)) return err('"Then by" must be different from "Group by".');
  const measures = [...new Set(r.measures || [])].filter((m) => REPORT_MEASURES.includes(m)); if (!measures.length) return err('Tick at least one measure.');
  return ok({ name: name.slice(0, 80), g1: r.g1, g2: r.g2 || '', measures, chart: r.chart === 'line' ? 'line' : 'bar', filters: structuredClone(r.filters || {}) });
}
export function saveReport(st, r) {
  const c = cleanReport(r); if (!c.ok) return c;
  st.reports ??= [];
  if (r.id) { const cur = st.reports.find((x) => x.id === r.id); if (!cur) return err('Report not found.'); Object.assign(cur, c.data); return ok(cur); }
  const n = Math.max(0, ...st.reports.map((x) => Number(String(x.id).replace(/\D/g, '')) || 0)) + 1;
  const it = { id: 'RP-' + n, ...c.data }; st.reports.push(it); return ok(it);
}
export function copyReport(st, id) {
  const cur = (st.reports || []).find((x) => x.id === id); if (!cur) return err('Report not found.');
  return saveReport(st, { ...structuredClone(cur), id: null, name: (cur.name + ' (copy)').slice(0, 80) });
}
// deleting a report also takes it off every screen (Undo brings both back)
export function deleteReport(st, id) {
  const i = (st.reports || []).findIndex((x) => x.id === id); if (i < 0) return err('Report not found.');
  for (const s of C.SCREENS) { const p = C.placement(st, s); if (p.blocks.includes('r:' + id)) { p.blocks = p.blocks.filter((x) => x !== 'r:' + id); writePlace(st, s, p); } }
  st.reports.splice(i, 1); return ok(true);
}
// 1.7.1 (his wish): the order of the rows in Reports → Screens. Only that page's list; never the order on the screens.
export function orderReportsList(st, screen, ids) {
  if (!C.SCREENS.includes(screen) || !Array.isArray(ids) || new Set(ids).size !== ids.length) return err('Unknown list.');
  st.layouts ??= {}; st.layouts.reportsList = { ...(st.layouts.reportsList || {}), [screen]: [...ids] }; return ok(ids);
}


// ---------- 1.8.0 Scans ----------
// One scan run = one paste from the TJ Collect bookmark (or plain tickers). Runs are kept per scanner and date.
// mode 'replace' removes today's earlier run of the same scanner first (he chose to be asked when that happens).
export function addScanRun(st, { scanner, date, cols = [], rows, shown = null, fv = null }, { replace = false, today = date } = {}) {
  const name = String(scanner ?? '').trim(); if (!name) return err('Give the scanner a name.');
  if (name.length > 60) return err('The scanner name is too long (60 characters at most).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return err('The scan date is not valid.');
  const good = (rows || []).filter((r) => SC.validSymbol(r.s)); if (!good.length) return err('There are no stocks in this scan.');
  st.scans ??= { runs: [], marks: {}, showCols: null };
  if (replace) st.scans.runs = st.scans.runs.filter((r) => !(r.scanner === name && r.date === date));
  const run = { id: nextId(st, 'sr'), scanner: name, date, seq: nextSeq(st), cols: cols.slice(0, 60), rows: good.map((r) => ({ s: r.s.toUpperCase(), v: (r.v || []).slice(0, cols.length) })), shown: shown || null, trimmed: false };
  if (fv) { run.source = 'finviz'; run.fvKey = fv.key; run.fvPages = [fv.page]; }
  st.scans.runs.push(run);
  const trimmed = SC.trimOld(st, today, Number(st.settings.scanKeepDays) || 90);
  return ok({ run, trimmed });
}
export const scanRunExists = (st, scanner, date) => (st.scans?.runs || []).some((r) => r.scanner === String(scanner).trim() && r.date === date);
export function deleteScanRun(st, id) {
  const i = (st.scans?.runs || []).findIndex((r) => r.id === id); if (i < 0) return err('Not found.');
  st.trash.push({ kind: 'scanRun', deletedAt: new Date().toISOString(), item: st.scans.runs[i] }); st.scans.runs.splice(i, 1); return ok();
}
// status per stock (ticker without exchange), kept across scans
export function setScanMark(st, ticker, { status, reasons = [], other = '', date }) {
  const t = SC.tickerOf(ticker); if (!t) return err('No stock.');
  if (!['watch', 'near', 'rej'].includes(status)) return err('Unknown status.');
  const known = new Set((st.rejects || []).map((r) => r.id));
  const m = { st: status, date, reasons: status === 'rej' ? [...new Set(reasons)].filter((r) => known.has(r)) : [], other: status === 'rej' ? String(other || '').trim().slice(0, 120) : '' };
  st.scans ??= { runs: [], marks: {}, showCols: null }; st.scans.marks[t] = m; return ok(m);
}
// 1.8.0: "Not decided" in the status menu takes the status back (the stock shows as New again)
export function clearScanMark(st, ticker) { const t = SC.tickerOf(ticker); if (!st.scans?.marks?.[t]) return err('This stock has no status.'); delete st.scans.marks[t]; return ok(); }
export function setScanCols(st, cols) { st.scans ??= { runs: [], marks: {}, showCols: null }; st.scans.showCols = cols.slice(0, 12); return ok(); }

// ---------- 1.8.1 Scans: scanners, folders, lists ----------
const scansOf = (st) => { st.scans ??= { runs: [], marks: {}, showCols: null, lists: [], folders: [], fold: {} }; st.scans.lists ??= []; st.scans.folders ??= []; st.scans.fold ??= {}; return st.scans; };
const cleanName = (n, what) => { const v = String(n ?? '').trim(); if (!v) return err(`Give the ${what} a name.`); if (v.length > 60) return err(`The ${what} name is too long (60 characters at most).`); return ok(v); };
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

export function renameScanner(st, from, to) {
  const n = cleanName(to, 'scanner'); if (!n.ok) return n; const sc = scansOf(st);
  if (from === n.data) return ok();
  if (sc.runs.some((r) => r.scanner !== from && same(r.scanner, n.data))) return err(`A scanner called “${n.data}” already exists.`);
  for (const r of sc.runs) if (r.scanner === from) r.scanner = n.data;
  for (const c of sc.compares || []) c.scanners = c.scanners.map((x) => (x === from ? n.data : x));
  if (sc.fold[from] !== undefined) { sc.fold[n.data] = sc.fold[from]; delete sc.fold[from]; }
  return ok();
}
export function deleteScanner(st, name) {
  const sc = scansOf(st); const runs = sc.runs.filter((r) => r.scanner === name); if (!runs.length) return err('Not found.');
  st.trash.push({ kind: 'scanner', deletedAt: new Date().toISOString(), item: { scanner: name, runs } });
  sc.runs = sc.runs.filter((r) => r.scanner !== name); delete sc.fold[name]; return ok({ n: runs.length });
}
export function setScannerFold(st, name, folded) { const sc = scansOf(st); if (folded) sc.fold[name] = true; else delete sc.fold[name]; return ok(); }

export function addScanFolder(st, name) {
  const n = cleanName(name, 'folder'); if (!n.ok) return n; const sc = scansOf(st);
  if (sc.folders.some((f) => same(f.name, n.data))) return err(`A folder called “${n.data}” already exists.`);
  const f = { id: nextId(st, 'sf'), name: n.data }; sc.folders.push(f); return ok(f);
}
export function renameScanFolder(st, id, name) {
  const n = cleanName(name, 'folder'); if (!n.ok) return n; const sc = scansOf(st); const f = sc.folders.find((x) => x.id === id); if (!f) return err('Not found.');
  if (sc.folders.some((x) => x.id !== id && same(x.name, n.data))) return err(`A folder called “${n.data}” already exists.`);
  f.name = n.data; return ok();
}
// a folder goes to the Trash together with its lists
export function deleteScanFolder(st, id) {
  const sc = scansOf(st); const f = sc.folders.find((x) => x.id === id); if (!f) return err('Not found.');
  const lists = sc.lists.filter((l) => l.folder === id);
  st.trash.push({ kind: 'scanFolder', deletedAt: new Date().toISOString(), item: { folder: f, lists } });
  sc.folders = sc.folders.filter((x) => x.id !== id); sc.lists = sc.lists.filter((l) => l.folder !== id); return ok({ lists: lists.length });
}
export function addScanList(st, name, folder = null) {
  const n = cleanName(name, 'list'); if (!n.ok) return n; const sc = scansOf(st);
  if (folder && !sc.folders.some((f) => f.id === folder)) return err('That folder no longer exists.');
  if (sc.lists.some((l) => same(l.name, n.data))) return err(`A list called “${n.data}” already exists.`);
  const l = { id: nextId(st, 'sl'), name: n.data, folder: folder || null, items: [] }; sc.lists.push(l); return ok(l);
}
export function renameScanList(st, id, name) {
  const n = cleanName(name, 'list'); if (!n.ok) return n; const sc = scansOf(st); const l = sc.lists.find((x) => x.id === id); if (!l) return err('Not found.');
  if (sc.lists.some((x) => x.id !== id && same(x.name, n.data))) return err(`A list called “${n.data}” already exists.`);
  l.name = n.data; return ok();
}
export function moveScanList(st, id, folder) {
  const sc = scansOf(st); const l = sc.lists.find((x) => x.id === id); if (!l) return err('Not found.');
  if (folder && !sc.folders.some((f) => f.id === folder)) return err('That folder no longer exists.');
  l.folder = folder || null; return ok();
}
export function deleteScanList(st, id) {
  const sc = scansOf(st); const i = sc.lists.findIndex((x) => x.id === id); if (i < 0) return err('Not found.');
  st.trash.push({ kind: 'scanList', deletedAt: new Date().toISOString(), item: sc.lists[i] }); sc.lists.splice(i, 1); return ok();
}
// items: [{t, full}]. removeFrom: ids of other lists to take these stocks out of (his pop-up choice "Remove from …")
export function addToScanList(st, id, items, { removeFrom = [], date } = {}) {
  const sc = scansOf(st); const l = sc.lists.find((x) => x.id === id); if (!l) return err('That list no longer exists.');
  const tks = new Set(items.map((x) => SC.tickerOf(x.t))); let added = 0;
  for (const x of items) { const t = SC.tickerOf(x.t); if (l.items.some((y) => y.t === t)) continue; l.items.push({ t, full: String(x.full || t).toUpperCase(), added: date }); added++; }
  for (const o of sc.lists) if (o.id !== id && removeFrom.includes(o.id)) o.items = o.items.filter((y) => !tks.has(y.t));
  return ok({ added });
}
// all: take the stocks out of every list (his pop-up choice "From all lists")
export function removeFromScanList(st, id, tickers, { all = false } = {}) {
  const sc = scansOf(st); const tks = new Set(tickers.map(SC.tickerOf)); let n = 0;
  for (const l of sc.lists) if (all || l.id === id) { const before = l.items.length; l.items = l.items.filter((y) => !tks.has(y.t)); n += before - l.items.length; }
  return n ? ok({ n }) : err('Nothing to remove.');
}
export function moveScanItems(st, fromId, toId, tickers, { date } = {}) {
  const sc = scansOf(st); const a = sc.lists.find((x) => x.id === fromId), b = sc.lists.find((x) => x.id === toId); if (!a || !b) return err('Not found.');
  const tks = new Set(tickers.map(SC.tickerOf)); const move = a.items.filter((y) => tks.has(y.t));
  for (const x of move) if (!b.items.some((y) => y.t === x.t)) b.items.push({ ...x, added: date || x.added });
  a.items = a.items.filter((y) => !tks.has(y.t)); return ok({ n: move.length });
}
// stocks that are Rejected or bought (an open trade) since they were added; Clean up removes them (after his check)
export function staleInList(st, l) {
  const open = new Set(st.trades.filter((t) => C.openQty(t) > 0n).map((t) => (symbolOf(st, t) || '').toUpperCase()));
  return l.items.filter((x) => st.scans?.marks?.[x.t]?.st === 'rej' || open.has(x.t)).map((x) => x.t);
}
export function cleanUpScanLists(st, ids) {
  const sc = scansOf(st); let n = 0;
  for (const l of sc.lists) if (ids.includes(l.id)) { const bad = new Set(staleInList(st, l)); const b = l.items.length; l.items = l.items.filter((x) => !bad.has(x.t)); n += b - l.items.length; }
  return n ? ok({ n }) : err('Nothing to clean up.');
}

// ---------- 1.8.2 saved comparisons (by scanner; always the newest scans) and the key values under the chart ----------
export function addScanCompare(st, name, scanners) {
  const sc = scansOf(st); sc.compares ??= [];
  const list = [...new Set(scanners)]; if (list.length < 2) return err('Tick at least 2 scanners.');
  const n = cleanName(name || list.join(' + ').slice(0, 60), 'comparison'); if (!n.ok) return n;
  if (sc.compares.some((c) => same(c.name, n.data))) return err(`A comparison called “${n.data}” already exists.`);
  const c = { id: nextId(st, 'sc'), name: n.data, scanners: list }; sc.compares.push(c); return ok(c);
}
export function editScanCompare(st, id, name, scanners) {
  const sc = scansOf(st); sc.compares ??= []; const c = sc.compares.find((x) => x.id === id); if (!c) return err('Not found.');
  const list = [...new Set(scanners)]; if (list.length < 2) return err('Tick at least 2 scanners.');
  const n = cleanName(name, 'comparison'); if (!n.ok) return n;
  if (sc.compares.some((x) => x.id !== id && same(x.name, n.data))) return err(`A comparison called “${n.data}” already exists.`);
  c.name = n.data; c.scanners = list; return ok();
}
export function deleteScanCompare(st, id) {
  const sc = scansOf(st); sc.compares ??= []; const i = sc.compares.findIndex((x) => x.id === id); if (i < 0) return err('Not found.');
  st.trash.push({ kind: 'scanCompare', deletedAt: new Date().toISOString(), item: sc.compares[i] }); sc.compares.splice(i, 1); return ok();
}
export function setScanKeyCols(st, cols) { const sc = scansOf(st); if (cols.length > 6) return err('Choose 6 at most.'); sc.keyCols = cols; return ok(); }

// 1.8.9 Finviz pages: page 2, 3 … of the same screener (same filters) on the same day join the scan of page 1
export function finvizRunFor(st, scanner, date, key) { return (st.scans?.runs || []).filter((r) => r.scanner === String(scanner).trim() && r.date === date && r.fvKey === key).sort((a, b) => b.seq - a.seq)[0] || null; }
export function joinFinvizPage(st, runId, { cols = [], rows, page, shown = null }) {
  const r = (st.scans?.runs || []).find((x) => x.id === runId); if (!r) return err('Not found.');
  if ((r.fvPages || []).includes(page)) return err('That page is already in this scan.');
  const have = new Set(r.rows.map((x) => SC.tickerOf(x.s)));
  const idx = (r.cols || []).map((c) => cols.indexOf(c)); // same view: same columns; a different view keeps the first view's columns
  let n = 0; for (const x of rows || []) { if (!SC.validSymbol(x.s) || have.has(SC.tickerOf(x.s))) continue; r.rows.push({ s: x.s.toUpperCase(), v: idx.map((i) => (i >= 0 ? x.v?.[i] ?? '' : '')) }); have.add(SC.tickerOf(x.s)); n++; }
  r.fvPages = [...(r.fvPages || []), page].sort((a, b) => a - b); if (shown) r.shown = shown;
  return ok({ added: n, run: r });
}

// ---------- 1.8.10 his Finviz screeners (name + filters; the Finviz key is never stored here) ----------
export function addFvScreen(st, name, address) {
  const sc = scansOf(st); sc.fvScreens ??= []; const n = cleanName(name, 'screener'); if (!n.ok) return n;
  const q = SC.finvizQuery(address); if (!q.ok) return q;
  if (sc.fvScreens.some((x) => same(x.name, n.data))) return err(`A screener called “${n.data}” already exists.`);
  const x = { id: nextId(st, 'fs'), name: n.data, q: q.q, last: null }; sc.fvScreens.push(x); return ok({ screen: x, warn: q.warn, perf: q.perf });
}
export function editFvScreen(st, id, name, address) {
  const sc = scansOf(st); sc.fvScreens ??= []; const x = sc.fvScreens.find((y) => y.id === id); if (!x) return err('Not found.');
  const n = cleanName(name, 'screener'); if (!n.ok) return n; if (sc.fvScreens.some((y) => y.id !== id && same(y.name, n.data))) return err(`A screener called “${n.data}” already exists.`);
  if (address && address.trim()) { const q = SC.finvizQuery(address); if (!q.ok) return q; x.q = q.q; }
  x.name = n.data; return ok({ screen: x });
}
export function deleteFvScreen(st, id) { const sc = scansOf(st); sc.fvScreens ??= []; const i = sc.fvScreens.findIndex((y) => y.id === id); if (i < 0) return err('Not found.'); sc.fvScreens.splice(i, 1); return ok(); }
export function markFvFetched(st, id, date) { const x = (st.scans?.fvScreens || []).find((y) => y.id === id); if (x) x.last = date; return ok(); }
