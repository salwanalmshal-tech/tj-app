import { h, dialog, para, toast, money, signed, pctTxt, qtyTxt, priceTxt, numClass, dmy, field, changeTable, datePicker, infoBtn } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';
import * as A from '../actions.js';
import { parseDMY, todayISO } from '../dates.js';

const usd = (a) => (a === null || a === undefined ? '–' : (a < 0n ? '−$' : '$') + money(D.abs(a)));
const susd = (a) => (a === null || a === undefined ? '–' : (a > 0n ? '+$' : a < 0n ? '−$' : '$') + money(D.abs(a)));

// After a capital change: if the saved capital at open of some trades no longer matches, ask (D2: never silent).
export async function askRecalc(ctx) {
  const diffs = A.capitalDiffs(ctx.store.state); if (!diffs.length) return;
  const ok = await dialog({ title: `Recalculate the capital at open of ${diffs.length} trade${diffs.length === 1 ? '' : 's'}?`, wide: true, ok: 'Recalculate', cancel: 'Keep old values',
    body: h('div', null, para('These trades were opened after the date of your change. Recalculating changes their position size %, risk % and result % of capital. Keeping the old values leaves them as they are.'),
      changeTable(diffs.map((x) => Object.assign([x.id + ' ' + x.symbol, money(D.d(x.before)), money(D.d(x.after))], { changed: true })), ['Trade', 'Capital at open now', 'Recalculated'])) });
  if (ok) ctx.act((d) => A.recalcCapital(d), { label: 'capital at open', now: true });
}

