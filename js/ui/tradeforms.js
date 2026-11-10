import { h, closeTopDialog, suggest, dialog, para, toast, money, signed, pctTxt, qtyTxt, priceTxt, numClass, dmy, num, field, changeTable, infoBtn, datePicker } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';
import * as A from '../actions.js';
import { parseDMY, weekdayName, isWeekend } from '../dates.js';
import { askRecalc } from './capital.js';
import { checkReminders } from './reminders.js';

// 2026-11-10: "Unclassified" = setup missing. The empty choice carries that name, so the list item with the same name is not offered again.
export const isUncl = (x) => (x?.name || '').trim().toLowerCase() === 'unclassified';
const sel = (items, value, { blank = '–' } = {}) => h('select', null, h('option', { value: '' }, blank), items.map((x) => h('option', { value: x.id, selected: x.id === value }, x.name ?? x.symbol)));
const dateInput = (iso, label) => datePicker({ iso: iso || '', label });
const numInput = (v = '', label) => h('input', { value: v, inputmode: 'decimal', style: { textAlign: 'right' }, 'aria-label': label, autocomplete: 'off' });
const back = (ctx) => ctx.go('open');

// "+ New…" at the bottom of a Setup / Mistake drop-down (2026-11-06): type a name right there, without leaving the screen.
// The new name is only added to the list when the trade is saved (same step, one Undo). Returns the small row to place under the box.
const NEW_OPT = '__new';
export function withNew(select, label) {
  select.append(h('option', { value: NEW_OPT }, '+ New…'));
  const inp = h('input', { 'aria-label': `New ${label.toLowerCase()} name`, placeholder: `Name of the new ${label.toLowerCase()}`, autocomplete: 'off' });
  const msg = h('span', { class: 'note' });
  let prev = select.value === NEW_OPT ? '' : select.value;
  const add = () => {
    const nm = inp.value.trim(); if (!nm) { msg.textContent = 'Enter a name.'; inp.focus(); return; }
    const same = [...select.options].find((o) => o.value && o.value !== NEW_OPT && o.dataset.name?.toLowerCase() === nm.toLowerCase());
    if (same) select.value = same.value;
    else { const o = h('option', { value: 'new:' + nm }, nm + ' (new)'); o.dataset.name = nm; select.insertBefore(o, select.lastChild); select.value = o.value; }
    prev = select.value; row.hidden = true; inp.value = ''; msg.textContent = '';
    select.dispatchEvent(new Event('change')); select.dispatchEvent(new Event('input'));
  };
  const cancel = () => { select.value = prev; row.hidden = true; msg.textContent = ''; };
  const row = h('div', { class: 'addnew', hidden: true }, inp, h('button', { class: 'btn sm pri', type: 'button', onClick: add }, 'Add'), h('button', { class: 'btn sm', type: 'button', onClick: cancel }, 'Cancel'), msg);
  for (const o of select.options) if (o.value && o.value !== NEW_OPT) o.dataset.name = o.textContent;
  select.addEventListener('change', () => { if (select.value === NEW_OPT) { row.hidden = false; inp.focus(); } else prev = select.value; });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(); } else if (e.key === 'Escape') { e.stopPropagation(); cancel(); } });
  return row;
}
// inside the saving step: turn a "new:Name" choice into a list item (an archived item with that name comes back instead)
export function resolveNew(d, list, v) {
  if (!v || v === NEW_OPT) return null; if (!v.startsWith('new:')) return v;
  const nm = v.slice(4); const ex = d[list].find((x) => x.name.toLowerCase() === nm.toLowerCase());
  if (ex) { ex.archived = false; return ex.id; }
  const r = A.addListItem(d, list, nm); return r.ok ? r.data.id : null;
}

