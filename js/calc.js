// All trading calculations. Pure functions: they read the data and never change it.
import * as D from './decimal.js';
import { diffDays, addDays, weekStart } from './dates.js';

const n = (x) => (x === null || x === undefined || x === '' ? null : D.d(x));
export const N = n;

// ---------- one trade (one buy line) ----------
export const soldQty = (t) => t.sales.reduce((a, s) => a + D.d(s.qty), 0n);
export const openQty = (t) => D.d(t.qty) - soldQty(t);
export function status(t) {
  const o = openQty(t);
  if (o === 0n) return 'closed';
  return t.sales.length ? 'partly' : 'open';
}
const sortedSales = (t) => [...t.sales].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));

// Buy commission is split by shares sold; the remainder goes on the last sale so parts add up exactly.
export function buyShares(t) {
  const sales = sortedSales(t);
  const q = D.d(t.qty), comm = n(t.buyCommission) ?? 0n;
  const closed = openQty(t) === 0n;
  let used = 0n; const out = new Map();
  sales.forEach((s, i) => {
    let share;
    if (closed && i === sales.length - 1) share = comm - used;
    else share = q === 0n ? 0n : D.div(D.mul(comm, D.d(s.qty)), q);
    used += share; out.set(s.id, share);
  });
  return out;
}
export function saleNet(t, s, shares = buyShares(t)) {
  const gross = D.mul(D.sub(D.d(s.price), D.d(t.buyPrice)), D.d(s.qty));
  return gross - (shares.get(s.id) ?? 0n) - (n(s.commission) ?? 0n);
}
export function salesDetail(t) {
  const shares = buyShares(t);
  return sortedSales(t).map((s) => ({ sale: s, buyShare: shares.get(s.id) ?? 0n, net: saleNet(t, s, shares) }));
}
export const realized = (t) => salesDetail(t).reduce((a, x) => a + x.net, 0n);
export const tradeNet = realized; // net P&L of all its sales (a trade is counted when closed)
export function riskPerShare(t) { const s = n(t.initialStop), b = D.d(t.buyPrice); return s === null ? null : D.sub(b, s); }
export function riskOfQty(t, qty) { const r = riskPerShare(t); return r === null ? null : D.mul(r, qty); }
// R = total result / risk of the shares sold (Initial stop). null when there is no stop.
export function rMultiple(t, qty = soldQty(t), net = realized(t)) {
  const risk = riskOfQty(t, qty);
  if (risk === null || risk <= 0n) return null;
  return D.div(net, risk);
}
export const lastSaleDate = (t) => { const s = sortedSales(t); return s.length ? s[s.length - 1].date : null; };
export const holdingDays = (t) => { const l = lastSaleDate(t); return l ? diffDays(t.buyDate, l) : null; };
export const saleDays = (t, s) => diffDays(t.buyDate, s.date);

// ---------- labels saved with a trade (F6) ----------
export function rCategory(R, settings) {
  if (R === null) return null;
  for (const [lim, name] of settings.rCategories) if (R >= D.d(lim)) return name;
  return settings.rCategoryElse;
}
// Decision #13: the colour of a result label follows its POSITION in the list, never its name text — renaming a
// label (e.g. "WINNER" -> something else) must not lose its colour, and this is the one place both Settings and
// History read the colour from, so they can never disagree.
export const R_TONES = ['green', 'green', 'green', 'grey', 'amber', 'red', 'red'];
export function rCategoryTone(R, settings) {
  if (R === null) return null;
  const i = settings.rCategories.findIndex(([lim]) => R >= D.d(lim));
  return i === -1 ? (R_TONES.at(-1) ?? 'blue') : (R_TONES[i] ?? 'blue');
}
export function stopDistancePct(t) { // buy -> initial stop, % of buy price
  const r = riskPerShare(t); if (r === null) return null;
  return D.pct(r, D.d(t.buyPrice));
}
export function stopDistanceLabel(pct, settings) {
  if (pct === null) return null;
  for (const [lim, name] of settings.stopDistance) if (pct <= D.d(lim)) return name;
  return settings.stopDistanceElse;
}