export function render(ctx) {
  const st = ctx.store.state; const start = st.capital.start; const today = ctx.today();
  const wrap = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  const nm = (v, label) => h('input', { value: v, inputmode: 'decimal', style: { textAlign: 'right' }, 'aria-label': label, autocomplete: 'off', placeholder: '0,00' });
  const errBox = () => h('div', { class: 'msg bad', role: 'alert', hidden: true });
  const fail = (box, t) => { box.textContent = '■ ' + t; box.hidden = false; };
  const capNow = C.capitalNow(st);

  // ---- start capital (Q2): a form until it is set, then one listed line with Edit ----
  async function editStart() {
    const sa = nm(D.edit(D.d(start.amount)), 'Start capital'), sd = datePicker({ iso: start.date, label: 'Start date' });
    await dialog({ title: 'Change the start capital', ok: 'Next', body: h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr' } }, field('Start capital (USD)', sa), field('Start date', sd)),
      onOk: async () => {
        const iso = sd.getISO(); if (!iso) return 'Enter a valid start date (dd-mm-yyyy).';
        const trial = structuredClone(st); const r = A.setStartCapital(trial, { amount: sa.value, date: iso }); if (!r.ok) return r.error;
        const ok = await dialog({ title: 'Change the start capital?', ok: 'Change', body: changeTable([Object.assign(['Start capital', usd(D.d(start.amount)), usd(D.parse(sa.value))], { changed: D.parse(sa.value) !== D.d(start.amount) }), Object.assign(['Start date', dmy(start.date), dmy(iso)], { changed: iso !== start.date }), ['Capital (closed trades)', usd(C.capitalNow(st)), usd(C.capitalNow(trial))]]) });
        if (!ok) return false;
        const res = ctx.act((d) => A.setStartCapital(d, { amount: sa.value, date: iso }), { label: 'start capital', now: true });
        if (!res.ok) return res.error;
        setTimeout(() => askRecalc(ctx), 0); toast('Start capital changed.'); return true;
      } });
  }
  if (!start) {
    const sa = nm('', 'Start capital'), sd = datePicker({ iso: '', label: 'Start date' }); const smsg = errBox();
    const saveStart = async () => {
      smsg.hidden = true; const iso = sd.getISO();
      if (!iso) return fail(smsg, 'Enter a valid start date (dd-mm-yyyy).');
      const trial = structuredClone(st); const r = A.setStartCapital(trial, { amount: sa.value, date: iso }); if (!r.ok) return fail(smsg, r.error);
      const ok = await dialog({ title: 'Set your start capital?', ok: 'Save start capital', body: h('dl', { class: 'kv' }, h('dt', null, 'Start capital'), h('dd', null, usd(D.parse(sa.value))), h('dt', null, 'Start date'), h('dd', null, dmy(iso))) });
      if (!ok) return;
      const res = ctx.act((d) => { const x = A.setStartCapital(d, { amount: sa.value, date: iso }); if (x.ok) A.recalcCapital(d); return x; }, { label: 'start capital', now: true });
      if (!res.ok) return fail(smsg, res.error);
      toast('Start capital saved.'); if (ctx.params.first) ctx.go('open');
    };
    wrap.append(h('section', { class: 'panel' }, h('div', { class: 'ph' }, ctx.params.first ? 'Welcome: set your start capital' : 'Start capital', h('span', { class: 'sub' }, 'the program never uses a fixed number')),
      h('div', { class: 'pb', style: { display: 'grid', gap: '10px' } }, para('Enter the amount in your account on the day you start using this journal. Everything else (position size, risk %) is calculated from it.', ''),
        h('div', { class: 'row', style: { alignItems: 'flex-end' } }, field('Start capital (USD)', sa), field('Start date', sd), h('button', { class: 'btn pri', disabled: ctx.readOnly, onClick: saveStart }, 'Save…')), smsg)));
    return wrap;
  }

  // ---- Capital (closed trades) and what it is made of (Q8: one capital number + its parts) ----
  let deps = 0n, wds = 0n, divT = 0n, sales = 0n;
  for (const e of C.capitalEvents(st)) { if (e.kind === 'deposit') deps += e.amount; else if (e.kind === 'withdrawal') wds += e.amount; else if (e.kind === 'dividend') divT += e.amount; else if (e.kind === 'sale') sales += e.amount; }
  const part = (label, v, cls) => h('div', null, h('dt', null, label), h('dd', { class: cls || '' }, v));
  wrap.append(h('section', { class: 'card acc', 'aria-label': 'Capital (closed trades)' }, h('div', { class: 'card-b', style: { display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) minmax(0,2fr)', gap: '28px', alignItems: 'center', paddingTop: '22px' } },
    h('div', null, h('div', { class: 'eyebrow' }, 'Capital (closed trades)', infoBtn('Capital (closed trades)', 'Start capital + deposits − withdrawals + dividends + net result of every sale. Open positions are not included.')), h('div', { style: { fontSize: '30px', fontWeight: 800, letterSpacing: '-.02em', marginTop: '6px' } }, usd(capNow))),
    h('dl', { class: 'facts', style: { margin: 0 } }, part('Start capital · ' + dmy(start.date), usd(D.d(start.amount))), part('Deposits', susd(deps), deps ? 'pos' : ''), part('Withdrawals', susd(wds), wds ? 'neg' : ''), part('Dividends', susd(divT), divT ? 'pos' : ''), part('Net result of sales', susd(sales), numClass(sales))))));

  wrap.append(h('section', { class: 'panel' }, h('div', { class: 'ph' }, 'Start capital', h('span', { class: 'sub' }, 'the program never uses a fixed number')),
    h('div', { class: 'tw', style: { padding: '8px 22px 18px' } }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Start date'), h('th', { class: 'r' }, 'Amount'), h('th'))),
      h('tbody', null, h('tr', null, h('td', null, dmy(start.date)), h('td', { class: 'r' }, usd(D.d(start.amount))), h('td', { class: 'r' }, h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: editStart }, 'Edit…'))))))));

  // ---- deposits / withdrawals (Q3: fill → confirm with capital before → after → listed, fields emptied) ----
  const fd = datePicker({ iso: today, label: 'Date' }), ft = h('select', { 'aria-label': 'Type' }, h('option', { value: 'deposit' }, 'Deposit'), h('option', { value: 'withdrawal' }, 'Withdrawal')), fa = nm('', 'Amount'); const fmsg = errBox();
  const addFlow = async () => {
    fmsg.hidden = true; const iso = fd.getISO(); if (!iso) return fail(fmsg, 'Enter a valid date (dd-mm-yyyy).');
    const f = { date: iso, type: ft.value, amount: fa.value };
    const trial = structuredClone(st); const r = A.addFlow(trial, f); if (!r.ok) return fail(fmsg, r.error);
    const word = f.type === 'deposit' ? 'Deposit' : 'Withdrawal'; const amt = D.parse(f.amount);
    const ok = await dialog({ title: `Add a ${word.toLowerCase()} of ${usd(amt)} on ${dmy(iso)}?`, ok: 'Add ' + word.toLowerCase(),
      body: h('div', null, changeTable([['Capital (closed trades)', usd(capNow), usd(C.capitalNow(trial))], Object.assign([word, '', (f.type === 'deposit' ? '+' : '−') + usd(amt)], { changed: true })], ['', 'Before', 'After']),
        h('p', { class: 'note', style: { marginTop: '8px' } }, 'Deposits and withdrawals change capital only, never win/loss or statistics.')) });
    if (!ok) return;
    const res = ctx.act((d) => A.addFlow(d, f), { label: word.toLowerCase(), now: true });
    if (!res.ok) return fail(fmsg, res.error);
    toast(word + ' added.', 'Undo', () => ctx.store.undo()); setTimeout(() => askRecalc(ctx), 0);
  };
  const flows = st.capital.flows.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  const delFlow = async (f) => {
    const ok = await dialog({ title: `Delete the ${f.type} of ${usd(D.d(f.amount))} on ${dmy(f.date)}?`, ok: 'Delete', danger: true, body: para('It moves to the Trash for 15 days. Capital changes.', '') }); if (!ok) return;
    const r = ctx.act((d) => A.deleteFlow(d, f.id), { label: 'delete line', now: true });
    if (r.ok) { toast('Moved to the Trash.', 'Restore', () => ctx.store.undo()); setTimeout(() => askRecalc(ctx), 0); } else toast(r.error);
  };
  wrap.append(h('section', { class: 'panel' }, h('div', { class: 'ph' }, 'Deposits and withdrawals', h('span', { class: 'sub' }, 'change capital only')),
    h('div', { class: 'pb', style: { display: 'grid', gap: '8px' } }, h('div', { class: 'row', style: { alignItems: 'flex-end' } }, field('Date', fd), field('Type', ft), field('Amount (USD)', fa), h('button', { class: 'btn pri', disabled: ctx.readOnly, onClick: addFlow }, 'Add…')), fmsg),
    flows.length ? h('div', { class: 'tw', style: { padding: '0 22px 18px' } }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Type'), h('th', { class: 'r' }, 'Amount'), h('th'))), h('tbody', null, flows.map((f) => h('tr', null, h('td', null, dmy(f.date)), h('td', null, f.type === 'deposit' ? 'Deposit' : 'Withdrawal'), h('td', { class: 'r ' + (f.type === 'deposit' ? 'pos' : 'neg') }, (f.type === 'deposit' ? '+' : '−') + usd(D.d(f.amount))),
      h('td', { class: 'r' }, h('button', { class: 'btn sm quiet-dng', disabled: ctx.readOnly, onClick: () => delFlow(f) }, 'Delete…'))))))) : h('div', { class: 'pb note' }, 'No deposits or withdrawals yet.')));

  // ---- dividends (Q3 with the duplicate warning of D4) ----
  const ds = h('select', { 'aria-label': 'Stock' }, st.stocks.filter((s) => !s.archived).map((s) => h('option', { value: s.id }, s.symbol))), dd = datePicker({ iso: today, label: 'Pay date' }), da = nm('', 'Net amount'); const dmsg = errBox();
  const addDiv = async () => {
    dmsg.hidden = true; const iso = dd.getISO(); if (!iso) return fail(dmsg, 'Enter a valid pay date (dd-mm-yyyy).');
    const v = { stockId: ds.value, payDate: iso, amount: da.value };
    const trial = structuredClone(st); const r = A.addDividend(trial, v); if (!r.ok) return fail(dmsg, r.error);
    const sym = A.stockById(st, v.stockId)?.symbol ?? '?'; const amt = D.parse(v.amount);
    const dup = st.dividends.find((x) => x.stockId === v.stockId && x.payDate === iso);
    const ok = await dialog({ title: `Add a dividend of ${usd(amt)} from ${sym} on ${dmy(iso)}?`, ok: 'Add dividend',
      body: h('div', null, dup ? h('div', { class: 'msg warn', style: { marginBottom: '8px' } }, `◆ ${sym} already has a dividend of ${usd(D.d(dup.amount))} on ${dmy(iso)}. Check that this is not the same one.`) : null,
        changeTable([['Capital (closed trades)', usd(capNow), usd(C.capitalNow(trial))], Object.assign(['Dividend ' + sym, '', '+' + usd(amt)], { changed: true })], ['', 'Before', 'After']),
        h('p', { class: 'note', style: { marginTop: '8px' } }, 'Net amount in USD. Dividends add to capital on the pay date, never to win/loss.')) });
    if (!ok) return;
    const res = ctx.act((d) => A.addDividend(d, v), { label: 'dividend', now: true });
    if (!res.ok) return fail(dmsg, res.error);
    toast('Dividend added.', 'Undo', () => ctx.store.undo()); setTimeout(() => askRecalc(ctx), 0);
  };
  const delDiv = async (x) => {
    const sym = A.stockById(st, x.stockId)?.symbol ?? '?';
    const ok = await dialog({ title: `Delete the ${sym} dividend of ${usd(D.d(x.amount))}?`, ok: 'Delete', danger: true, body: para('It moves to the Trash for 15 days. Capital changes.', '') }); if (!ok) return;
    const r = ctx.act((d) => A.deleteDividend(d, x.id), { label: 'delete dividend', now: true });
    if (r.ok) { toast('Dividend moved to the Trash.', 'Restore', () => ctx.store.undo()); setTimeout(() => askRecalc(ctx), 0); } else toast(r.error);
  };
  const divs = st.dividends.slice().sort((a, b) => (a.payDate < b.payDate ? 1 : -1));
  wrap.append(h('section', { class: 'panel' }, h('div', { class: 'ph' }, 'Dividends', h('span', { class: 'sub' }, 'net amount received; adds to capital')),
    h('div', { class: 'pb', style: { display: 'grid', gap: '8px' } }, st.stocks.length ? h('div', { class: 'row', style: { alignItems: 'flex-end' } }, field('Stock', ds), field('Pay date', dd), field('Net amount (USD)', da), h('button', { class: 'btn pri', disabled: ctx.readOnly, onClick: addDiv }, 'Add…')) : h('p', { class: 'note' }, 'Add a stock first (open a trade, or use Lists).'), dmsg),
    divs.length ? h('div', { class: 'tw', style: { padding: '0 22px 18px' } }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Pay date'), h('th', null, 'Stock'), h('th', { class: 'r' }, 'Net amount'), h('th'))), h('tbody', null, divs.map((x) => h('tr', null, h('td', null, dmy(x.payDate)), h('td', { class: 'mono' }, A.stockById(st, x.stockId)?.symbol ?? '?'), h('td', { class: 'r pos' }, '+' + usd(D.d(x.amount))),
      h('td', { class: 'r' }, h('button', { class: 'btn sm quiet-dng', disabled: ctx.readOnly, onClick: () => delDiv(x) }, 'Delete…'))))))) : null));

  // ---- recalculation of capital at open (only when something differs) ----
  const diffs = A.capitalDiffs(st);
  if (diffs.length) wrap.append(h('div', { class: 'msg warn', role: 'status' }, `◆ The capital at open of ${diffs.length} trade${diffs.length === 1 ? '' : 's'} no longer matches your capital history. `, h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: async () => { const ok = await dialog({ title: 'Recalculate capital at open?', wide: true, ok: 'Recalculate', body: changeTable(diffs.map((x) => Object.assign([x.id + ' ' + x.symbol, money(D.d(x.before)), money(D.d(x.after))], { changed: true }))) }); if (ok) ctx.act((d) => A.recalcCapital(d), { label: 'capital at open', now: true }); } }, 'Review…')));

  // ---- stock split ----
  wrap.append(splitPanel(ctx));
  return wrap;
}

