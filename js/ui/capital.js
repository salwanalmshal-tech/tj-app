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

  // ---- Layout 2026-11-06 (his Capital example): one capital number with its parts, four actions, one activity list ----
  // Rules unchanged: D1 (calculated, closed trades only), Q2 (start capital edited with before → after), Q3 (each change asks
  // first with capital before → after), D2 (Recalculate / Keep old values), D4 (dividend duplicate warning), D5 (split preview).
  let deps = 0n, wds = 0n, divT = 0n, sales = 0n, nSales = 0;
  for (const e of C.capitalEvents(st)) { if (e.kind === 'deposit') deps += e.amount; else if (e.kind === 'withdrawal') wds += e.amount; else if (e.kind === 'dividend') divT += e.amount; else if (e.kind === 'sale') { sales += e.amount; nSales++; } }
  const invested = D.d(start.amount) + deps; const progress = invested > 0n ? D.pct(sales + divT, invested) : null;
  const tone = (v) => (v > 0n ? 'pos' : v < 0n ? 'neg' : '');
  const spct = (v) => (v === null ? '–' : (v > 0n ? '+' : v < 0n ? '−' : '') + D.fmt(D.abs(v), 2) + ' %');

  // hero
  wrap.append(h('section', { class: 'cap-hero' },
    h('div', null,
      h('div', { class: 'eyebrow' }, 'Capital (closed trades)', infoBtn('Capital (closed trades)', 'Start capital + deposits − withdrawals + dividends + net result of every sale. Open positions are not included.')),
      h('div', { class: 'cap-big' }, usd(capNow)),
      h('div', { class: 'cap-start' }, 'Started with ', h('b', null, usd(D.d(start.amount))), ' on ' + dmy(start.date) + ' · ', h('button', { class: 'linkbtn', disabled: ctx.readOnly, onClick: editStart }, 'Edit start capital'))),
    h('div', { class: 'cap-side' },
      h('div', { class: 'cap-res ' + tone(sales) }, h('b', null, susd(sales)), ' from closed trades'),
      h('div', { class: 'cap-res ' + tone(progress ?? 0n) }, h('b', null, spct(progress)), ' on invested capital', infoBtn('On invested capital', '(Net result of sales + dividends) ÷ (start capital + all deposits). Withdrawals are never counted as a loss.')))));

  // the sum: start + deposits/withdrawals + dividends + closed trades = capital
  const term = (icon, label, v, cls = '') => h('div', { class: 'cap-term' }, h('span', { class: 'ci ' + cls }, icon), h('div', null, h('span', null, label), h('b', { class: cls }, v)));
  wrap.append(h('section', { class: 'cap-sum' },
    term('◎', 'Start capital', usd(D.d(start.amount))), h('span', { class: 'op' }, '+'),
    term('⇅', 'Deposits − withdrawals', susd(deps + wds), tone(deps + wds)), h('span', { class: 'op' }, '+'),
    term('$', 'Dividends', susd(divT), tone(divT)), h('span', { class: 'op' }, '+'),
    term('▮', 'Closed trades', susd(sales), tone(sales)), h('span', { class: 'op' }, '='),
    h('div', { class: 'cap-term total' }, h('div', null, h('span', null, 'Capital (closed trades)'), h('b', null, usd(capNow))))));

  // actions
  const act = (icon, cls, title, text, fn, disabled) => h('button', { type: 'button', class: 'cap-act', disabled: ctx.readOnly || disabled, onClick: fn }, h('span', { class: 'ai ' + cls }, icon), h('span', { class: 'at' }, h('b', null, title), h('span', null, text)), h('span', { class: 'chev' }, '›'));
  const hasOpen = st.stocks.some((s) => st.trades.some((t) => t.stockId === s.id && C.openQty(t) > 0n));
  wrap.append(h('div', { class: 'cap-acts' },
    act('+', 'pos', 'Deposit', 'Add money to your capital', () => flowDialog('deposit')),
    act('−', 'neg', 'Withdrawal', 'Money leaving your capital', () => flowDialog('withdrawal')),
    act('$', 'info', 'Dividend', st.stocks.length ? 'Record dividend income' : 'Add a stock in Lists first', () => dividendDialog(), !st.stocks.length),
    act('2:1', 'violet', 'Stock split', hasOpen ? 'Adjust shares of open trades' : 'No stock with open trades', () => splitDialog(ctx), !hasOpen)));

  async function flowDialog(type) {
    const word = type === 'deposit' ? 'Deposit' : 'Withdrawal';
    const fd = datePicker({ iso: today, label: 'Date' }), fa = nm('', 'Amount');
    const f0 = await dialog({ title: word, ok: 'Next', body: h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr' } }, field('Date', fd), field('Amount (USD)', fa)),
      onOk: () => { const iso = fd.getISO(); if (!iso) return 'Enter a valid date (dd-mm-yyyy).'; const r = A.addFlow(structuredClone(st), { date: iso, type, amount: fa.value }); return r.ok ? true : r.error; } });
    if (!f0) return;
    const f = { date: fd.getISO(), type, amount: fa.value }; const trial = structuredClone(st); A.addFlow(trial, f); const amt = D.parse(f.amount);
    const ok = await dialog({ title: `Add a ${word.toLowerCase()} of ${usd(amt)} on ${dmy(f.date)}?`, ok: 'Add ' + word.toLowerCase(),
      body: h('div', null, changeTable([['Capital (closed trades)', usd(capNow), usd(C.capitalNow(trial))], Object.assign([word, '', (type === 'deposit' ? '+' : '−') + usd(amt)], { changed: true })], ['', 'Before', 'After']),
        h('p', { class: 'note', style: { marginTop: '8px' } }, 'Deposits and withdrawals change capital only, never win/loss or statistics.')) });
    if (!ok) return;
    const res = ctx.act((d) => A.addFlow(d, f), { label: word.toLowerCase(), now: true });
    if (!res.ok) return toast(res.error);
    toast(word + ' added.', 'Undo', () => ctx.store.undo()); setTimeout(() => askRecalc(ctx), 0);
  }
  async function dividendDialog() {
    const ds = h('select', { 'aria-label': 'Stock' }, st.stocks.filter((s) => !s.archived).map((s) => h('option', { value: s.id }, s.symbol))), dd = datePicker({ iso: today, label: 'Pay date' }), da = nm('', 'Net amount');
    const f0 = await dialog({ title: 'Dividend', ok: 'Next', body: h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 1fr 1fr' } }, field('Stock', ds), field('Pay date', dd), field('Net amount (USD)', da)),
      onOk: () => { const iso = dd.getISO(); if (!iso) return 'Enter a valid pay date (dd-mm-yyyy).'; const r = A.addDividend(structuredClone(st), { stockId: ds.value, payDate: iso, amount: da.value }); return r.ok ? true : r.error; } });
    if (!f0) return;
    const v = { stockId: ds.value, payDate: dd.getISO(), amount: da.value }; const trial = structuredClone(st); A.addDividend(trial, v);
    const sym = A.stockById(st, v.stockId)?.symbol ?? '?'; const amt = D.parse(v.amount);
    const dup = st.dividends.find((x) => x.stockId === v.stockId && x.payDate === v.payDate);
    const ok = await dialog({ title: `Add a dividend of ${usd(amt)} from ${sym} on ${dmy(v.payDate)}?`, ok: 'Add dividend',
      body: h('div', null, dup ? h('div', { class: 'msg warn', style: { marginBottom: '8px' } }, `◆ ${sym} already has a dividend of ${usd(D.d(dup.amount))} on ${dmy(v.payDate)}. Check that this is not the same one.`) : null,
        changeTable([['Capital (closed trades)', usd(capNow), usd(C.capitalNow(trial))], Object.assign(['Dividend ' + sym, '', '+' + usd(amt)], { changed: true })], ['', 'Before', 'After']),
        h('p', { class: 'note', style: { marginTop: '8px' } }, 'Net amount in USD. Dividends add to capital on the pay date, never to win/loss.')) });
    if (!ok) return;
    const res = ctx.act((d) => A.addDividend(d, v), { label: 'dividend', now: true });
    if (!res.ok) return toast(res.error);
    toast('Dividend added.', 'Undo', () => ctx.store.undo()); setTimeout(() => askRecalc(ctx), 0);
  }
  const delFlow = async (f) => {
    const ok = await dialog({ title: `Delete the ${f.type} of ${usd(D.d(f.amount))} on ${dmy(f.date)}?`, ok: 'Delete', danger: true, body: para('It moves to the Trash for 15 days. Capital changes.', '') }); if (!ok) return;
    const r = ctx.act((d) => A.deleteFlow(d, f.id), { label: 'delete line', now: true });
    if (r.ok) { toast('Moved to the Trash.', 'Restore', () => ctx.store.undo()); setTimeout(() => askRecalc(ctx), 0); } else toast(r.error);
  };
  const delDiv = async (x) => {
    const sym = A.stockById(st, x.stockId)?.symbol ?? '?';
    const ok = await dialog({ title: `Delete the ${sym} dividend of ${usd(D.d(x.amount))}?`, ok: 'Delete', danger: true, body: para('It moves to the Trash for 15 days. Capital changes.', '') }); if (!ok) return;
    const r = ctx.act((d) => A.deleteDividend(d, x.id), { label: 'delete dividend', now: true });
    if (r.ok) { toast('Dividend moved to the Trash.', 'Restore', () => ctx.store.undo()); setTimeout(() => askRecalc(ctx), 0); } else toast(r.error);
  };

  // activity (newest first) + breakdown
  const ev = [];
  ev.push({ date: start.date, icon: '⚑', cls: 'info', kind: 'start', event: 'Start capital', details: 'Account baseline', amount: usd(D.d(start.amount)), act: h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: editStart }, 'Edit…') });
  for (const f of st.capital.flows) ev.push({ date: f.date, icon: f.type === 'deposit' ? '+' : '−', cls: f.type === 'deposit' ? 'pos' : 'neg', kind: 'flow', event: f.type === 'deposit' ? 'Deposit' : 'Withdrawal', details: 'Changes capital only', amount: (f.type === 'deposit' ? '+' : '−') + usd(D.d(f.amount)), tone: f.type === 'deposit' ? 'pos' : 'neg', act: h('button', { class: 'btn sm quiet-dng', disabled: ctx.readOnly, onClick: () => delFlow(f) }, 'Delete…') });
  for (const x of st.dividends) ev.push({ date: x.payDate, icon: '$', cls: 'info', kind: 'div', event: 'Dividend', details: A.stockById(st, x.stockId)?.symbol ?? '?', amount: '+' + usd(D.d(x.amount)), tone: 'pos', act: h('button', { class: 'btn sm quiet-dng', disabled: ctx.readOnly, onClick: () => delDiv(x) }, 'Delete…') });
  ev.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const filt = h('select', { 'aria-label': 'Show' }, h('option', { value: 'all' }, 'All events'), h('option', { value: 'flow' }, 'Deposits and withdrawals'), h('option', { value: 'div' }, 'Dividends'));
  const tbody = h('tbody');
  const fill = () => {
    const f = filt.value; const rows = ev.filter((e) => f === 'all' || e.kind === f);
    const salesRow = f === 'all' ? [h('tr', null, h('td', { class: 'mut' }, 'All sales'), h('td', null, h('span', { class: 'evi ' + (tone(sales) || 'info') }, '▮'), ' Net result of closed trades'), h('td', { class: 'mut' }, `${nSales} sale${nSales === 1 ? '' : 's'}, after commissions`), h('td', { class: 'r ' + tone(sales) }, h('b', null, susd(sales))), h('td'))] : [];
    tbody.replaceChildren(...salesRow, ...rows.map((e) => h('tr', null, h('td', null, dmy(e.date)), h('td', null, h('span', { class: 'evi ' + e.cls }, e.icon), ' ' + e.event), h('td', { class: 'mut' }, e.details), h('td', { class: 'r ' + (e.tone || '') }, h('b', null, e.amount)), h('td', { class: 'r' }, e.act))),
      ...(rows.length ? [] : [h('tr', null, h('td', { colspan: 5, class: 'mut', style: { textAlign: 'center', padding: '18px' } }, 'Nothing recorded yet.'))]));
  };
  filt.addEventListener('change', fill); fill();
  const br = (label, v, cls = '') => h('div', { class: 'brk-row' }, h('span', null, label), h('b', { class: cls }, v));
  wrap.append(h('div', { class: 'cap-grid' },
    h('section', { class: 'scard' }, h('div', { class: 'sch' }, h('h3', null, 'Capital activity'), filt),
      h('div', { class: 'tw' }, h('table', { class: 'cap-table' }, h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Event'), h('th', null, 'Details'), h('th', { class: 'r' }, 'Amount (USD)'), h('th'))), tbody)),
      h('div', { class: 'cap-note' }, 'ⓘ Deposits, withdrawals and dividends change capital only. They never count as win or loss and do not change open positions.')),
    h('section', { class: 'scard' }, h('div', { class: 'sch' }, h('h3', null, 'Breakdown'), h('span', { class: 'stag' }, 'Current')),
      h('div', { class: 'scb brk' }, br('Start capital', usd(D.d(start.amount))), br('Deposits', susd(deps), tone(deps)), br('Withdrawals', susd(wds), tone(wds)), br('Dividends', susd(divT), tone(divT)), br('Closed trades', susd(sales), tone(sales)),
        h('div', { class: 'brk-row total' }, h('span', null, 'Capital (closed trades)'), h('b', null, usd(capNow)))))));

  // ---- recalculation of capital at open (only when something differs) ----
  const diffs = A.capitalDiffs(st);
  if (diffs.length) wrap.append(h('div', { class: 'msg warn', role: 'status' }, `◆ The capital at open of ${diffs.length} trade${diffs.length === 1 ? '' : 's'} no longer matches your capital history. `, h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: async () => { const ok = await dialog({ title: 'Recalculate capital at open?', wide: true, ok: 'Recalculate', body: changeTable(diffs.map((x) => Object.assign([x.id + ' ' + x.symbol, money(D.d(x.before)), money(D.d(x.after))], { changed: true }))) }); if (ok) ctx.act((d) => A.recalcCapital(d), { label: 'capital at open', now: true }); } }, 'Review…')));

  // ---- stock split ----
  return wrap;
}