// ---------- capital ----------
// Events that change capital. Each has a date and a seq (order of entry). Same-day order = order entered.
export function capitalEvents(state) {
  const ev = [];
  const st = state.capital.start;
  if (st) ev.push({ kind: 'start', date: st.date, seq: st.seq ?? 0, amount: D.d(st.amount) });
  for (const f of state.capital.flows) ev.push({ kind: f.type, date: f.date, seq: f.seq, amount: f.type === 'withdrawal' ? -D.d(f.amount) : D.d(f.amount), id: f.id });
  for (const dv of state.dividends) ev.push({ kind: 'dividend', date: dv.payDate, seq: dv.seq, amount: D.d(dv.amount), id: dv.id });
  for (const t of state.trades) for (const x of salesDetail(t)) ev.push({ kind: 'sale', date: x.sale.date, seq: x.sale.seq, amount: x.net, id: x.sale.id, tradeId: t.id });
  ev.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
  return ev;
}
// capital just before an entry at (date, seq). Pass seq = Infinity to include everything on that date.
export function capitalBefore(state, date, seq = Infinity, ev = capitalEvents(state)) {
  let c = 0n;
  for (const e of ev) { if (e.date < date || (e.date === date && e.seq < seq)) c += e.amount; }
  return c;
}
export const capitalNow = (state) => capitalEvents(state).reduce((a, e) => a + e.amount, 0n);
// Fast lookup for many trades at once: sorted events + running totals + binary search (same result as capitalBefore).
export function capitalLookup(state, ev = capitalEvents(state)) {
  const run = []; let c = 0n; for (const e of ev) { c += e.amount; run.push(c); }
  const before = (e, date, seq) => e.date < date || (e.date === date && e.seq < seq);
  return (date, seq = Infinity) => { let lo = 0, hi = ev.length; while (lo < hi) { const m = (lo + hi) >> 1; if (before(ev[m], date, seq)) lo = m + 1; else hi = m; } return lo ? run[lo - 1] : 0n; };
}
export const invested = (state) => {
  let s = state.capital.start ? D.d(state.capital.start.amount) : 0n;
  for (const f of state.capital.flows) if (f.type === 'deposit') s += D.d(f.amount);
  return s;
};
// capital timeline for the chart: running total after each event
export function capitalSeries(state) {
  let c = 0n; return capitalEvents(state).map((e) => { c += e.amount; return { ...e, capital: c }; });
}

// ---------- open lines at last prices ----------
export function lineValues(t) {
  const q = openQty(t);
  const last = n(t.last), stop = n(t.currentStop), buy = D.d(t.buyPrice);
  return {
    openQty: q,
    openPL: last === null ? null : D.mul(D.sub(last, buy), q),
    value: last === null ? null : D.mul(last, q),
    lossIfStop: last === null || stop === null ? null : D.mul(D.sub(stop, last), q),
    toStopPct: last === null || stop === null || last === 0n ? null : D.pct(D.sub(last, stop), last),
  };
}
export function openTrades(state) { return state.trades.filter((t) => openQty(t) > 0n); }
export function estimatedAccount(state) {
  let c = capitalNow(state);
  for (const t of openTrades(state)) { const v = lineValues(t); if (v.openPL !== null) c += v.openPL; }
  return c;
}
export function lineMetrics(state, t, account = estimatedAccount(state)) {
  const v = lineValues(t);
  const q = v.openQty, buy = D.d(t.buyPrice), stop = n(t.currentStop);
  const cap = n(t.capitalAtOpen);
  const positionPct = v.value === null || account <= 0n ? null : D.pct(v.value, account);
  // loss at the stop as % of the capital the trade was opened with; none when the stop is at/above the buy price
  let riskAtStopPct = null, lossAtStop = null;
  if (stop !== null && stop < buy && cap && cap > 0n) { lossAtStop = D.mul(D.sub(stop, buy), q); riskAtStopPct = D.pct(-lossAtStop, cap); }
  const realizedSo = t.sales.length ? realized(t) : null;
  const rReal = t.sales.length ? rMultiple(t, soldQty(t), realizedSo) : null;
  const lockedAtStop = stop === null ? null : D.mul(D.sub(stop, buy), q); // result if stopped out now (before commission)
  return { ...v, positionPct, riskAtStopPct, lossAtStop, realized: realizedSo, rReal, lockedAtStop,
    lockedR: stop === null || riskPerShare(t) === null || riskPerShare(t) <= 0n ? null : D.div(D.sub(stop, buy), riskPerShare(t)) };
}

