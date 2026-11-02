import { h, dialog, para, toast, money, signed, pctTxt, qtyTxt, priceTxt, numClass, dmy, num, pill, infoBtn, changeTable, field } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';
import * as M from '../marks.js';
import * as A from '../actions.js';
import { parseDMY } from '../dates.js';
import { editTrade } from './tradeforms.js';

const LEVEL = { crit: 0, neg: 1, warn: 2, info: 3, pos: 4, plain: 5 };
const CHIPS = [['atstop', 'crit', '■ At or below stop'], ['close', 'warn', '● Close to stop'], ['raise', 'info', '↑ Raise stop'], ['report', 'warn', '● Report within 7 days'], ['missing', 'warn', '◆ Missing data']];
let filter = null; let showAll = false;

export function render(ctx) {
  const st = ctx.store.state; const today = ctx.today();
  const account = C.estimatedAccount(st);
  const lines = C.openTrades(st).map((t) => {
    const marks = M.lineMarks(st, t, today, account);
    return { t, m: C.lineMetrics(st, t, account), marks, cats: M.attention(marks), rank: Math.min(5, ...marks.map((k) => LEVEL[k.level])) };
  }).sort((a, b) => a.rank - b.rank || A.symbolOf(st, a.t).localeCompare(A.symbolOf(st, b.t)));

  const wrap = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
  if (!st.capital.start) { wrap.append(h('div', { class: 'msg warn' }, '◆ Capital is not set yet. ', h('a', { href: '#/capital', onClick: (e) => { e.preventDefault(); ctx.go('capital'); } }, 'Set the start capital first.'))); }
  if (!lines.length) {
    wrap.append(h('section', { class: 'panel' }, h('div', { class: 'pb' }, h('p', null, 'You have no open positions.'), h('button', { class: 'btn pri', disabled: ctx.readOnly || !st.capital.start, onClick: () => ctx.go('open-trade') }, '+ Open trade'))));
    return wrap;
  }
  // chips
  const counts = Object.fromEntries(CHIPS.map(([k]) => [k, lines.filter((l) => l.cats.has(k)).length]));
  const needing = lines.filter((l) => l.cats.size).length;
  if (needing) wrap.append(h('div', { class: 'chips', role: 'group', 'aria-label': 'Lines that need attention. Click a chip to filter the table.' }, h('b', null, needing === 1 ? '1 line needs attention' : `${needing} lines need attention`),
    CHIPS.filter(([k]) => counts[k]).map(([k, cls, label]) => h('button', { class: 'chip ' + cls, 'aria-pressed': String(filter === k), onClick: () => { filter = filter === k ? null : k; ctx.redraw(); } }, `${label} · ${counts[k]}`)),
    h('button', { class: 'chip', 'aria-pressed': String(filter === null), onClick: () => { filter = null; ctx.redraw(); } }, 'Show all')));
  const shown = filter ? lines.filter((l) => l.cats.has(filter)) : lines;

  const th = (label, cls = '', why, ed) => h('th', { class: cls }, label, ed ? h('span', { class: 'ped', title: 'You type this value' }, '✎') : null, why ? infoBtn(label, why) : null);
  const head = h('tr', null, th('Edit'), th('Symbol'), th('Marks', '', 'Quiet hints about this line. They never change anything and never block you. Hover a mark to see why it is shown.'),
    th('Qty', 'r'), th('Buy price', 'r'), th('Last price', 'r ed', 'The last price you typed. The program never fetches prices.', true), th('Current stop', 'r', 'Your stop today. Changes are written to the stop history.', true),
    th('To stop', 'r', 'Distance from the last price down to the Current stop, as % of the last price.'), th('Open P&L', 'r', '(Last price − buy price) × open shares. Commissions are not included until you sell.'),
    th('Position size', 'r', 'Value of the line (last price × open shares) as % of the estimated account (capital + unrealized result of all open lines).'), th('Next report', '', 'Date of the next earnings report. Used for the report marks.', true),
    ...(showAll ? [th('Buy date'), th('Highest', 'r', 'Highest price since buying, typed by you.', true), th('EMA10', 'r', 'The 10-day exponential average, typed by you.', true), th('Initial stop', 'r', 'The stop you had when you bought. It is used for R and does not change.'),
      th('Loss if stop hit', 'r', '(Current stop − last price) × open shares.'), th('Risk at stop %', 'r', 'Loss at the stop as % of the capital this trade was opened with.'), th('Realized so far', 'r', 'Net result of the shares already sold from this line.'), th('Setup'), th('Comment', '', '', true)] : []));

  const cell = (t, field, text, cls = 'r', opts = {}) => h('td', { class: cls + ' ed', tabindex: ctx.readOnly ? null : 0, title: ctx.readOnly ? '' : 'Click to type', onClick: ctx.readOnly ? null : (e) => startEdit(ctx, e.currentTarget, t, field, opts), onKeydown: (e) => { if (e.key === 'Enter' && !ctx.readOnly) startEdit(ctx, e.currentTarget, t, field, opts); } }, text);
  const rows = shown.map(({ t, m, marks }) => {
    const sym = A.symbolOf(st, t); const last = num(t.last); const stop = num(t.currentStop);
    const vis = marks.slice(0, 2), hid = marks.slice(2);
    return h('tr', null,
      h('td', null, h('button', { class: 'btn sm', 'aria-label': 'Edit ' + sym, disabled: ctx.readOnly, onClick: () => editTrade(ctx, t.id) }, 'Edit'), ' ', h('button', { class: 'btn sm', 'aria-label': 'Close ' + sym, disabled: ctx.readOnly, onClick: () => ctx.go('close-trade', { tradeId: t.id }) }, 'Close…')),
      h('td', { class: 'mono' }, sym, t.sales.length ? h('span', { class: 'note', title: 'Partly sold' }, ' ½') : null),
      h('td', { class: 'marks' }, h('div', { class: 'mk' }, vis.map(pill), hid.length ? h('button', { class: 'pill more', title: 'Also: ' + hid.map((x) => x.text).join('; '), 'aria-label': hid.length + ' more marks: ' + hid.map((x) => x.text).join('; '), onClick: () => dialog({ title: sym + ': all marks', body: h('div', null, marks.map((x) => h('p', { style: { margin: '0 0 8px' } }, pill(x), ' ', h('span', { class: 'note' }, x.why)))), info: true, ok: 'Close' }) }, '+' + hid.length) : null)),
      h('td', { class: 'r' }, qtyTxt(C.openQty(t))), h('td', { class: 'r' }, priceTxt(D.d(t.buyPrice))),
      cell(t, 'last', priceTxt(last)), cell(t, 'currentStop', priceTxt(stop)),
      h('td', { class: 'r ' + (m.toStopPct !== null && m.toStopPct <= 0n ? 'neg' : '') }, pctTxt(m.toStopPct, 1)),
      h('td', { class: 'r ' + numClass(m.openPL) }, signed(m.openPL)), h('td', { class: 'r' }, pctTxt(m.positionPct, 1)),
      cell(t, 'nextReport', dmy(t.nextReport), '', { date: true }),
      ...(showAll ? [h('td', null, dmy(t.buyDate)), cell(t, 'highest', priceTxt(num(t.highest))), cell(t, 'ema10', priceTxt(num(t.ema10))), h('td', { class: 'r' }, priceTxt(num(t.initialStop))),
        h('td', { class: 'r ' + numClass(m.lossIfStop) }, signed(m.lossIfStop)), h('td', { class: 'r' }, pctTxt(m.riskAtStopPct)), h('td', { class: 'r ' + numClass(m.realized) }, m.realized === null ? '–' : signed(m.realized)),
        h('td', null, st.setups.find((x) => x.id === t.setupId)?.name ?? '–'), cell(t, 'comment', t.comment || '–', 'mut', { text: true })] : []));
  });
  const totPL = shown.reduce((a, l) => a + (l.m.openPL ?? 0n), 0n);
  const loss = C.lossIfAllStopsHit(st);
  const inMarket = account > 0n ? D.pct(shown.reduce((a, l) => a + (l.m.value ?? 0n), 0n), account) : null;
  const noStop = lines.filter((l) => num(l.t.currentStop) === null).length;
  const foot = h('tr', null, h('td', { colspan: 8, class: 'mut', style: { paddingLeft: '10px' } }, `${shown.length} line${shown.length === 1 ? '' : 's'}${filter ? ' (filtered)' : ''} · Loss if all stops hit `, h('b', { class: 'neg' }, signed(loss.loss)), noStop ? ` · ${noStop} line${noStop === 1 ? '' : 's'} without stop not included` : ''),
    h('td', { class: 'r ' + numClass(totPL) }, h('b', null, signed(totPL))), h('td', { class: 'r' }, h('b', null, pctTxt(inMarket, 1)), ' in market'), h('td', { colspan: showAll ? 10 : 1 }));

  wrap.append(h('section', { class: 'panel', 'aria-label': 'Open positions table' },
    h('div', { class: 'ph', style: { fontSize: '12.5px', fontWeight: 500 } }, h('span', { class: 'sub' }, 'Template ', h('b', { style: { color: 'var(--ink)' } }, 'Daily'), ' · sorted by most urgent mark first · ✎ = you type this value · estimated account ', h('b', { style: { color: 'var(--ink)' } }, money(account))),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: () => updatePrices(ctx, lines.map((l) => l.t)) }, 'Update prices'),
        h('label', { class: 'btn sm', style: { cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: showAll, 'aria-label': 'Show all columns', onChange: (e) => { showAll = e.target.checked; ctx.redraw(); } }), ' Show all columns'))),
    h('div', { class: 'tw fx' }, h('table', { class: 'stk' }, h('thead', null, head), h('tbody', null, rows), h('tfoot', null, foot)))));
  return wrap;
}