// =====================================================================  OPEN A POSITION (locked reference, specification screen 2)
// I found a trade -> I define it -> I see the risk -> I accept it -> Open position. Validation and saving are A.validateOpen / A.openTrade.
const usd = (a) => (a === null || a === undefined ? '–' : (a < 0n ? '−$' : '$') + money(D.abs(a)));
export function renderOpen(ctx) {
  const st = ctx.store.state; const today = ctx.today(); const S = st.settings;
  const box = (input, pre) => h('div', { class: 'box' }, pre ? h('span', { class: 'pre' }, pre) : null, input);
  const of = (label, control, note) => h('label', { class: 'of' }, h('span', { class: 'l' }, label), control, note || null);
  const inp = (label, extra = {}) => h('input', { 'aria-label': label, autocomplete: 'off', ...extra });
  const pick = (items, label, blank) => h('select', { 'aria-label': label }, h('option', { value: '' }, blank), items.map((x) => h('option', { value: x.id }, x.name)));

  const sym = inp('Symbol', { placeholder: 'PLTR', style: { textTransform: 'uppercase' } });
  // suggestions from the 2nd letter (2026-11-09): your stocks, and the sectors, industries and exchanges you already use
  const uniqOf = (k) => [...new Set(st.stocks.map((s) => (s[k] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  suggest(sym, () => st.stocks.filter((s) => !s.archived).map((s) => ({ value: s.symbol, sub: [s.sector, s.exchange].filter(Boolean).join(' · ') })));
  const bp = inp('Buy price', { inputmode: 'decimal', placeholder: '0,00' }), qty = inp('Shares', { inputmode: 'decimal', placeholder: '0' });
  const bd = datePicker({ iso: today, label: 'Buy date' }), bc = inp('Buy commission', { inputmode: 'decimal', placeholder: '0,00' });
  const is = inp('Initial stop', { inputmode: 'decimal', placeholder: '0,00' });
  const setup = pick(st.setups.filter((x) => !x.archived && !isUncl(x)), 'Setup', 'Unclassified'); const setupNew = withNew(setup, 'Setup');
  const com = h('textarea', { 'aria-label': 'Trade thesis', rows: 3, placeholder: 'Why is this trade worth taking?' });
  const cs = inp('Current stop', { inputmode: 'decimal', placeholder: 'Same as Initial stop' }), last = inp('Last price', { inputmode: 'decimal', placeholder: 'Same as buy price' });
  const hi = inp('Highest price', { inputmode: 'decimal', placeholder: 'Same as buy price' }), ema = inp('EMA10', { inputmode: 'decimal', placeholder: 'Empty' }), nr = datePicker({ label: 'Next report' });
  const sector = inp('Sector'), industry = inp('Industry'), exch = inp('Exchange');
  suggest(sector, () => uniqOf('sector').map((v) => ({ value: v })));
  // industries of the sector you typed come first
  suggest(industry, () => { const sec = sector.value.trim().toLowerCase(); const inSec = new Set(st.stocks.filter((s) => (s.sector || '').toLowerCase() === sec).map((s) => s.industry)); return uniqOf('industry').sort((a, b) => inSec.has(b) - inSec.has(a)).map((v) => ({ value: v, sub: inSec.has(v) ? sector.value.trim() : '' })); });
  suggest(exch, () => uniqOf('exchange').map((v) => ({ value: v })), { min: 1 });
  const newStock = h('div', { class: 'newstock', hidden: true }, of('Sector', box(sector)), of('Industry', box(industry)), of('Exchange', box(exch)));
  const newNote = h('p', { class: 'note', hidden: true, style: { margin: 0 } }, 'New stock: add its sector, industry and exchange once.');
  // Sector / industry / exchange (2026-11-09): a stock traded before fills in what it already has (read-only, change it in Lists);
  // the missing ones are empty boxes to fill. None of them is required. Shown for a new stock or when something is missing.
  let infoFor = null;
  function syncInfo() {
    const key = sym.value.trim().toUpperCase(); if (key === infoFor) return; infoFor = key;
    const stock = key ? A.findStock(st, key) : null;
    for (const [x, k] of [[sector, 'sector'], [industry, 'industry'], [exch, 'exchange']]) {
      const have = stock ? (stock[k] || '').trim() : '';
      x.value = have; x.readOnly = !!have; x.closest('.box')?.classList.toggle('ro', !!have);
      x.title = have ? 'Saved with ' + key + '. Change it in Lists.' : '';
      x.placeholder = stock && !have ? 'Missing — optional' : 'Optional';
    }
    const missing = stock ? ['sector', 'industry', 'exchange'].filter((k) => !(stock[k] || '').trim()) : [];
    newNote.textContent = !stock ? 'New stock: add its sector, industry and exchange once (optional).' : `${key} has no ${missing.join(', ').replace(/, ([^,]*)$/, ' or $1')} yet — add it here if you like (optional).`;
    const show = !!key && (!stock || missing.length > 0); newStock.hidden = !show; newNote.hidden = !show;
  }
  const dnote = h('span', { class: 'n' });
  const bpBox = box(bp, '$'), isBox = box(is, '$'), qtyBox = box(qty), symBox = box(sym), bdBox = box(bd);

  // decision check
  const cSym = h('div', { class: 'op-sym' }, '—'), cLine = h('div', { class: 'op-line' }, 'Fill in the trade to see the check.');
  const rbox = h('div', { class: 'riskbox none' }), ck = h('dl', { class: 'ck', style: { margin: 0 } }), conds = h('div', { class: 'conds', 'aria-live': 'polite' });
  const accept = h('p', { class: 'accept' });
  let touched = false;

  const loss = C.lossIfAllStopsHit(st); const account = C.estimatedAccount(st);
  const nowRisk = account > 0n ? D.pct(D.abs(loss.loss), account) : null;

  function values() {
    return { symbol: sym.value.trim(), buyDate: bd.getISO() || null, qty: qty.value, buyPrice: bp.value, buyCommission: bc.value, initialStop: is.value, currentStop: cs.value, last: last.value, highest: hi.value, ema10: ema.value, nextReport: nr.getISO() || '', setupId: setup.value && setup.value !== NEW_OPT ? setup.value : null, errorId: null, comment: com.value, stockInfo: { sector: sector.value, industry: industry.value, exchange: exch.value } };
  }
  function check() {
    const f = values(); const v = A.validateOpen(st, f);
    const extra = [];
    for (const [x, name] of [[hi, 'Highest price'], [ema, 'EMA10'], [cs, 'Current stop'], [last, 'Last price']]) if (x.value.trim() && D.parse(x.value) === null) extra.push(name + ' must be a number.');
    if (nr.getISO() === null) extra.push('Next report is not a valid date (dd-mm-yyyy).');
    const errors = [...v.errors, ...extra];
    syncInfo();
    dnote.textContent = f.buyDate ? weekdayName(f.buyDate) + (isWeekend(f.buyDate) ? ' · weekend' : '') + (f.buyDate > today ? ' · in the future' : '') : '';
    const q = D.parse(qty.value), p = D.parse(bp.value), stop = D.parse(is.value);
    const okQP = q !== null && p !== null && q > 0n && p > 0n;
    const cap = st.capital.start && f.buyDate ? C.capitalBefore(st, f.buyDate, Infinity) : null;
    const badStop = stop !== null && p !== null && stop >= p;
    bpBox.classList.toggle('bad', touched && (p === null || p <= 0n)); qtyBox.classList.toggle('bad', touched && (q === null || q <= 0n)); isBox.classList.toggle('bad', badStop || (is.value.trim() !== '' && stop === null)); symBox.classList.toggle('bad', touched && !f.symbol); bdBox.classList.toggle('bad', touched && !f.buyDate);
    cSym.textContent = f.symbol ? f.symbol.toUpperCase() : '—';
    cLine.textContent = okQP ? `${qtyTxt(q)} shares at $${priceTxt(p)}` : 'Fill in the trade to see the check.';
    const risk = okQP && stop !== null && !badStop ? D.mul(D.sub(p, stop), q) : null;
    const riskPct = risk !== null && cap && cap > 0n ? D.pct(risk, cap) : null;
    const size = okQP && account > 0n ? D.pct(D.mul(q, p), account) : null; // same base as the cards: the estimated account today (his choice A, 2026-11-09)
    const dist = p !== null && p > 0n && stop !== null && !badStop ? D.pct(D.sub(p, stop), p) : null;
    const distLabel = dist === null ? '' : C.stopDistanceLabel(dist, S);
    const after = risk !== null && account > 0n ? D.pct(D.abs(loss.loss) + risk, account) : null;
    // conditions: errors (risk) first, then review items. Information only, except errors, which stop the opening.
    const list = [];
    if (touched) for (const e of errors) list.push(['act', e]);
    if (riskPct !== null && riskPct > D.d(S.riskRed)) list.push(['act', `Risk ${pctTxt(riskPct)} of capital is above your ${S.riskRed.replace('.', ',')} % limit.`]);
    else if (riskPct !== null && riskPct > D.d(S.riskWarn)) list.push(['rev', `Risk ${pctTxt(riskPct)} of capital is above ${S.riskWarn.replace('.', ',')} %.`]);
    if (size !== null && size > D.d(S.posTooBig)) list.push(['act', `Position size ${pctTxt(size, 1)} is above your ${S.posTooBig.replace('.', ',')} % limit.`]);
    else if (size !== null && size >= D.d(S.posNear)) list.push(['rev', `Position size ${pctTxt(size, 1)} is near your size limit.`]);
    if (distLabel && distLabel === S.stopDistanceElse) list.push(['rev', `Stop distance ${pctTxt(dist, 1)} is ${distLabel.toLowerCase()}.`]);
    if (f.symbol && C.openTrades(st).some((t) => A.symbolOf(st, t).toUpperCase() === f.symbol.toUpperCase())) list.push(['rev', `You already hold ${f.symbol.toUpperCase()}. This opens a separate trade.`]);
    if (f.buyDate && isWeekend(f.buyDate)) list.push(['rev', 'The buy date is a weekend.']);
    if (f.buyDate && f.buyDate > today) list.push(['rev', 'The buy date is in the future.']);
    if (touched || okQP) for (const w of v.warnings) list.push(['rev', w]);
    const level = list.some((x) => x[0] === 'act') ? 'act' : list.length ? 'rev' : 'ok';
    // planned risk box
    rbox.className = 'riskbox ' + (risk === null ? 'none' : riskPct !== null && riskPct > D.d(S.riskRed) ? 'act' : riskPct !== null && riskPct > D.d(S.riskWarn) ? 'rev' : 'ok');
    rbox.replaceChildren(h('span', { class: 'k' }, 'Risk at Initial stop', infoBtn('Risk at Initial stop', '(Buy price − Initial stop) × shares. As % of the capital on the buy date. Within plan up to ' + S.riskWarn.replace('.', ',') + ' %, review up to ' + S.riskRed.replace('.', ',') + ' %, above that it is above plan.')), h('span', { class: 'v' }, risk === null ? '—' : usd(risk)),
      h('span', { class: 'k' }, risk === null ? (badStop ? 'Stop must be below the buy price' : 'Add shares, buy price and initial stop') : `${pctTxt(riskPct)} · ${rbox.classList.contains('ok') ? 'within plan' : rbox.classList.contains('rev') ? 'review' : 'above plan'}`));
    const row = (k, val, why) => h('div', null, h('dt', null, k, infoBtn(k, why)), h('dd', null, val));
    ck.replaceChildren(row('Position size', pctTxt(size), 'Shares × buy price as % of your estimated account today (the same as on the cards).'), row('Stop distance', dist === null ? '–' : `${pctTxt(dist)} · ${distLabel}`, '(Buy price − Initial stop) ÷ buy price. Labels: Tight, Good, Wide, High Risk (limits in Settings).'),
      row('Loss if all stops hit, now', pctTxt(nowRisk), 'Loss if all stops hit from now, as % of the estimated account, before this trade.'), row('Loss if all stops hit, after', pctTxt(after), 'The same, after adding the risk of this trade at its Initial stop.'));
    conds.replaceChildren(...(list.length ? list : [['ok', '✓ No condition needs attention']]).map(([l, t]) => h('div', { class: 'cond ' + l }, t)));
    accept.textContent = risk !== null ? `By opening, you accept a planned loss of ${usd(risk)} if ${f.symbol ? f.symbol.toUpperCase() : 'the stock'} reaches ${priceTxt(stop)}.` : '';
    return { f, errors, level };
  }
  async function submit(again) {
    touched = true; const { f, errors } = check();
    if (errors.length) { (bpBox.classList.contains('bad') ? bp : qtyBox.classList.contains('bad') ? qty : symBox.classList.contains('bad') ? sym : isBox.classList.contains('bad') ? is : sym).focus(); return; }
    const res = ctx.act((d) => A.openTrade(d, { ...f, setupId: resolveNew(d, 'setups', f.setupId) }), { label: 'open ' + f.symbol.toUpperCase(), now: true });
    if (!res.ok) return toast(res.error);
    toast(`${f.symbol.toUpperCase()} opened as ${res.data.id}.`, 'Undo', () => ctx.store.undo());
    if (again) { ctx.go('open-trade'); } else back(ctx);
  }
  bd.input.addEventListener('input', () => check()); nr.input.addEventListener('input', () => check());
  for (const x of [sym, qty, bp, bc, is, cs, last, hi, ema, setup, com, sector, industry, exch]) x.addEventListener('input', () => check());
  setTimeout(() => { check(); sym.focus(); }, 0);

  const more = h('details', { class: 'more' }, h('summary', null, 'More: current stop, last price, highest, EMA10, next report'),
    h('div', { class: 'fgrid', style: { marginTop: '14px' } }, of('Current stop', box(cs, '$')), of('Last price', box(last, '$')), of('Highest price', box(hi, '$')), of('EMA10', box(ema, '$')), of('Next report', box(nr))));
  const card = (title, lead, ...kids) => h('section', { class: 'card acc' }, h('div', { class: 'card-h' }, h('div', null, h('h2', null, title), h('p', { class: 'lead' }, lead))), h('div', { class: 'card-b', style: { display: 'flex', flexDirection: 'column', gap: '16px' } }, kids));
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '20px' } },
    h('header', { class: 'pg-head' },
      h('div', null, h('div', { class: 'eyebrow' }, 'Pre-trade'), h('h1', null, 'Open trade'), h('p', { class: 'lead' }, 'A clear decision before capital is committed.')),
      h('div', { class: 'acts' }, h('span', { class: 'hpill' }, 'Capital (closed trades)', h('b', null, usd(C.capitalNow(st)))), h('span', { class: 'hpill' }, 'Loss if all stops hit', h('b', null, pctTxt(nowRisk))), h('button', { class: 'btn ghost', onClick: () => back(ctx) }, 'Cancel'))),
    st.capital.start ? null : h('div', { class: 'msg warn' }, '◆ Capital is not set yet. Set the start capital on the Capital screen first.'),
    h('div', { class: 'op-grid' },
      h('div', { class: 'op-left' },
        card('Opportunity', 'Capture the trade.',
          h('div', { class: 'fgrid' }, of('Symbol', symBox), of('Buy price', bpBox), of('Shares', qtyBox),
            of('Buy date', h('div', { class: 'datebox' }, bdBox, h('button', { class: 'btn today', type: 'button', onClick: () => { bd.setISO(today); } }, 'Today')), dnote),
            of('Buy commission', box(bc, '$'))), newNote, newStock),
        card('Plan', 'Define the protection.', h('div', { class: 'fgrid' }, of('Initial stop', isBox), of('Setup', box(setup), setupNew)), more),
        h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('div', null, h('h2', null, 'Note'), h('p', { class: 'lead' }, 'Optional. Keep only what is worth remembering.'))),
          h('div', { class: 'card-b', style: { display: 'flex', flexDirection: 'column', gap: '16px' } }, of('Trade thesis', com)))),
      h('aside', { class: 'card acc op-check', 'aria-label': 'Decision check' }, h('div', { class: 'card-b' },
        h('div', null, h('div', { class: 'eyebrow' }, 'Decision check'), cSym), cLine, rbox, ck, conds,
        h('button', { class: 'btn go', disabled: ctx.readOnly, onClick: () => submit(false) }, 'Open position →'), accept,
        h('button', { class: 'btn ghost', disabled: ctx.readOnly, onClick: () => submit(true), style: { alignSelf: 'center' } }, 'Open and add another')))));
}