// ---------- dashboard top numbers ----------
export function monthResult(state, isoMonth) {
  let s = 0n; for (const t of state.trades) for (const x of salesDetail(t)) if (x.sale.date.slice(0, 7) === isoMonth) s += x.net; return s;
}
export function yearResult(state, year) {
  let s = 0n; for (const t of state.trades) for (const x of salesDetail(t)) if (x.sale.date.slice(0, 4) === year) s += x.net; return s;
}
export function progress(state) {
  const inv = invested(state); let res = 0n;
  for (const e of capitalEvents(state)) if (e.kind === 'sale' || e.kind === 'dividend') res += e.amount;
  return { invested: inv, result: res, pct: inv > 0n ? D.pct(res, inv) : null };
}
export function lossIfAllStopsHit(state) {
  let s = 0n, missing = 0; for (const t of openTrades(state)) { const v = lineValues(t); if (v.lossIfStop === null) missing++; else s += v.lossIfStop; }
  return { loss: s, pctOfAccount: (() => { const a = estimatedAccount(state); return a > 0n ? D.pct(s, a) : null; })(), missing };
}

// ---------- quantity check (F4): bought = sold + open ----------
export function quantityProblems(t) {
  const q = D.d(t.qty), sold = soldQty(t);
  const out = [];
  if (q < sold) out.push({ type: 'oversold', bought: q, sold, missing: sold - q });
  return out;
}

// ---------- statistics for closed trades ----------
export function closedTrades(state) { return state.trades.filter((t) => t.sales.length && openQty(t) === 0n); }
export { weekStart, addDays };

// ---------- Dashboard v2 (2026-11-14, agreed with him one point at a time) ----------
// Open positions grouped by symbol. Value at last price; a line without a last price uses its buy price and is marked
// (noLast) so it is never invisible. "If stop hit" = from NOW: (Current stop - last) x shares, buy price when no last;
// null when the line has no stop. Percentages are of the estimated account (same base as Loss if all stops hit / In market).
export function dashExposure(state) {
  const account = estimatedAccount(state);
  const by = new Map();
  for (const t of openTrades(state)) {
    const stock = state.stocks.find((s) => s.id === t.stockId);
    const sym = stock?.symbol ?? '?';
    const q = openQty(t), last = n(t.last), stop = n(t.currentStop), buy = D.d(t.buyPrice);
    const price = last ?? buy;
    const r = by.get(sym) ?? { sym, sector: (stock?.sector || '').trim() || 'No sector', value: 0n, loss: 0n, noStop: false, noLast: false, pl: 0n, plKnown: true };
    r.value += D.mul(price, q);
    if (last === null) { r.noLast = true; r.plKnown = false; } else r.pl += D.mul(D.sub(last, buy), q);
    if (stop === null) r.noStop = true; else r.loss += D.mul(D.sub(stop, price), q);
    by.set(sym, r);
  }
  const pctOf = (v) => (account > 0n ? D.pct(v, account) : null);
  const rows = [...by.values()].map((r) => ({ ...r, loss: r.noStop ? null : r.loss, pl: r.plKnown ? r.pl : null, pct: pctOf(r.value) }))
    .sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
  const sec = new Map();
  for (const r of rows) sec.set(r.sector, (sec.get(r.sector) ?? 0n) + r.value);
  const sectors = [...sec.entries()].map(([key, value]) => ({ key, value, pct: pctOf(value) })).sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
  const total = rows.reduce((a, r) => a + r.value, 0n);
  return { account, total, totalPct: pctOf(total), rows, sectors };
}