function splitPanel(ctx) {
  const st = ctx.store.state; const withOpen = st.stocks.filter((s) => st.trades.some((t) => t.stockId === s.id && C.openQty(t) > 0n));
  const sel = h('select', { 'aria-label': 'Stock' }, withOpen.map((s) => h('option', { value: s.id }, s.symbol))), rn = h('input', { value: '2', style: { width: '60px', textAlign: 'right' }, 'aria-label': 'New shares' }), ro = h('input', { value: '1', style: { width: '60px', textAlign: 'right' }, 'aria-label': 'Old shares' }), date = datePicker({ iso: ctx.today(), label: 'Split date' });
  return h('section', { class: 'panel' }, h('div', { class: 'ph' }, 'Stock split', h('span', { class: 'sub' }, 'changes quantity and prices of open trades')),
    h('div', { class: 'pb', style: { display: 'grid', gap: '8px' } }, withOpen.length ? h('div', { class: 'row', style: { alignItems: 'flex-end' } }, field('Stock', sel), field('New shares', rn), field('for old shares', ro), field('Split date', date),
      h('button', { class: 'btn', disabled: ctx.readOnly, onClick: async () => {
        const iso = parseDMY(date.value); if (!iso) return toast('Enter a valid split date (dd-mm-yyyy).');
        const p = A.splitPreview(st, sel.value, rn.value, ro.value, iso); if (!p.ok) return toast(p.error); if (!p.data.rows.length) return toast('This stock has no open trades to convert.');
        const sym = A.stockById(st, sel.value).symbol;
        const ok = await dialog({ title: `Apply the ${rn.value}:${ro.value} split of ${sym}?`, wide: true, ok: 'Apply split', body: h('div', null, para('Open trades are converted, including the sold part of partly sold trades, so quantities and prices stay consistent. Results and R do not change.'),
          changeTable(p.data.rows.flatMap((r) => [Object.assign([`${r.trade.id} quantity`, qtyTxt(r.qtyBefore), qtyTxt(r.qtyAfter)], { changed: true }), Object.assign([`${r.trade.id} buy price`, priceTxt(r.priceBefore), priceTxt(r.priceAfter)], { changed: true })]))) });
        if (ok) { const r = ctx.act((d) => A.applySplit(d, sel.value, rn.value, ro.value, iso), { label: 'split ' + sym, now: true }); toast(r.ok ? `${sym} split applied.` : r.error); } } }, 'Preview split…'))
      : h('p', { class: 'note' }, 'No stock with open trades.')));
}