// =====================================================================  CLOSE TRADE
export function renderClose(ctx) {
  const st = ctx.store.state; const today = ctx.today();
  const bySym = new Map(); for (const t of C.openTrades(st)) { if (!bySym.has(t.stockId)) bySym.set(t.stockId, []); bySym.get(t.stockId).push(t); }
  if (!bySym.size) return h('section', { class: 'panel' }, h('div', { class: 'pb' }, h('p', null, 'You have no open positions to close.'), h('button', { class: 'btn', onClick: () => back(ctx) }, 'Back')));
  const startTrade = ctx.params.tradeId ? A.tradeById(st, ctx.params.tradeId) : null;
  const symSel = h('select', { 'aria-label': 'Symbol' }, [...bySym.entries()].map(([sid, ts]) => h('option', { value: sid, selected: startTrade ? startTrade.stockId === sid : false }, `${A.stockById(st, sid).symbol} · ${ts.length} line${ts.length === 1 ? '' : 's'} · ${qtyTxt(ts.reduce((a, t) => a + C.openQty(t), 0n))} shares`)));
  const total = numInput(startTrade ? D.edit(C.openQty(startTrade)) : '', 'Total shares sold'), date = dateInput(today, 'Sell date'), price = numInput('', 'Sell price'), comm = numInput('', 'Sell commission');
  const inputs = new Map(); const linesBox = h('div'); const status = h('div'); const prevBox = h('div'); const dnote = h('span', { class: 'note' });
  const btn = h('button', { class: 'btn pri', disabled: true, onClick: submit }, 'Close trade…');
  let touchedLines = false;
  // Q6: the mistake is chosen when closing; it is saved on every trade closed in this sale (empty = keep what the trade has)
  const mistake = h('select', { 'aria-label': 'Mistake' }, h('option', { value: '' }, 'None'), st.errors.filter((x) => !x.archived).map((x) => h('option', { value: x.id }, x.name)));
  let mistakeTouched = false; mistake.addEventListener('change', () => { mistakeTouched = true; });
  const mistakeNew = withNew(mistake, 'Mistake');
  // Setup when closing (2026-11-06): shows the setup of the lines; a chosen setup is saved on every trade closed in this sale,
  // empty = each trade keeps its own
  const setupSel = h('select', { 'aria-label': 'Setup' }, h('option', { value: '' }, 'Keep as it is'), st.setups.filter((x) => !x.archived && !isUncl(x)).map((x) => h('option', { value: x.id }, x.name)));
  let setupTouched = false; setupSel.addEventListener('change', () => { setupTouched = true; });
  const setupNew = withNew(setupSel, 'Setup');

  function lines() { return (bySym.get(symSel.value) || []).slice().sort((a, b) => (a.buyDate < b.buyDate ? -1 : a.buyDate > b.buyDate ? 1 : a.seq - b.seq)); }
  function buildLines(auto) {
    inputs.clear(); const ls = lines(); const tot = D.parse(total.value);
    const matches = tot === null ? [] : ls.filter((t) => C.openQty(t) === tot);
    const rows = ls.map((t) => {
      const i = h('input', { class: 'cell', value: '0', 'aria-label': 'Shares to close, ' + t.id }); inputs.set(t.id, i);
      i.addEventListener('input', () => { touchedLines = true; refresh(); });
      return h('tr', { 'data-id': t.id }, h('td', { class: 'mono' }, t.id), h('td', null, dmy(t.buyDate)), h('td', { class: 'r' }, qtyTxt(C.openQty(t))), h('td', { class: 'r' }, priceTxt(D.d(t.buyPrice))), h('td', { class: 'r' }, i),
        h('td', null, h('button', { class: 'btn sm', onClick: () => { i.value = D.edit(C.openQty(t)); touchedLines = true; if (!total.value) total.value = ''; refresh(); } }, 'Sell all')), h('td', { class: 'r', 'data-res': t.id }, '–'));
    });
    linesBox.replaceChildren(h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, ['Trade ID', 'Buy date', 'Open qty', 'Buy price', 'Shares to close', '', 'Result'].map((x, k) => h('th', { class: [2, 3, 4, 6].includes(k) ? 'r' : '' }, x)))), h('tbody', null, rows))));
    if (auto && matches.length === 1 && ls.length > 1 || (auto && ls.length === 1 && tot !== null)) { const m = matches[0] || ls[0]; if (matches.length === 1 || ls.length === 1) inputs.get(m.id).value = D.edit(tot ?? C.openQty(m)); }
    refresh(matches.length > 1 && !touchedLines ? matches : null);
  }
  function refresh(multi) {
    const iso = parseDMY(date.value); dnote.textContent = iso ? weekdayName(iso) : (date.value ? 'Not a valid date' : '');
    const tot = D.parse(total.value); let assigned = 0n; const allocations = [];
    for (const [id, i] of inputs) { const q = D.parse(i.value); if (q !== null && q > 0n) { assigned += q; allocations.push({ tradeId: id, qty: D.toStr(q) }); } else if (i.value.trim() && q === null) { i.classList.add('bad'); continue; } i.classList.remove('bad'); }
    const ok = tot !== null && tot > 0n && assigned === tot;
    status.replaceChildren(...[
      tot === null || tot <= 0n ? h('span', { class: 'pill warn' }, 'Enter the total shares sold') : h('span', { class: 'pill ' + (ok ? 'pos' : 'warn') }, ok ? `✓ ${qtyTxt(tot)} of ${qtyTxt(tot)} assigned` : `${qtyTxt(assigned)} of ${qtyTxt(tot)} assigned`),
      multi ? h('div', { class: 'msg warn', role: 'status', style: { marginTop: '6px' } }, `◆ Several lines match ${qtyTxt(D.parse(total.value))} shares (${multi.map((t) => t.id).join(', ')}): choose one. The program never picks for you.`) : null].filter(Boolean));
    // preview on a copy
    prevBox.replaceChildren(); let valid = ok && iso && D.parse(price.value) !== null && D.parse(price.value) > 0n && (comm.value.trim() === '' || D.parse(comm.value) !== null);
    let reason = !ok ? 'Assign all shares to lines first.' : !iso ? 'Enter a valid sell date.' : D.parse(price.value) === null || D.parse(price.value) <= 0n ? 'Enter the sell price.' : comm.value.trim() && D.parse(comm.value) === null ? 'Sell commission must be a number.' : '';
    if (valid) {
      const draft = structuredClone(st); const res = A.closeSale(draft, { date: iso, price: price.value, commission: comm.value, allocations });
      if (!res.ok) { valid = false; reason = res.error; prevBox.append(h('div', { class: 'msg bad', role: 'alert' }, '■ ' + res.error)); }
      else {
        const rows = res.data.map(({ tradeId, sale }) => { const t = A.tradeById(draft, tradeId); const det = C.salesDetail(t).find((x) => x.sale.id === sale.id); const closed = C.openQty(t) === 0n; const R = closed ? C.rMultiple(t) : C.rMultiple(t, D.d(sale.qty), det.net);
          return { t, sale, det, R, closed, gross: D.mul(D.sub(D.d(sale.price), D.d(t.buyPrice)), D.d(sale.qty)) }; });
        for (const r of rows) { const c = linesBox.querySelector(`[data-res="${r.t.id}"]`); if (c) { c.textContent = signed(r.det.net); c.className = 'r ' + numClass(r.det.net); } }
        const sum = (f) => rows.reduce((a, r) => a + f(r), 0n);
        prevBox.append(h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, ['Trade ID', 'Shares', 'Gross', 'Buy comm.', 'Sell comm.', 'Net', 'R', 'Days'].map((x, k) => h('th', { class: k ? 'r' : '' }, x)))),
          h('tbody', null, rows.map((r) => h('tr', null, h('td', { class: 'mono' }, r.t.id), h('td', { class: 'r' }, qtyTxt(D.d(r.sale.qty))), h('td', { class: 'r' }, signed(r.gross)), h('td', { class: 'r' }, r.det.buyShare === 0n ? '–' : '−' + money(r.det.buyShare)), h('td', { class: 'r' }, r.sale.commission ? '−' + money(D.d(r.sale.commission)) : '–'), h('td', { class: 'r ' + numClass(r.det.net) }, signed(r.det.net)), h('td', { class: 'r' }, r.R === null ? '–' : D.fmt(r.R, 2)), h('td', { class: 'r' }, String(C.saleDays(r.t, r.sale)))))),
          h('tfoot', null, h('tr', null, h('td', null, h('b', null, 'Total')), h('td', { class: 'r' }, h('b', null, qtyTxt(sum((r) => D.d(r.sale.qty))))), h('td', { class: 'r' }, h('b', null, signed(sum((r) => r.gross)))), h('td', { class: 'r' }, sum((r) => r.det.buyShare) === 0n ? '–' : '−' + money(sum((r) => r.det.buyShare))), h('td', { class: 'r' }, sum((r) => D.d(r.sale.commission || '0')) === 0n ? '–' : '−' + money(sum((r) => D.d(r.sale.commission || '0')))), h('td', { class: 'r ' + numClass(sum((r) => r.det.net)) }, h('b', null, signed(sum((r) => r.det.net)))), h('td'), h('td'))))),
          h('p', { class: 'note', style: { marginTop: '8px' } }, 'Buy commission is split by shares sold. Sell commission is split across lines by shares sold. A trade is counted when its last share is sold.'));
      }
    }
    btn.disabled = ctx.readOnly || !valid; btn.title = valid ? '' : reason;
    prevBox.dataset.reason = reason;
    ctx._closeAlloc = allocations;
    if (!mistakeTouched) { const ids = [...new Set(allocations.map((a) => A.tradeById(st, a.tradeId)?.errorId).filter(Boolean))]; mistake.value = ids.length === 1 ? ids[0] : ''; }
    if (!setupTouched) { const ids = [...new Set(allocations.map((a) => A.tradeById(st, a.tradeId)?.setupId ?? ''))]; setupSel.value = ids.length === 1 && ids[0] && [...setupSel.options].some((o) => o.value === ids[0]) ? ids[0] : ''; }
  }
  async function submit() {
    const iso = parseDMY(date.value); const allocations = ctx._closeAlloc;
    // Q1: missing commissions are asked for in a pop-up, but never stop the sale
    const buyFix = {}; const missBuy = allocations.map((a) => A.tradeById(st, a.tradeId)).filter((t) => t.buyCommission === '');
    if (comm.value.trim() === '' || missBuy.length) {
      const sellIn = comm.value.trim() === '' ? numInput('', 'Sell commission') : null;
      const buyIns = missBuy.map((t) => [t, numInput('', 'Buy commission ' + t.id)]);
      const fill = await dialog({ title: 'Commission missing', ok: 'Save commissions and continue', cancel: 'Continue without',
        body: h('div', { style: { display: 'grid', gap: '10px' } }, para('Without the commission the result is calculated without it, and the line is marked as missing data. You can fill it in now, or continue without it.', ''),
          sellIn ? field('Sell commission of this sale (USD)', sellIn) : null,
          buyIns.map(([t, i]) => field(`Buy commission of ${t.id} (bought ${dmy(t.buyDate)}) (USD)`, i))),
        onOk: () => { for (const i of [sellIn, ...buyIns.map((x) => x[1])]) if (i && i.value.trim() && D.parse(i.value) === null) return 'Commissions must be numbers (or leave the field empty).'; return true; } });
      if (fill) { if (sellIn && sellIn.value.trim()) comm.value = sellIn.value.trim(); for (const [t, i] of buyIns) if (i.value.trim()) buyFix[t.id] = i.value.trim(); refresh(); }
    }
    const errV = mistake.value && mistake.value !== NEW_OPT ? mistake.value : null, setV = setupSel.value && setupSel.value !== NEW_OPT ? setupSel.value : null;
    const apply = (d) => {
      for (const [id, v] of Object.entries(buyFix)) { const r = A.editBuyData(d, id, { buyCommission: v }); if (!r.ok) return r; }
      const r = A.closeSale(d, { date: iso, price: price.value, commission: comm.value, allocations }); if (!r.ok) return r;
      const errId = resolveNew(d, 'errors', errV), setId = resolveNew(d, 'setups', setV);
      for (const a of allocations) { const t = A.tradeById(d, a.tradeId); if (errId) t.errorId = errId; if (setId) t.setupId = setId; }
      return r;
    };
    const draft = structuredClone(st); const res0 = apply(draft); if (!res0.ok) return toast(res0.error);
    const sym = A.symbolOf(st, A.tradeById(st, res0.data[0].tradeId));
    // Result pop-ups (2026-11-06): one per trade. The first confirms the whole sale (Cancel / Close trade), the next ones only have OK.
    const results = res0.data.map(({ tradeId, sale }) => {
      const t = A.tradeById(draft, tradeId); const net = C.salesDetail(t).find((x) => x.sale.id === sale.id).net;
      const cost = D.mul(D.d(t.buyPrice), D.d(sale.qty)); const cap = C.N(t.capitalAtOpen);
      return { t, sale, net, tradePct: cost > 0n ? D.pct(net, cost) : null, capPct: cap && cap > 0n ? D.pct(net, cap) : null, days: C.saleDays(t, sale), left: C.openQty(t) };
    });
    const notes = Object.keys(buyFix).length ? `Buy commission saved for ${Object.keys(buyFix).join(', ')}.` : null;
    // A sale with an earlier date changes the capital of trades opened after it (2026-11-09): ask right away, not only on the Capital page.
    const diffKey = (x) => x.id + ':' + x.after; const diffsBefore = new Set(A.capitalDiffs(st).map(diffKey));
    let saved = false;
    for (let k = 0; k < results.length; k++) {
      const first = k === 0; const ok = await dialog({ title: `${sym} · ${results[k].t.id}`, cls: 'resdlg', info: !first, ok: first ? 'Close trade' : 'OK', body: resultCard(results[k], { k, n: results.length, first, price: price.value, notes: first ? notes : null }) });
      if (first) {
        if (!ok) return;
        const res = ctx.act((d) => apply(d), { label: 'sale ' + sym, now: true });
        if (!res.ok) return toast(res.error);
        saved = true;
      }
    }
    back(ctx);
    const needRecalc = saved && A.capitalDiffs(ctx.store.state).some((x) => !diffsBefore.has(diffKey(x)));
    if (saved) setTimeout(async () => { if (needRecalc) await askRecalc(ctx); await checkReminders(ctx); }, 0);
  }
  symSel.addEventListener('change', () => { touchedLines = false; total.value = ''; buildLines(false); });
  total.addEventListener('input', () => { touchedLines = false; buildLines(true); });
  for (const x of [date, price, comm]) x.addEventListener('input', () => refresh());
  buildLines(!!startTrade); setTimeout(() => (startTrade ? price : total).focus(), 0);
  return h('div', { class: 'cols' }, h('section', { class: 'panel', style: { flex: '1 1 100%' } },
    h('div', { class: 'ph' }, '1. The sale', h('span', { class: 'sub' }, 'one sale, one price')),
    h('div', { class: 'pb' }, h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', alignItems: 'start' } }, field('Symbol', symSel), field('Total shares sold', total), field('Sell date', date, dnote), field('Sell price (USD)', price), field('Sell commission (USD)', comm)),
      h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', alignItems: 'start', marginTop: '14px', maxWidth: '640px' } }, field('Setup', h('div', { class: 'selnew' }, setupSel, setupNew)), field('Mistake (if any)', h('div', { class: 'selnew' }, mistake, mistakeNew)))),
    h('div', { class: 'ph', style: { borderTop: '1px solid var(--line)' } }, '2. Choose the lines', status), linesBox,
    h('div', { class: 'pb', style: { display: 'grid', gap: '8px' } }, h('div', { class: 'row' }, btn, h('button', { class: 'btn', onClick: () => back(ctx) }, 'Cancel')), h('span', { class: 'note' }, 'The button stays off until every share is assigned and the price is filled in. It opens a confirmation first.'))),
    h('aside', { class: 'panel', style: { flex: '1 1 100%' }, 'aria-label': 'Preview' }, h('div', { class: 'ph' }, 'Preview before saving'), h('div', { class: 'pb' }, prevBox)));
}

