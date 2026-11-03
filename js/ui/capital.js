import { h, dialog, para, toast, money, signed, pctTxt, qtyTxt, priceTxt, numClass, dmy, field, changeTable, datePicker } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';
import * as A from '../actions.js';
import { parseDMY, todayISO } from '../dates.js';

export function render(ctx) {
  const st = ctx.store.state; const start = st.capital.start; const today = ctx.today();
  const wrap = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
  const nm = (v) => h('input', { value: v, inputmode: 'decimal', style: { textAlign: 'right' } });

  // ---- start capital ----
  const sa = nm(start ? D.edit(D.d(start.amount)) : ''), sd = datePicker({ iso: start ? start.date : '', label: 'Start date' }); const smsg = h('div', { class: 'msg bad', role: 'alert', style: { display: 'none' } });
  const saveStart = async () => {
    const iso = parseDMY(sd.value); smsg.style.display = 'none';
    if (!iso) { smsg.textContent = '■ Enter a valid date (dd-mm-yyyy).'; smsg.style.display = 'flex'; return; }
    const trial = structuredClone(st); const r = A.setStartCapital(trial, { amount: sa.value, date: iso });
    if (!r.ok) { smsg.textContent = '■ ' + r.error; smsg.style.display = 'flex'; return; }
    if (start) { const ok = await dialog({ title: 'Change the start capital?', ok: 'Change', body: changeTable([Object.assign(['Start capital', money(D.d(start.amount)), money(D.parse(sa.value))], { changed: true }), Object.assign(['Start date', dmy(start.date), dmy(iso)], { changed: true }), ['Capital now', money(C.capitalNow(st)), money(C.capitalNow(trial))]]) }); if (!ok) return; }
    const res = ctx.act((d) => { const x = A.setStartCapital(d, { amount: sa.value, date: iso }); if (x.ok) A.recalcCapital(d); return x; }, { label: 'start capital', now: true });
    if (!res.ok) toast(res.error); else { toast('Start capital saved.'); if (ctx.params.first) ctx.go('open'); }
  };
  wrap.append(h('section', { class: 'panel' }, h('div', { class: 'ph' }, ctx.params.first ? 'Welcome: set your start capital' : 'Start capital', h('span', { class: 'sub' }, 'the program never uses a fixed number')),
    h('div', { class: 'pb', style: { display: 'grid', gap: '10px' } }, ctx.params.first ? para('Enter the amount in your account on the day you start using this journal. Everything else (position size, risk %) is calculated from it.', '') : null,
      h('div', { class: 'row', style: { alignItems: 'flex-end' } }, field('Start capital (USD)', sa), field('Start date', sd), h('button', { class: 'btn pri', disabled: ctx.readOnly, onClick: saveStart }, 'Save')), smsg)));
  if (!start) return wrap;

  // ---- numbers ----
  const acc = C.estimatedAccount(st);
  wrap.append(h('div', { class: 'tile-row' }, [['Capital (closed trades)', money(C.capitalNow(st)), 'start + deposits − withdrawals + dividends + sales'], ['Estimated account', money(acc), 'capital + unrealized result of open lines'], ['Invested (deposits)', money(C.invested(st)), 'start capital + deposits']].map(([l, v, d]) => h('div', { class: 'panel tile' }, h('span', { class: 'lab' }, l), h('span', { class: 'v' }, v), h('span', { class: 'd' }, d)))));

  // ---- deposits / withdrawals ----
  const fd = datePicker({ iso: today, label: 'Date' }), ft = h('select', { 'aria-label': 'Type' }, h('option', { value: 'deposit' }, 'Deposit'), h('option', { value: 'withdrawal' }, 'Withdrawal')), fa = nm(''); const fmsg = h('div', { class: 'err', role: 'alert' });
  const addFlow = () => { const iso = parseDMY(fd.value); if (!iso) { fmsg.textContent = 'Enter a valid date (dd-mm-yyyy).'; return; } const r = ctx.act((d) => { const x = A.addFlow(d, { date: iso, type: ft.value, amount: fa.value }); if (x.ok) A.recalcCapital(d); return x; }, { label: ft.value, now: true }); if (!r.ok) fmsg.textContent = r.error; };
  const flows = st.capital.flows.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  wrap.append(h('section', { class: 'panel' }, h('div', { class: 'ph' }, 'Deposits and withdrawals'),
    h('div', { class: 'pb', style: { display: 'grid', gap: '8px' } }, h('div', { class: 'row', style: { alignItems: 'flex-end' } }, field('Date', fd), field('Type', ft), field('Amount (USD)', fa), h('button', { class: 'btn pri', disabled: ctx.readOnly, onClick: addFlow }, 'Add')), fmsg),
    flows.length ? h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Type'), h('th', { class: 'r' }, 'Amount'), h('th'))), h('tbody', null, flows.map((f) => h('tr', null, h('td', null, dmy(f.date)), h('td', null, f.type === 'deposit' ? 'Deposit' : 'Withdrawal'), h('td', { class: 'r ' + (f.type === 'deposit' ? 'pos' : 'neg') }, (f.type === 'deposit' ? '+' : '−') + money(D.d(f.amount))),
      h('td', { class: 'r' }, h('button', { class: 'btn sm quiet-dng', disabled: ctx.readOnly, onClick: () => { const r = ctx.act((d) => { const x = A.deleteFlow(d, f.id); if (x.ok) A.recalcCapital(d); return x; }, { label: 'delete line', now: true }); if (r.ok) toast('Moved to the Trash.', 'Restore', () => ctx.store.undo()); else toast(r.error); } }, 'Delete'))))))) : h('div', { class: 'pb note' }, 'No deposits or withdrawals yet.')));

  // ---- dividends ----
  const ds = h('select', { 'aria-label': 'Stock' }, st.stocks.filter((s) => !s.archived).map((s) => h('option', { value: s.id }, s.symbol))), dd = datePicker({ iso: today, label: 'Pay date' }), da = nm(''); const dmsg = h('div', { class: 'err', role: 'alert' });
  const addDiv = () => { const iso = parseDMY(dd.value); if (!iso) { dmsg.textContent = 'Enter a valid pay date (dd-mm-yyyy).'; return; } const r = ctx.act((d) => { const x = A.addDividend(d, { stockId: ds.value, payDate: iso, amount: da.value }); if (x.ok) A.recalcCapital(d); return x; }, { label: 'dividend', now: true }); if (!r.ok) dmsg.textContent = r.error; };
  const divs = st.dividends.slice().sort((a, b) => (a.payDate < b.payDate ? 1 : -1));
  wrap.append(h('section', { class: 'panel' }, h('div', { class: 'ph' }, 'Dividends', h('span', { class: 'sub' }, 'net amount received; adds to capital')),
    h('div', { class: 'pb', style: { display: 'grid', gap: '8px' } }, st.stocks.length ? h('div', { class: 'row', style: { alignItems: 'flex-end' } }, field('Stock', ds), field('Pay date', dd), field('Net amount (USD)', da), h('button', { class: 'btn pri', disabled: ctx.readOnly, onClick: addDiv }, 'Add')) : h('p', { class: 'note' }, 'Add a stock first (open a trade, or use Lists).'), dmsg),
    divs.length ? h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Pay date'), h('th', null, 'Stock'), h('th', { class: 'r' }, 'Net amount'), h('th'))), h('tbody', null, divs.map((x) => h('tr', null, h('td', null, dmy(x.payDate)), h('td', { class: 'mono' }, A.stockById(st, x.stockId)?.symbol ?? '?'), h('td', { class: 'r pos' }, '+' + money(D.d(x.amount))),
      h('td', { class: 'r' }, h('button', { class: 'btn sm quiet-dng', disabled: ctx.readOnly, onClick: () => { const r = ctx.act((d) => { const y = A.deleteDividend(d, x.id); if (y.ok) A.recalcCapital(d); return y; }, { label: 'delete dividend', now: true }); if (r.ok) toast('Dividend moved to the Trash.', 'Restore', () => ctx.store.undo()); } }, 'Delete'))))))) : null));

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