// ---- one value typed straight into the table (saved at once; Undo for the last one) ----
function startEdit(ctx, td, t, field, opts) {
  if (td.querySelector('input')) return;
  const cur = t[field] ?? '';
  const shownVal = opts.date ? dmy(cur).replace('–', '') : opts.text ? cur : cur === '' ? '' : D.edit(D.d(cur));
  const inp = h('input', { class: 'cell', value: shownVal, 'aria-label': 'Edit ' + field, style: opts.text ? { width: '180px', textAlign: 'left' } : null, placeholder: opts.date ? 'dd-mm-yyyy' : '' });
  td.textContent = ''; td.append(inp); inp.focus(); inp.select();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    if (!save || inp.value === shownVal) return ctx.redraw();
    await commitEdit(ctx, t, field, inp.value, opts);
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
  inp.addEventListener('blur', () => finish(true));
}
async function commitEdit(ctx, t, field, raw, opts) {
  const st = ctx.store.state; const sym = A.symbolOf(st, t);
  let value = raw.trim();
  if (opts.date) { if (value === '') value = ''; else { const iso = parseDMY(value); if (!iso) { toast('That is not a valid date. Use dd-mm-yyyy.'); return ctx.redraw(); } value = iso; } }
  if (field === 'last' && value !== '') {
    const j = A.jumpPct(t.last, value);
    if (j !== null && j > D.d(st.settings.bigJumpPct)) {
      const ok = await dialog({ title: `Last price of ${sym}: ${priceTxt(num(t.last))} → ${priceTxt(D.parse(value))}?`, body: h('div', null, para(`This is a jump of ${pctTxt(j, 0)}. Check for a typing error.`, ''), changeTable([['Last price', priceTxt(num(t.last)), priceTxt(D.parse(value))]].map((r) => Object.assign(r, { changed: true })))), ok: 'Save anyway' });
      if (!ok) return ctx.redraw();
    }
  }
  const old = t[field];
  const res = ctx.act((d) => A.editDaily(d, t.id, field, value), { label: `${sym} ${LABEL[field] || field}`, now: true });
  if (!res.ok) toast(res.error);
  else void old;
}
const LABEL = { last: 'last price', currentStop: 'stop', highest: 'highest', ema10: 'EMA10', nextReport: 'next report', comment: 'comment' };