// Months between two ISO dates (inclusive), as 'YYYY-MM'.
export function monthsBetween(from, to) {
  const out = []; let [y, m] = from.slice(0, 7).split('-').map(Number); const [ey, em] = to.slice(0, 7).split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
// One entry per month: result by SALE date (C13), its % of the capital on the 1st, the trades CLOSED that month
// (month of last sale, C4) with won/lost/at 0 and the best one, and the running total over the shown months.
export function monthStats(state, from, to) {
  const ev = capitalEvents(state); const capAt = capitalLookup(state, ev);
  const net = new Map(), closedIn = new Map();
  for (const t of state.trades) {
    for (const x of salesDetail(t)) { if (x.sale.date < from || x.sale.date > to) continue; const k = x.sale.date.slice(0, 7); net.set(k, (net.get(k) ?? 0n) + x.net); }
    if (t.sales.length && openQty(t) === 0n) { const l = lastSaleDate(t); if (l >= from && l <= to) { const k = l.slice(0, 7); (closedIn.get(k) ?? closedIn.set(k, []).get(k)).push(t); } }
  }
  let run = 0n;
  return monthsBetween(from, to).map((k) => {
    const has = net.has(k); const v = net.get(k) ?? 0n; if (has) run += v;
    const cap = capAt(k + '-01', -Infinity);
    const tr = closedIn.get(k) ?? [];
    let won = 0, lost = 0, zero = 0, best = null;
    for (const t of tr) { const r = realized(t); if (r > 0n) won++; else if (r < 0n) lost++; else zero++; if (!best || r > best.net) best = { net: r, sym: state.stocks.find((s) => s.id === t.stockId)?.symbol ?? '?' }; }
    return { month: k, has, net: v, pct: has && cap > 0n ? D.pct(v, cap) : null, closed: tr.length, won, lost, zero, best, run: has ? run : null };
  });
}
// Closed trades (month of last sale inside the period) grouped by setup. Win rate = wins / (wins + losses), as in History.
export function setupStats(state, from, to) {
  const by = new Map();
  for (const t of closedTrades(state)) {
    const l = lastSaleDate(t); if (l < from || l > to) continue;
    const name = state.setups.find((s) => s.id === t.setupId)?.name ?? 'Unclassified';
    const g = by.get(name) ?? { name, n: 0, net: 0n, won: 0, lost: 0, zero: 0, rSum: 0n, rN: 0 };
    const r = realized(t); g.n++; g.net += r; if (r > 0n) g.won++; else if (r < 0n) g.lost++; else g.zero++;
    const R = rMultiple(t); if (R !== null) { g.rSum += R; g.rN++; }
    by.set(name, g);
  }
  return [...by.values()].map((g) => ({ ...g, winRate: g.won + g.lost ? D.pct(D.d(String(g.won)), D.d(String(g.won + g.lost))) : null, avgR: g.rN ? D.div(g.rSum, D.d(String(g.rN))) : null }))
    .sort((a, b) => (b.net > a.net ? 1 : b.net < a.net ? -1 : 0));
}
// Capital after every event, plus highest, lowest and the deepest drop (peak to following low, in %).
export function capitalCurve(state) {
  const pts = capitalSeries(state).map((e) => ({ date: e.date, kind: e.kind, amount: e.amount, capital: e.capital }));
  if (!pts.length) return { pts, high: null, low: null, drop: null };
  let high = pts[0], low = pts[0], peak = pts[0], drop = null;
  for (const p of pts) {
    if (p.capital > high.capital) high = p;
    if (p.capital < low.capital) low = p;
    if (p.capital > peak.capital) peak = p;
    if (peak.capital > 0n) { const dd = D.pct(p.capital - peak.capital, peak.capital); if (dd < 0n && (!drop || dd < drop.pct)) drop = { pct: dd, from: peak, to: p }; }
  }
  return { pts, high, low, drop };
}
