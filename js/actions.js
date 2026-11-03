// All changes to the data go through these actions. Each one works on a copy and returns { ok, error?, data? }.
// Nothing is changed when an action fails. Money values are stored as exact text.
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
function log(st, entry) { st.changeLog.push({ ts: new Date().toISOString(), ...entry }); }

// ---------- capital ----------
export function setStartCapital(st, { amount, date }) {
  const a = D.parse(amount); if (a === null || a < 0n) return err('Enter the start capital as a number.');
  if (!date) return err('Enter the start capital date.');
  const earlier = st.trades.find((t) => t.buyDate < date);
  if (earlier) return err(`A trade (${symbolOf(st, earlier)} bought ${earlier.buyDate}) is older than this date. Move the start date back.`);
  st.capital.start = { amount: S(a), date, seq: st.capital.start?.seq ?? nextSeq(st) };
  return ok();
}
export function addFlow(st, { date, type, amount }) {
  const a = D.parse(amount); if (a === null || a <= 0n) return err('Enter the amount as a positive number.');
  if (!['deposit', 'withdrawal'].includes(type)) return err('Choose deposit or withdrawal.');
  if (!st.capital.start) return err('Set the start capital first.');
  if (date < st.capital.start.date) return err('The date is before the start capital date.');
  const f = { id: nextId(st, 'f'), date, type, amount: S(a), seq: nextSeq(st) }; st.capital.flows.push(f); return ok(f);
}
export function deleteFlow(st, id) {
  const i = st.capital.flows.findIndex((f) => f.id === id); if (i < 0) return err('Not found.');
  st.trash.push({ kind: 'flow', deletedAt: new Date().toISOString(), item: st.capital.flows[i] }); st.capital.flows.splice(i, 1); return ok();
}
export function addDividend(st, { stockId, payDate, amount }) {
  const a = D.parse(amount); if (a === null || a <= 0n) return err('Enter the net amount as a positive number.');
  if (!stockById(st, stockId)) return err('Choose a stock.'); if (!payDate) return err('Enter the pay date.');
  const dv = { id: nextId(st, 'd'), stockId, payDate, amount: S(a), seq: nextSeq(st) }; st.dividends.push(dv); return ok(dv);
}
export function deleteDividend(st, id) {
  const i = st.dividends.findIndex((x) => x.id === id); if (i < 0) return err('Not found.');
  st.trash.push({ kind: 'dividend', deletedAt: new Date().toISOString(), item: st.dividends[i] }); st.dividends.splice(i, 1); return ok();
}