// ---- Update prices: all lines in one table, one Undo step ----
function updatePrices(ctx, trades) {
  const st = ctx.store.state; const inputs = [];
  const rows = trades.map((t) => {
    const mk = (f, w = 80) => { const i = h('input', { class: 'cell', 'aria-label': `${A.symbolOf(st, t)} ${f}`, value: t[f] === '' ? '' : D.edit(D.d(t[f])), style: { width: w + 'px' } }); i.dataset.t = t.id; i.dataset.f = f; inputs.push(i); return i; };
    const rep = h('input', { class: 'cell', 'aria-label': A.symbolOf(st, t) + ' next report', value: dmy(t.nextReport).replace('–', ''), placeholder: 'dd-mm-yyyy', style: { width: '96px' } }); rep.dataset.t = t.id; rep.dataset.f = 'nextReport'; inputs.push(rep);
    return h('tr', null, h('td', { class: 'mono' }, A.symbolOf(st, t)), h('td', { class: 'r' }, qtyTxt(C.openQty(t))), h('td', { class: 'r' }, priceTxt(D.d(t.buyPrice))), h('td', null, mk('last')), h('td', null, mk('currentStop')), h('td', null, mk('highest')), h('td', null, mk('ema10')), h('td', null, rep));
  });
  dialog({ title: 'Update prices', wide: true, ok: 'Save all', body: h('div', null, para('Type the new values. Empty or unchanged fields stay as they are. All changes are saved together and can be undone with one click.'),
    h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, ['Symbol', 'Qty', 'Buy price', 'Last price', 'Current stop', 'Highest', 'EMA10', 'Next report'].map((x, i) => h('th', { class: i > 0 && i < 7 ? 'r' : '' }, x)))), h('tbody', null, rows)))),
    onOk: async () => {
      const changes = []; const jumps = [];
      for (const i of inputs) {
        const t = trades.find((x) => x.id === i.dataset.t); const f = i.dataset.f; let v = i.value.trim();
        const before = f === 'nextReport' ? dmy(t.nextReport).replace('–', '') : t[f] === '' ? '' : D.edit(D.d(t[f]));
        if (v === before) continue; if (v === '' && f !== 'nextReport') continue;
        if (f === 'nextReport') { if (v === '') v = ''; else { const iso = parseDMY(v); if (!iso) return `${A.symbolOf(st, t)}: next report is not a valid date (dd-mm-yyyy).`; v = iso; } }
        else if (D.parse(v) === null || D.parse(v) <= 0n) return `${A.symbolOf(st, t)}: enter ${f === 'last' ? 'the last price' : f} as a number above 0.`;
        changes.push({ t, f, v });
        if (f === 'last') { const j = A.jumpPct(t.last, v); if (j !== null && j > D.d(st.settings.bigJumpPct)) jumps.push({ t, v, j }); }
      }
      if (!changes.length) return 'Nothing was changed.';
      if (jumps.length) {
        const ok = await dialog({ title: 'Big price jump', body: h('div', null, para('Check for typing errors:', ''), changeTable(jumps.map(({ t, v, j }) => Object.assign([A.symbolOf(st, t) + ' last price', priceTxt(num(t.last)), priceTxt(D.parse(v)) + ` (${pctTxt(j, 0)})`], { changed: true })))), ok: 'Save anyway' });
        if (!ok) return false;
      }
      const res = ctx.act((d) => { for (const c of changes) { const r = A.editDaily(d, c.t.id, c.f, c.v); if (!r.ok) return { ...r, error: `${A.symbolOf(d, c.t)}: ${r.error}` }; } return { ok: true }; }, { label: 'price update', now: true });
      return res.ok ? true : res.error;
    } });
}