// One trade's result when closing: money, % of the trade, % of capital, days held. Colour follows the result.
function resultCard(r, { k, n, first, price, notes }) {
  const tone = r.net > 0n ? 'gain' : r.net < 0n ? 'loss' : 'flat';
  const sp = (v) => (v === null ? '–' : (v > 0n ? '+' : v < 0n ? '−' : '') + D.fmt(D.abs(v), 2) + ' %');
  const word = tone === 'gain' ? 'Gain' : tone === 'loss' ? 'Loss' : 'Break-even';
  return h('div', { class: 'res ' + tone },
    n > 1 ? h('div', { class: 'res-step' }, `Trade ${k + 1} of ${n}` + (first ? ' · confirming closes all ' + n : '')) : null,
    h('div', { class: 'res-sub' }, `${qtyTxt(D.d(r.sale.qty))} shares · ${priceTxt(D.d(r.t.buyPrice))} → ${priceTxt(D.d(r.sale.price))}`),
    h('div', { class: 'res-hero' }, h('span', { class: 'res-word' }, word), h('span', { class: 'res-money' }, (r.net > 0n ? '+$' : r.net < 0n ? '−$' : '$') + money(D.abs(r.net)))),
    h('div', { class: 'res-tiles' },
      h('div', null, h('span', null, 'Of the trade'), h('b', null, sp(r.tradePct))),
      h('div', null, h('span', null, 'Of capital'), h('b', null, sp(r.capPct))),
      h('div', null, h('span', null, 'Days held'), h('b', { class: 'n' }, String(r.days)))),
    r.left > 0n ? h('div', { class: 'res-left' }, `Partly sold – ${qtyTxt(r.left)} shares still open`) : null,
    notes ? h('p', { class: 'note', style: { margin: '10px 0 0' } }, notes) : null);
}