// ---------- lists ----------
const LISTS = { stocks: 'stock', setups: 'setup', errors: 'error' };
export function addListItem(st, list, name, extra = {}) {
  const nm = String(name ?? '').trim(); if (!nm) return err('Enter a name.');
  const key = list === 'stocks' ? 'symbol' : 'name';
  const norm = list === 'stocks' ? nm.toUpperCase() : nm;
  if (st[list].some((x) => x[key].toLowerCase() === norm.toLowerCase())) return err(`“${norm}” already exists.`);
  const it = { id: nextId(st, list[0]), [key]: norm, archived: false, ...(list === 'stocks' ? { sector: extra.sector ?? '', industry: extra.industry ?? '', exchange: extra.exchange ?? '' } : {}) };
  st[list].push(it); return ok(it);
}
export function listUsage(st, list, id) {
  const f = list === 'stocks' ? 'stockId' : list === 'setups' ? 'setupId' : 'errorId';
  return st.trades.filter((t) => t[f] === id).length + (list === 'stocks' ? st.dividends.filter((d) => d.stockId === id).length : 0);
}
export function renameListItem(st, list, id, newName, { merge = false } = {}) {
  const key = list === 'stocks' ? 'symbol' : 'name';
  const it = st[list].find((x) => x.id === id); if (!it) return err('Not found.');
  const nm = list === 'stocks' ? String(newName).trim().toUpperCase() : String(newName).trim(); if (!nm) return err('Enter a name.');
  const other = st[list].find((x) => x.id !== id && x[key].toLowerCase() === nm.toLowerCase());
  if (other && !merge) return err('exists', { exists: other });
  if (other && merge) { // move all links to the existing item in one step, then remove the old one
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
  if (stock.archived) stock.archived = false;
  const seq = nextSeq(st);
  const t = {
    id: nextTradeId(st), seq, stockId: stock.id, buyDate: f.buyDate, qty: S(D.d(f.qty)), buyPrice: S(D.d(f.buyPrice)),
    buyCommission: need(f.buyCommission) ? S(D.d(f.buyCommission)) : '', initialStop: need(f.initialStop) ? S(D.d(f.initialStop)) : '',
    currentStop: need(f.currentStop) ? S(D.d(f.currentStop)) : (need(f.initialStop) ? S(D.d(f.initialStop)) : ''),
    last: need(f.last) ? S(D.d(f.last)) : S(D.d(f.buyPrice)), highest: need(f.highest) ? S(D.d(f.highest)) : S(D.d(f.buyPrice)),
    ema10: need(f.ema10) ? S(D.d(f.ema10)) : '', nextReport: f.nextReport || '', setupId: f.setupId || null, errorId: f.errorId || null, comment: f.comment || '',
    direction: 'Long', capitalAtOpen: '', sales: [],
  };
  t.capitalAtOpen = S(C.capitalBefore(st, t.buyDate, seq));
  st.trades.push(t); log(st, { type: 'open', tradeId: t.id }); return ok(t);
}

// ---------- daily edits (saved at once, Undo for the last one) ----------
const NUM_FIELDS = new Set(['last', 'highest', 'ema10', 'currentStop']);
export function editDaily(st, id, field, raw) {
  const t = tradeById(st, id); if (!t) return err('Not found.');
  if (!['last', 'highest', 'ema10', 'currentStop', 'nextReport', 'comment', 'setupId', 'errorId'].includes(field)) return err('This value cannot be edited here.');
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
  t[field] = val; return ok(t);
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
  for (const k of ['qty', 'buyPrice', 'buyCommission', 'buyDate']) if (t[k] !== nt[k]) { log(st, { type: 'edit', tradeId: t.id, field: k, old: t[k], new: nt[k] }); t[k] = nt[k]; }
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
  t.sales = t.sales.filter((s) => !saleIds.includes(s.id)); log(st, { type: 'reopen', tradeId, sales: saleIds }); return ok(t);
}
export function deleteTrade(st, id) {
  const i = st.trades.findIndex((t) => t.id === id); if (i < 0) return err('Not found.');
  st.trash.push({ kind: 'trade', deletedAt: new Date().toISOString(), item: st.trades[i] }); st.trades.splice(i, 1); log(st, { type: 'delete', tradeId: id }); return ok();
}
export function restoreFromTrash(st, index) {
  const e = st.trash[index]; if (!e) return err('Not found.');
  const back = { trade: () => st.trades.push(e.item), dividend: () => st.dividends.push(e.item), flow: () => st.capital.flows.push(e.item), stocks: () => st.stocks.push(e.item), setups: () => st.setups.push(e.item), errors: () => st.errors.push(e.item), sales: () => { const t = tradeById(st, e.item.tradeId); if (!t) return false; t.sales.push(...e.item.sales); } };
  if (!back[e.kind]) return err('This item cannot be restored.');
  if (back[e.kind]() === false) return err('The trade of these sales no longer exists.');
  st.trash.splice(index, 1); return ok();
}
export function purgeTrash(st, now = Date.now(), days = 15) { st.trash = st.trash.filter((e) => now - Date.parse(e.deletedAt) < days * 86400000); return ok(); }

// ---------- capital at open: preview and recalculation (D2) ----------
export function capitalDiffs(st) {
  const ev = C.capitalEvents(st); const out = [];
  for (const t of st.trades) { const c = C.capitalBefore(st, t.buyDate, t.seq, ev); if (S(c) !== t.capitalAtOpen) out.push({ id: t.id, symbol: symbolOf(st, t), before: t.capitalAtOpen, after: S(c) }); }
  return out;
}
export function recalcCapital(st) { const ev = C.capitalEvents(st); for (const t of st.trades) t.capitalAtOpen = S(C.capitalBefore(st, t.buyDate, t.seq, ev)); return ok(); }

// ---------- split (D5) ----------
export function splitPreview(st, stockId, ratioNew, ratioOld, date) {
  const rn = D.parse(ratioNew), ro = D.parse(ratioOld); if (rn === null || ro === null || rn <= 0n || ro <= 0n) return err('Enter the ratio as two numbers above 0.');
  const f = D.div(rn, ro); const rows = [];
  for (const t of st.trades.filter((x) => x.stockId === stockId)) {
    const open = C.openQty(t) > 0n; if (!open) continue; // trades fully closed before the split stay untouched
    rows.push({ trade: t, qtyBefore: D.d(t.qty), qtyAfter: D.mul(D.d(t.qty), f), priceBefore: D.d(t.buyPrice), priceAfter: D.div(D.d(t.buyPrice), f) });
  }
  return ok({ factor: f, rows });
}
export function applySplit(st, stockId, ratioNew, ratioOld, date) {
  const p = splitPreview(st, stockId, ratioNew, ratioOld, date); if (!p.ok) return p;
  const f = p.data.factor; const conv = (v) => (v === '' ? '' : S(D.div(D.d(v), f)));
  for (const { trade: t } of p.data.rows) {
    t.qty = S(D.mul(D.d(t.qty), f)); t.buyPrice = conv(t.buyPrice); t.initialStop = conv(t.initialStop); t.currentStop = conv(t.currentStop);
    t.last = conv(t.last); t.highest = conv(t.highest); t.ema10 = conv(t.ema10);
    for (const s of t.sales) { s.qty = S(D.mul(D.d(s.qty), f)); s.price = conv(s.price); } // sold parts of the same trade convert too, so totals add up
  }
  st.splits.push({ id: nextId(st, 'p'), stockId, date, ratio: `${S(D.d(ratioNew))}:${S(D.d(ratioOld))}`, trades: p.data.rows.map((r) => r.trade.id) }); log(st, { type: 'split', stockId });
  return ok(p.data);
}

// ---------- settings ----------
export function setSetting(st, key, value) { st.settings[key] = value; return ok(); }
