import { h, dialog, para, toast, money, signed, pctTxt, qtyTxt, priceTxt, numClass, dmy, num, field, changeTable, infoBtn } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';
import * as A from '../actions.js';
import { parseDMY, weekdayName, isWeekend } from '../dates.js';

const sel = (items, value, { blank = '–' } = {}) => h('select', null, h('option', { value: '' }, blank), items.map((x) => h('option', { value: x.id, selected: x.id === value }, x.name ?? x.symbol)));
const dateInput = (iso, label) => { const i = h('input', { value: iso ? dmy(iso) : '', placeholder: 'dd-mm-yyyy', inputmode: 'numeric', 'aria-label': label }); return i; };
const numInput = (v = '', label) => h('input', { value: v, inputmode: 'decimal', style: { textAlign: 'right' }, 'aria-label': label, autocomplete: 'off' });
const back = (ctx) => ctx.go('open');

// =====================================================================  OPEN TRADE
export function renderOpen(ctx) {
  const st = ctx.store.state; const today = ctx.today();
  const sym = h('input', { 'aria-label': 'Symbol', list: 'stocklist', autocomplete: 'off', style: { textTransform: 'uppercase' } });
  const dl = h('datalist', { id: 'stocklist' }, st.stocks.filter((s) => !s.archived).map((s) => h('option', { value: s.symbol })));
  const bd = dateInput(today, 'Buy date'), qty = numInput('', 'Quantity'), bp = numInput('', 'Buy price'), bc = numInput('', 'Buy commission'), is = numInput('', 'Initial stop');
  const cs = numInput('', 'Current stop'), last = numInput('', 'Last price'), hi = numInput('', 'Highest price'), ema = numInput('', 'EMA10'), nr = dateInput('', 'Next report');
  const setup = sel(st.setups.filter((x) => !x.archived), null), err = sel(st.errors.filter((x) => !x.archived), null), com = h('textarea', { rows: 2, 'aria-label': 'Comment' });
  const sector = h('input', { 'aria-label': 'Sector' }), industry = h('input', { 'aria-label': 'Industry' }), exch = h('input', { 'aria-label': 'Exchange' });
  const newStock = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', display: 'none' } }, field('Sector', sector), field('Industry', industry), field('Exchange', exch));
  const problems = h('div', { class: 'msg bad', role: 'alert', style: { display: 'none' } }); const warns = h('div', { style: { display: 'grid', gap: '6px' } });
  const prev = h('div'); const dnote = h('span', { class: 'note' });
  const btn = h('button', { class: 'btn pri', disabled: true, onClick: submit }, 'Open trade…');

  function values() {
    const iso = parseDMY(bd.value);
    return { symbol: sym.value.trim(), buyDate: iso, qty: qty.value, buyPrice: bp.value, buyCommission: bc.value, initialStop: is.value, currentStop: cs.value, last: last.value, highest: hi.value, ema10: ema.value, nextReport: nr.value.trim() ? parseDMY(nr.value) : '', setupId: setup.value || null, errorId: err.value || null, comment: com.value, stockInfo: { sector: sector.value, industry: industry.value, exchange: exch.value } };
  }
  function update() {
    const f = values();
    const iso = f.buyDate; dnote.textContent = iso ? weekdayName(iso) + (isWeekend(iso) ? ' (weekend)' : '') : (bd.value ? 'Not a valid date' : '');
    const isNew = f.symbol && !A.findStock(st, f.symbol); newStock.style.display = isNew ? 'grid' : 'none';
    const v = A.validateOpen(st, f);
    const extra = []; if (nr.value.trim() && !f.nextReport) extra.push('Next report is not a valid date (dd-mm-yyyy).');
    for (const [x, name] of [[hi, 'Highest price'], [ema, 'EMA10'], [cs, 'Current stop'], [last, 'Last price']]) if (x.value.trim() && D.parse(x.value) === null) extra.push(name + ' must be a number.');
    const errs = [...v.errors, ...extra];
    const touched = f.symbol || qty.value || bp.value;
    problems.style.display = touched && errs.length ? 'flex' : 'none'; problems.textContent = errs.length ? '■ ' + errs.join(' ') : '';
    warns.replaceChildren(...(touched ? v.warnings : []).map((w) => h('div', { class: 'msg warn', role: 'status' }, '◆ ' + w)));
    btn.disabled = ctx.readOnly || errs.length > 0;
    // preview
    const q = D.parse(qty.value), p = D.parse(bp.value), stop = D.parse(is.value);
    const rows = [];
    if (q !== null && p !== null && q > 0n && p > 0n) {
      const value = D.mul(q, p); const cap = st.capital.start && iso ? C.capitalBefore(st, iso, Infinity) : null;
      rows.push(['Position value', money(value)]);
      if (cap && cap > 0n) rows.push(['Capital at this date', money(cap)], ['Position size', pctTxt(D.pct(value, cap), 1) + ' of capital']);
      if (stop !== null && stop < p) { const risk = D.mul(D.sub(p, stop), q); rows.push(['Risk at Initial stop', '−' + money(risk) + (cap && cap > 0n ? ` (${pctTxt(D.pct(risk, cap))} of capital)` : '')]); }
    }
    prev.replaceChildren(rows.length ? h('dl', { class: 'kv' }, rows.flatMap(([k, v2]) => [h('dt', null, k), h('dd', null, v2)])) : h('p', { class: 'note' }, 'Fill in quantity and buy price to see the numbers.'));
  }
  async function submit() {
    const f = values(); const v = A.validateOpen(st, f); if (v.errors.length) return update();
    const q = D.d(f.qty), p = D.d(f.buyPrice);
    const ok = await dialog({ title: `Open ${f.symbol.toUpperCase()}: ${qtyTxt(q)} shares at ${priceTxt(p)}?`, ok: 'Open trade', body: h('div', null, v.warnings.map((w) => h('div', { class: 'msg warn', style: { marginBottom: '6px' } }, '◆ ' + w)),
      h('dl', { class: 'kv' }, h('dt', null, 'Buy date'), h('dd', null, dmy(f.buyDate)), h('dt', null, 'Position value'), h('dd', null, money(D.mul(q, p))), h('dt', null, 'Initial stop'), h('dd', null, f.initialStop ? priceTxt(D.parse(f.initialStop)) : 'none (No SL)'))) });
    if (!ok) return;
    const res = ctx.act((d) => A.openTrade(d, f), { label: 'open trade', now: true });
    if (!res.ok) return toast(res.error);
    toast(`${f.symbol.toUpperCase()} opened as ${res.data.id}.`); back(ctx);
  }
  for (const x of [sym, bd, qty, bp, bc, is, cs, last, hi, ema, nr, setup, err, com, sector, industry, exch]) x.addEventListener('input', update);
  setTimeout(update, 0); setTimeout(() => sym.focus(), 0);
  const more = h('details', null, h('summary', { style: { cursor: 'pointer', color: 'var(--accent)' } }, 'More fields (current stop, last price, highest, EMA10)'),
    h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', marginTop: '8px' } }, field('Current stop', cs, 'Empty = same as Initial stop'), field('Last price', last, 'Empty = buy price'), field('Highest price', hi, 'Empty = buy price'), field('EMA10', ema)));
  return h('div', { class: 'cols' },
    h('section', { class: 'panel', style: { flex: '1 1 560px' } }, h('div', { class: 'ph' }, 'New trade', h('span', { class: 'sub' }, 'one buy line = one trade')),
      h('div', { class: 'pb', style: { display: 'grid', gap: '12px' } }, dl,
        h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', alignItems: 'start' } }, field('Symbol', sym), field('Buy date', bd, dnote), field('Quantity', qty), field('Buy price (USD)', bp), field('Buy commission (USD)', bc), field('Initial stop', is, 'Must be below the buy price'), field('Next report', nr)),
        newStock, h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' } }, field('Setup', setup), field('Error', err)), field('Comment', com), more, problems, warns,
        h('div', { class: 'row' }, btn, h('button', { class: 'btn', onClick: () => back(ctx) }, 'Cancel')))),
    h('aside', { class: 'panel', style: { flex: '1 1 280px', maxWidth: '420px' }, 'aria-label': 'Preview' }, h('div', { class: 'ph' }, 'Numbers for this trade'), h('div', { class: 'pb' }, prev)));
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

  function lines() { return (bySym.get(symSel.value) || []).slice().sort((a, b) => (a.buyDate < b.buyDate ? -1 : a.seq - b.seq)); }
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
    if (!valid && reason && ok === false && assigned > 0n) { /* keep quiet until complete */ }
    ctx._closeAlloc = allocations;
  }
  async function submit() {
    const iso = parseDMY(date.value); const allocations = ctx._closeAlloc;
    const draft = structuredClone(st); const res0 = A.closeSale(draft, { date: iso, price: price.value, commission: comm.value, allocations }); if (!res0.ok) return toast(res0.error);
    const rows = res0.data.map(({ tradeId, sale }) => { const t0 = A.tradeById(st, tradeId), t1 = A.tradeById(draft, tradeId); return { t0, t1, sale, net: C.salesDetail(t1).find((x) => x.sale.id === sale.id).net }; });
    const sym = A.symbolOf(st, rows[0].t0); const capBefore = C.capitalNow(st), capAfter = C.capitalNow(draft); const net = rows.reduce((a, r) => a + r.net, 0n);
    const tbl = changeTable([...rows.map((r) => Object.assign([`Open shares in ${r.t0.id}`, qtyTxt(C.openQty(r.t0)), qtyTxt(C.openQty(r.t1))], { changed: true })),
      Object.assign(['Net result of this sale', '–', signed(net)], { changed: true }), Object.assign(['Capital (closed trades)', money(capBefore), money(capAfter)], { changed: true }),
      ...rows.filter((r) => C.openQty(r.t1) === 0n).map((r) => ['Trade ' + r.t0.id, 'Open', `Closed · R ${C.rMultiple(r.t1) === null ? '–' : D.fmt(C.rMultiple(r.t1), 2)} · ${C.holdingDays(r.t1)} days`])]);
    const ok = await dialog({ title: `Sell ${qtyTxt(D.parse(total.value))} shares of ${sym}?`, ok: 'Close trade', body: h('div', null, para('The result is calculated with exact numbers.'), tbl) });
    if (!ok) return;
    const res = ctx.act((d) => A.closeSale(d, { date: iso, price: price.value, commission: comm.value, allocations }), { label: 'sale ' + sym, now: true });
    if (!res.ok) return toast(res.error);
    toast(`${sym} sold. Net result ${signed(net)}.`); back(ctx);
  }
  symSel.addEventListener('change', () => { touchedLines = false; total.value = ''; buildLines(false); });
  total.addEventListener('input', () => { touchedLines = false; buildLines(true); });
  for (const x of [date, price, comm]) x.addEventListener('input', () => refresh());
  buildLines(!!startTrade); setTimeout(() => (startTrade ? price : total).focus(), 0);
  return h('div', { class: 'cols' }, h('section', { class: 'panel', style: { flex: '1 1 100%' } },
    h('div', { class: 'ph' }, '1. The sale', h('span', { class: 'sub' }, 'one sale, one price')),
    h('div', { class: 'pb' }, h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', alignItems: 'start' } }, field('Symbol', symSel), field('Total shares sold', total), field('Sell date', date, dnote), field('Sell price (USD)', price), field('Sell commission (USD)', comm))),
    h('div', { class: 'ph', style: { borderTop: '1px solid var(--line)' } }, '2. Choose the lines', status), linesBox,
    h('div', { class: 'pb', style: { display: 'grid', gap: '8px' } }, h('div', { class: 'row' }, btn, h('button', { class: 'btn', onClick: () => back(ctx) }, 'Cancel')), h('span', { class: 'note' }, 'The button stays off until every share is assigned and the price is filled in. It opens a confirmation first.'))),
    h('aside', { class: 'panel', style: { flex: '1 1 100%' }, 'aria-label': 'Preview' }, h('div', { class: 'ph' }, 'Preview before saving'), h('div', { class: 'pb' }, prevBox)));
}

// =====================================================================  EDIT PANEL (opened from Open positions and History)
export function editTrade(ctx, id) {
  const st = ctx.store.state; const t = A.tradeById(st, id); if (!t) return; const sym = A.symbolOf(st, t);
  const q = numInput(D.edit(D.d(t.qty)), 'Quantity'), bp = numInput(D.edit(D.d(t.buyPrice)), 'Buy price'), bc = numInput(t.buyCommission === '' ? '' : D.edit(D.d(t.buyCommission)), 'Buy commission'), bd = dateInput(t.buyDate, 'Buy date');
  const is = numInput(t.initialStop === '' ? '' : D.edit(D.d(t.initialStop)), 'Initial stop');
  const setup = sel(st.setups.filter((x) => !x.archived || x.id === t.setupId), t.setupId), err = sel(st.errors.filter((x) => !x.archived || x.id === t.errorId), t.errorId), com = h('textarea', { rows: 2, 'aria-label': 'Comment' }); com.value = t.comment || '';
  const msg = h('div', { class: 'msg bad', role: 'alert', style: { display: 'none' } });
  const sold = C.soldQty(t);
  dialog({ title: `Edit ${sym} · ${t.id}`, wide: true, ok: 'Save', body: h('div', { style: { display: 'grid', gap: '12px' } },
    sold > 0n ? h('div', { class: 'msg info' }, `● ${qtyTxt(sold)} shares were already sold. Quantity cannot go below that.`) : null,
    h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' } }, field('Buy date', bd), field('Quantity', q), field('Buy price', bp), field('Buy commission', bc), field('Initial stop', is, 'Used for R. Changing it is logged.')),
    h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' } }, field('Setup', setup), field('Error', err)), field('Comment', com), msg,
    h('div', { class: 'row' }, h('button', { class: 'btn quiet-dng', onClick: async () => { const ok = await dialog({ title: `Delete trade ${t.id} (${sym})?`, danger: true, ok: 'Delete trade', body: para(`This moves the trade${t.sales.length ? ' and its ' + t.sales.length + ' sale(s)' : ''} to the Trash for 15 days. Capital and statistics change. You can restore it from the Trash (Import / Export).`, '') }); if (!ok) return; const r = ctx.act((d) => A.deleteTrade(d, t.id), { label: 'delete trade', now: true }); if (r.ok) { document.querySelector('.scrim')?.remove(); toast(`${t.id} moved to the Trash.`, 'Restore', () => ctx.store.undo()); } else toast(r.error); } }, 'Delete…'))),
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
      const res = ctx.act((d) => {
        if (rows.length) { const r = A.editBuyData(d, t.id, patch); if (!r.ok) return r; }
        if (isChange) { const r = A.correctInitialStop(d, t.id, isNew); if (!r.ok) return r; }
        const x = A.tradeById(d, t.id); x.setupId = setup.value || null; x.errorId = err.value || null; x.comment = com.value; return { ok: true };
      }, { label: 'edit ' + sym, now: true });
      if (!res.ok) return res.error;
      if (rows.length || ctx.params) { /* capital at open of other trades may now differ */ const diffs = A.capitalDiffs(ctx.store.state); if (diffs.length) { ctx.act((d) => A.recalcCapital(d), { label: 'capital at open', noUndo: true, now: true }); } }
      return true;
    } });
}