// =====================================================================  EDIT PANEL (opened from Open positions and History)
export function editTrade(ctx, id) {
  const st = ctx.store.state; const t = A.tradeById(st, id); if (!t) return; const sym = A.symbolOf(st, t);
  const q = numInput(D.edit(D.d(t.qty)), 'Quantity'), bp = numInput(D.edit(D.d(t.buyPrice)), 'Buy price'), bc = numInput(t.buyCommission === '' ? '' : D.edit(D.d(t.buyCommission)), 'Buy commission'), bd = dateInput(t.buyDate, 'Buy date');
  const is = numInput(t.initialStop === '' ? '' : D.edit(D.d(t.initialStop)), 'Initial stop');
  const setup = sel(st.setups.filter((x) => !isUncl(x) && (!x.archived || x.id === t.setupId)), t.setupId, { blank: 'Unclassified' }); const setupNew = withNew(setup, 'Setup');
  const err = sel(st.errors.filter((x) => !x.archived || x.id === t.errorId), t.errorId); const errNew = withNew(err, 'Error');
  const com = h('textarea', { rows: 2, 'aria-label': 'Comment' }); com.value = t.comment || '';
  const msg = h('div', { class: 'msg bad', role: 'alert', style: { display: 'none' } });
  const sold = C.soldQty(t);
  dialog({ title: `Edit ${sym} · ${t.id}`, wide: true, ok: 'Save', body: h('div', { style: { display: 'grid', gap: '12px' } },
    sold > 0n ? h('div', { class: 'msg info' }, `● ${qtyTxt(sold)} shares were already sold. Quantity cannot go below that.`) : null,
    h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' } }, field('Buy date', bd), field('Quantity', q), field('Buy price', bp), field('Buy commission', bc), field('Initial stop', is, 'Used for R. Changing it is logged.')),
    h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' } }, field('Setup', h('div', { class: 'selnew' }, setup, setupNew)), field('Error', h('div', { class: 'selnew' }, err, errNew))), field('Comment', com), msg,
    h('div', { class: 'row' }, h('button', { class: 'btn quiet-dng', onClick: async () => { const ok = await dialog({ title: `Delete trade ${t.id} (${sym})?`, danger: true, ok: 'Delete trade', body: para(`This moves the trade${t.sales.length ? ' and its ' + t.sales.length + ' sale(s)' : ''} to the Trash for 15 days. Capital and statistics change. You can restore it from the Trash (Import / Export).`, '') }); if (!ok) return; const r = ctx.act((d) => A.deleteTrade(d, t.id), { label: 'delete trade', now: true }); if (r.ok) { closeTopDialog(); toast(`${t.id} moved to the Trash.`, 'Restore', () => ctx.store.undo()); } else toast(r.error); } }, 'Delete…'))),
    onOk: async () => {
      const bdi = parseDMY(bd.value); if (!bdi) return 'Enter a valid buy date (dd-mm-yyyy).';
      const patch = {}; const rows = [];
      const chk = (k, v, before, fmtf) => { if (v !== before) { patch[k] = v; rows.push(Object.assign([k === 'qty' ? 'Quantity' : k === 'buyPrice' ? 'Buy price' : k === 'buyCommission' ? 'Buy commission' : 'Buy date', fmtf(before), fmtf(v)], { changed: true })); } };
      const raw = (x) => x.value.trim();
      const norm = (x) => (raw(x) === '' ? '' : D.parse(raw(x)) === null ? 'bad' : D.toStr(D.parse(raw(x))));
      if ([q, bp].some((x) => norm(x) === '' || norm(x) === 'bad') || norm(bc) === 'bad' || norm(is) === 'bad') return 'Check the numbers: quantity and buy price must be numbers above 0.';
      chk('qty', norm(q), t.qty, (v) => qtyTxt(D.d(v))); chk('buyPrice', norm(bp), t.buyPrice, (v) => priceTxt(D.d(v))); chk('buyCommission', norm(bc), t.buyCommission, (v) => (v === '' ? '–' : money(D.d(v)))); chk('buyDate', bdi, t.buyDate, dmy);
      const isNew = norm(is); const isChange = isNew !== t.initialStop;
      // buy data first (checks quantity), on a copy to show the effect
      if (rows.length) {
        const trial = structuredClone(st); const r = A.editBuyData(trial, t.id, patch);
        if (!r.ok && r.quantity) { await dialog({ title: `${sym}: ${qtyTxt(r.quantity.bought)} is less than the ${qtyTxt(r.quantity.sold)} shares already sold`, danger: true, info: true, ok: 'OK', body: h('div', null, para('Bought must equal sold plus still open.'), changeTable([['Bought (new value)', '', qtyTxt(r.quantity.bought)], ['Sold', '', qtyTxt(r.quantity.sold)], Object.assign(['Missing', '', '−' + qtyTxt(r.quantity.missing)], { changed: true })], ['Part', '', 'Shares']), h('div', { class: 'msg info', style: { marginTop: '8px' } }, '● Nothing was changed. Correct the sold quantity first, or enter a quantity of at least ' + qtyTxt(r.quantity.sold) + '.')) }); return false; }
        if (!r.ok) return r.error;
        const tt = A.tradeById(trial, t.id);
        const ok = await dialog({ title: `Change the buy data of ${sym}?`, ok: 'Save changes', body: h('div', null, para('Capital at open is recalculated for this trade.'), changeTable([...rows, Object.assign(['Capital at open', money(num(t.capitalAtOpen)), money(C.capitalBefore(trial, tt.buyDate, tt.seq))], { changed: true })])) });
        if (!ok) return false;
      }
      if (isChange) {
        if (isNew === '') return 'To remove the Initial stop, leave it as it is. A stop can be corrected, not removed.';
        const trial = structuredClone(st); const r = A.correctInitialStop(trial, t.id, isNew); if (!r.ok) return r.error;
        const t2 = A.tradeById(trial, t.id); const before = C.riskOfQty(t, C.openQty(t) + C.soldQty(t));
        const ok = await dialog({ title: `Correct the Initial stop of ${sym} from ${t.initialStop ? priceTxt(D.d(t.initialStop)) : '–'} to ${priceTxt(D.d(isNew))}?`, ok: 'Correct stop', body: h('div', null, para('The Initial stop is used for R and risk, so it normally never changes. This correction is written to the log.'), changeTable([Object.assign(['Initial stop', t.initialStop ? priceTxt(D.d(t.initialStop)) : '–', priceTxt(D.d(isNew))], { changed: true }), Object.assign(['Risk at Initial stop', before === null ? '–' : '−' + money(before), '−' + money(C.riskOfQty(t2, D.d(t2.qty)))], { changed: true })])) });
        if (!ok) return false;
      }
      const diffsBefore = new Set(A.capitalDiffs(ctx.store.state).map((x) => x.id + ':' + x.after));
      const res = ctx.act((d) => {
        if (rows.length) { const r = A.editBuyData(d, t.id, patch); if (!r.ok) return r; }
        if (isChange) { const r = A.correctInitialStop(d, t.id, isNew); if (!r.ok) return r; }
        const x = A.tradeById(d, t.id); x.setupId = resolveNew(d, 'setups', setup.value); x.errorId = resolveNew(d, 'errors', err.value); x.comment = com.value; return { ok: true };
      }, { label: 'edit ' + sym, now: true });
      if (!res.ok) return res.error;
      // review fix 2026-11-09: never recalculate other trades silently — ask (D2), and only when this edit created new differences
      if (rows.length && A.capitalDiffs(ctx.store.state).some((x) => !diffsBefore.has(x.id + ':' + x.after))) setTimeout(() => askRecalc(ctx), 0);
      return true;
    } });
}