async function splitDialog(ctx) {
  const st = ctx.store.state; const withOpen = st.stocks.filter((s) => st.trades.some((t) => t.stockId === s.id && C.openQty(t) > 0n));
  const sel = h('select', { 'aria-label': 'Stock' }, withOpen.map((s) => h('option', { value: s.id }, s.symbol))), rn = h('input', { value: '2', style: { textAlign: 'right' }, 'aria-label': 'New shares' }), ro = h('input', { value: '1', style: { textAlign: 'right' }, 'aria-label': 'Old shares' }), date = datePicker({ iso: ctx.today(), label: 'Split date' });
  let p = null;
  const go = await dialog({ title: 'Stock split', ok: 'Preview split', body: h('div', null, para('Changes the quantity and prices of the open trades of this stock. Results and R do not change.', 'note'),
    h('div', { class: 'grid', style: { gridTemplateColumns: '1.2fr 1fr 1fr 1.4fr', marginTop: '8px' } }, field('Stock', sel), field('New shares', rn), field('for old shares', ro), field('Split date', date))),
    onOk: () => { const iso = date.getISO(); if (!iso) return 'Enter a valid split date (dd-mm-yyyy).'; p = A.splitPreview(st, sel.value, rn.value, ro.value, iso); if (!p.ok) return p.error; if (!p.data.rows.length) return 'This stock has no open trades to convert.'; p.iso = iso; return true; } });
  if (!go) return;
  const sym = A.stockById(st, sel.value).symbol;
  const ok = await dialog({ title: `Apply the ${rn.value}:${ro.value} split of ${sym}?`, wide: true, ok: 'Apply split', body: h('div', null, para('Open trades are converted, including the sold part of partly sold trades, so quantities and prices stay consistent. Results and R do not change.'),
    changeTable(p.data.rows.flatMap((r) => [Object.assign([`${r.trade.id} quantity`, qtyTxt(r.qtyBefore), qtyTxt(r.qtyAfter)], { changed: true }), Object.assign([`${r.trade.id} buy price`, priceTxt(r.priceBefore), priceTxt(r.priceAfter)], { changed: true })]))) });
  if (ok) { const r = ctx.act((d) => A.applySplit(d, sel.value, rn.value, ro.value, p.iso), { label: 'split ' + sym, now: true }); toast(r.ok ? `${sym} split applied.` : r.error); }
}
