// Open Positions: the daily workspace (UX/UI specification, screen 1).
// Hierarchy: page header + four account metrics, "Needs your attention" (exceptions only), compact table of all positions.
// A row opens the daily decision detail, where the typed daily values are updated. All calculations come from calc.js / marks.js.
import { h, dialog, para, toast, money, pctTxt, qtyTxt, priceTxt, numClass, dmy, num, changeTable } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';
import * as M from '../marks.js';
import * as A from '../actions.js';
import { parseDMY } from '../dates.js';
import { editTrade } from './tradeforms.js';

export const usd = (a) => (a === null || a === undefined ? '–' : (a < 0n ? '−$' : '$') + money(D.abs(a)));
export const susd = (a) => (a === null || a === undefined ? '–' : (a > 0n ? '+$' : a < 0n ? '−$' : '$') + money(D.abs(a)));
const rTxt = (r) => (r === null || r === undefined ? '–' : (r > 0n ? '+' : '') + D.fmt(r, 2) + ' R');

// Status of a line, from its marks. Act now = at or below the stop. Review = an attention category or a strong mark.
const isException = (m) => m.level === 'crit' || m.level === 'neg' || M.attention([m]).size > 0;
function statusOf(marks) {
  if (marks.some((m) => m.level === 'crit')) return 'act';
  if (marks.some(isException)) return 'rev';
  return 'ok';
}
const STATUS_TEXT = { act: 'Act now', rev: 'Review', ok: 'On plan' };
const ORDER = { act: 0, rev: 1, ok: 2 };
function kindLabel(m) {
  const t = m.text;
  if (t === 'At or below stop') return 'At stop';
  if (t === 'Raise stop' || t === 'Stop far below highest price') return 'Protection';
  if (t.startsWith('Report')) return t.split(':')[0];
  if (t.startsWith('Missing')) return 'Missing data';
  return t;
}
function openR(t) {
  const rps = C.riskPerShare(t), last = num(t.last);
  if (rps === null || rps <= 0n || last === null) return null;
  return D.div(D.sub(last, D.d(t.buyPrice)), rps);
}

export function render(ctx) {
  const st = ctx.store.state; const today = ctx.today();
  const account = C.estimatedAccount(st);
  const lines = C.openTrades(st).map((t) => {
    const marks = M.lineMarks(st, t, today, account);
    return { t, sym: A.symbolOf(st, t), m: C.lineMetrics(st, t, account), marks, status: statusOf(marks), exc: marks.filter(isException) };
  }).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.sym.localeCompare(b.sym));

  const capital = C.capitalNow(st);
  const openPL = lines.reduce((a, l) => a + (l.m.openPL ?? 0n), 0n);
  const loss = C.lossIfAllStopsHit(st);
  const value = lines.reduce((a, l) => a + (l.m.value ?? 0n), 0n);
  const deployed = account > 0n ? D.pct(value, account) : null;
  const noStop = lines.filter((l) => num(l.t.currentStop) === null).length;

  const wrap = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } });
  wrap.append(h('header', { class: 'pg-head' },
    h('div', null, h('div', { class: 'eyebrow' }, 'Daily workspace'), h('h1', null, 'Open Positions'), h('p', { class: 'lead' }, 'Focus on exceptions first. Do not encourage unnecessary action.')),
    h('div', { class: 'acts' }, h('button', { class: 'btn pri big', disabled: ctx.readOnly || !st.capital.start, onClick: () => ctx.go('open-trade') }, '+ Open position'))));

  if (!st.capital.start) wrap.append(h('div', { class: 'msg warn' }, '◆ Capital is not set yet. ', h('a', { href: '#/capital', onClick: (e) => { e.preventDefault(); ctx.go('capital'); } }, 'Set the start capital first.')));

  const metric = (label, v, cls, d, title) => h('div', { class: 'metric', title }, h('span', { class: 'eyebrow' }, label), h('span', { class: 'v ' + (cls || '') }, v), d ? h('span', { class: 'd' }, d) : null);
  wrap.append(h('section', { class: 'metrics', 'aria-label': 'Account' },
    metric('Account capital', usd(capital), '', 'Closed trades, deposits and dividends', 'Capital (closed trades) = start capital + deposits − withdrawals + dividends + net result of every sale. Open positions are not included.'),
    metric('Open P&L', susd(openPL), numClass(openPL), `${lines.length} open position${lines.length === 1 ? '' : 's'}`, '(Last price − buy price) × open shares, summed. Commissions count when you sell.'),
    metric('Risk at stops', susd(loss.loss), loss.loss < 0n ? 'neg' : '', (loss.pctOfAccount === null ? '' : `${pctTxt(D.abs(loss.pctOfAccount))} of account now`) + (noStop ? ` · ${noStop} without stop` : ''), 'Loss if all stops hit, from now: (Current stop − last price) × open shares, summed, as % of the estimated account (capital + open result).'),
    metric('Capital deployed', pctTxt(deployed, 1), '', deployed === null ? '' : `${usd(value)} in the market`, 'Value of all open positions at the last price, as % of the estimated account.')));

  if (!lines.length) {
    wrap.append(h('section', { class: 'card' }, h('div', { class: 'card-b', style: { paddingTop: '22px' } }, h('div', { class: 'calm' }, '✓ No open positions. Your next trade starts with a clear plan.'))));
    return wrap;
  }

  // ---- Needs your attention (exceptions only)
  const exc = lines.filter((l) => l.status !== 'ok');
  wrap.append(h('section', { class: 'card', 'aria-label': 'Needs your attention' },
    h('div', { class: 'card-h' }, h('div', null, h('h2', null, 'Needs your attention'), h('p', { class: 'lead' }, 'Only exceptions that may require a decision.'))),
    h('div', { class: 'card-b' }, exc.length ? h('div', { class: 'attn' }, exc.map((l) => {
      const top = l.exc[0]; const rest = l.exc.slice(1);
      return h('div', { class: 'attn-c ' + l.status },
        h('div', { class: 'sym' }, l.sym),
        h('div', { class: 'kind' }, (l.status === 'act' ? 'Action required' : 'Review') + ' · ' + kindLabel(top)),
        h('p', { class: 'why' }, top.why, rest.length ? ` Also: ${rest.map((x) => x.text.split(':')[0]).join(', ')}.` : ''),
        h('div', { class: 'row' },
          l.status === 'act' ? h('button', { class: 'btn sm risk', disabled: ctx.readOnly, onClick: () => ctx.go('close-trade', { tradeId: l.t.id }) }, 'Close position…') : null,
          h('button', { class: 'btn sm', onClick: () => detail(ctx, l.t.id) }, l.status === 'act' ? 'Details' : 'Review')));
    })) : h('div', { class: 'calm' }, '✓ Nothing needs a decision today. All positions are on plan.'))));

  // ---- All positions
  const rows = lines.map((l) => {
    const { t, m } = l; const stop = num(t.currentStop), last = num(t.last), buy = D.d(t.buyPrice);
    const R = openR(t);
    const chg = last === null ? null : D.pct(D.sub(last, buy), buy);
    const locked = stop !== null && stop > buy;
    const prot = stop === null ? h('span', { class: 'b neg' }, 'No stop')
      : [h('div', { class: 'b' }, 'Stop ' + priceTxt(stop)), h('div', { class: 's2 ' + (locked ? 'pos' : '') }, locked ? 'Locked ' + susd(m.lockedAtStop) : m.lossIfStop === null ? '' : susd(m.lossIfStop) + ' at stop')];
    const open = () => detail(ctx, t.id);
    return h('tr', { tabindex: 0, 'aria-label': `${l.sym}: ${STATUS_TEXT[l.status]}. Open details`, onClick: open, onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
      h('td', null, h('div', { class: 'sym' }, l.sym, t.sales.length ? h('span', { class: 's2', title: 'Partly sold' }, ' · partly sold') : null), h('div', { class: 's2' }, `${qtyTxt(C.openQty(t))} × ${priceTxt(buy)} · ${pctTxt(m.positionPct, 1)}`)),
      h('td', null, h('div', { class: 'b' }, priceTxt(last)), h('div', { class: 's2 ' + numClass(chg) }, chg === null ? '' : (chg > 0n ? '+' : '') + pctTxt(chg, 1))),
      h('td', { class: numClass(m.openPL) }, h('div', { class: 'b' }, susd(m.openPL))),
      h('td', null, h('div', { class: 'b' }, R === null ? 'No SL' : rTxt(R))),
      h('td', null, prot),
      h('td', null, h('span', { class: 'st ' + l.status }, STATUS_TEXT[l.status]), t.nextReport ? h('div', { class: 's2' }, 'Report ' + dmy(t.nextReport)) : null));
  });
  wrap.append(h('section', { class: 'card', 'aria-label': 'All positions' },
    h('div', { class: 'card-h', style: { paddingBottom: '14px' } }, h('div', null, h('h2', null, 'All positions'), h('p', { class: 'lead' }, 'Exceptions first. Click a position to update it or decide.')),
      h('button', { class: 'btn', disabled: ctx.readOnly, onClick: () => updatePrices(ctx, lines.map((l) => l.t)) }, 'Update prices')),
    h('div', { class: 'tw' }, h('table', { class: 'ptable' },
      h('thead', null, h('tr', null, ['Position', 'Price', 'Result', 'R', 'Protection', 'Status'].map((x) => h('th', null, x)))),
      h('tbody', null, rows))),
    h('div', { class: 'pfoot' }, h('span', null, `${lines.length} position${lines.length === 1 ? '' : 's'} · estimated account ${usd(account)}`), h('span', null, 'R uses the Initial stop. Prices are typed by you.'))));
  return wrap;
}

// ---- Daily decision detail: all marks, the typed daily values, the facts, and the actions ----
const DAILY = [['last', 'Last price', 'num'], ['currentStop', 'Current stop', 'num'], ['nextReport', 'Next report', 'date'], ['highest', 'Highest price', 'num'], ['ema10', 'EMA10', 'num']];
function detail(ctx, id) {
  document.querySelector('.sheet-scrim')?.remove();
  const st = ctx.store.state; const t = A.tradeById(st, id); if (!t) return;
  const sym = A.symbolOf(st, t); const account = C.estimatedAccount(st);
  const marks = M.lineMarks(st, t, ctx.today(), account); const status = statusOf(marks); const m = C.lineMetrics(st, t, account);
  const prevFocus = document.activeElement;
  const inputs = {};
  const fieldFor = ([f, label, kind]) => {
    const cur = t[f] ?? '';
    const inp = kind === 'date' ? h('input', { type: 'date', value: cur, 'aria-label': label })
      : h('input', { inputmode: 'decimal', value: cur === '' ? '' : D.edit(D.d(cur)), 'aria-label': label, autocomplete: 'off', placeholder: 'Empty' });
    inputs[f] = { inp, kind, label, before: inp.value };
    return h('label', { class: 'of' }, h('span', { class: 'l' }, label), h('div', { class: 'box' }, kind === 'num' ? h('span', { class: 'pre' }, '$') : null, inp));
  };
  const com = h('textarea', { 'aria-label': 'Comment', rows: 2 }); com.value = t.comment || ''; inputs.comment = { inp: com, kind: 'text', label: 'Comment', before: com.value };
  const msg = h('div', { class: 'msg bad', role: 'alert', hidden: true });
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey, true); prevFocus?.focus?.(); };
  async function save() {
    const changes = [];
    for (const [f, x] of Object.entries(inputs)) {
      const v = x.kind === 'text' ? x.inp.value : x.inp.value.trim(); if (v === x.before) continue;
      if (x.kind === 'num' && v !== '' && (D.parse(v) === null || D.parse(v) <= 0n)) { msg.textContent = `■ ${x.label} must be a number above 0, or empty.`; msg.hidden = false; x.inp.focus(); return; }
      if (x.kind === 'date' && v !== '' && !parseDMY(v)) { msg.textContent = '■ Next report is not a valid date.'; msg.hidden = false; return; }
      changes.push([f, v]);
    }
    if (!changes.length) return close();
    const lastCh = changes.find(([f]) => f === 'last');
    if (lastCh && lastCh[1] !== '') {
      const j = A.jumpPct(t.last, lastCh[1]);
      if (j !== null && j > D.d(st.settings.bigJumpPct)) {
        const ok = await dialog({ title: `Last price of ${sym}: ${priceTxt(num(t.last))} → ${priceTxt(D.parse(lastCh[1]))}?`, body: h('div', null, para(`This is a jump of ${pctTxt(j, 0)}. Check for a typing error.`, ''), changeTable([Object.assign(['Last price', priceTxt(num(t.last)), priceTxt(D.parse(lastCh[1]))], { changed: true })])), ok: 'Save anyway' });
        if (!ok) return;
      }
    }
    const res = ctx.act((d) => { for (const [f, v] of changes) { const r = A.editDaily(d, t.id, f, v); if (!r.ok) return r; } return { ok: true }; }, { label: `${sym} update`, now: true });
    if (!res.ok) { msg.textContent = '■ ' + res.error; msg.hidden = false; return; }
    close(); toast(`${sym} updated.`, 'Undo', () => ctx.store.undo());
  }
  const onKey = (e) => {
    if (document.querySelector('.scrim.fixed')) return; // a confirmation is open on top
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && scrim.contains(e.target)) { e.preventDefault(); save(); }
  };
  const lv = (k, v, cls) => h('div', null, h('dt', null, k), h('dd', { class: cls || '' }, v));
  const R = openR(t);
  const setup = st.setups.find((x) => x.id === t.setupId)?.name;
  const locked = m.lockedAtStop !== null && m.lockedAtStop > 0n;
  const sheet = h('aside', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': sym + ' details' },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' } },
      h('div', null, h('div', { class: 'eyebrow' }, `${t.id}${setup ? ' · ' + setup : ''}`), h('h2', { class: 'sh-title' }, sym), h('span', { class: 'st ' + status }, STATUS_TEXT[status])),
      h('button', { class: 'x', 'aria-label': 'Close', onClick: close }, '×')),
    marks.length ? h('div', { class: 'mlist' }, marks.map((x) => h('div', { class: 'mitem ' + x.level }, h('b', null, (x.icon ? x.icon + ' ' : '') + x.text), x.why ? h('span', null, ' · ' + x.why) : null))) : h('div', { class: 'calm' }, '✓ On plan. Nothing to decide today.'),
    h('section', { class: 'card acc' }, h('div', { class: 'card-h' }, h('div', null, h('h2', null, 'Update today'), h('p', { class: 'lead' }, 'Your daily numbers. Leave a field empty to clear it.'))),
      h('div', { class: 'card-b', style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        h('div', { class: 'fgrid' }, DAILY.map(fieldFor)), h('label', { class: 'of' }, h('span', { class: 'l' }, 'Comment'), com), msg,
        h('div', { class: 'row' }, h('button', { class: 'btn pri big', disabled: ctx.readOnly, onClick: save }, 'Save update'), h('button', { class: 'btn big', onClick: close }, 'Cancel')))),
    h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', null, 'Position')), h('div', { class: 'card-b' }, h('dl', { class: 'facts', style: { margin: 0 } },
      lv('Shares open', qtyTxt(C.openQty(t)) + (t.sales.length ? ` of ${qtyTxt(D.d(t.qty))}` : '')), lv('Buy date', dmy(t.buyDate)), lv('Buy price', usd(D.d(t.buyPrice))), lv('Initial stop', t.initialStop ? usd(D.d(t.initialStop)) : 'No SL'),
      lv('Open P&L', susd(m.openPL), numClass(m.openPL)), lv('R now', R === null ? 'No SL' : rTxt(R)),
      lv(locked ? 'Locked in at stop' : 'Loss if stop hit', locked ? susd(m.lockedAtStop) : susd(m.lossIfStop), locked ? 'pos' : numClass(m.lossIfStop)),
      lv('Risk at stop', m.riskAtStopPct === null ? '–' : pctTxt(m.riskAtStopPct) + ' of capital at open'), lv('Position size', pctTxt(m.positionPct, 1) + ' of account'),
      m.realized !== null ? lv('Realized so far', susd(m.realized) + (m.rReal === null ? '' : ' · ' + rTxt(m.rReal)), numClass(m.realized)) : null))),
    h('div', { class: 'row' },
      h('button', { class: 'btn risk big', disabled: ctx.readOnly, onClick: () => { close(); ctx.go('close-trade', { tradeId: t.id }); } }, 'Close position…'),
      h('button', { class: 'btn big', disabled: ctx.readOnly, onClick: () => { close(); editTrade(ctx, t.id); } }, 'Edit trade')));
  const scrim = h('div', { class: 'sheet-scrim', onClick: (e) => { if (e.target === scrim) close(); } }, sheet);
  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim);
  if (ctx.readOnly) { for (const x of Object.values(inputs)) x.inp.disabled = true; sheet.querySelector('.x').focus(); }
  else { inputs.last.inp.focus(); inputs.last.inp.select(); }
}

// ---- Update prices: all lines in one table, one Undo step ----
function updatePrices(ctx, trades) {
  const st = ctx.store.state; const inputs = [];
  const rows = trades.map((t) => {
    const mk = (f, w = 80) => { const i = h('input', { class: 'cell', 'aria-label': `${A.symbolOf(st, t)} ${f}`, value: t[f] === '' ? '' : D.edit(D.d(t[f])), style: { width: w + 'px' } }); i.dataset.t = t.id; i.dataset.f = f; inputs.push(i); return i; };
    const rep = h('input', { class: 'cell', type: 'date', 'aria-label': A.symbolOf(st, t) + ' next report', value: t.nextReport || '', style: { width: '132px', textAlign: 'left' } }); rep.dataset.t = t.id; rep.dataset.f = 'nextReport'; inputs.push(rep);
    return h('tr', null, h('td', null, h('b', null, A.symbolOf(st, t))), h('td', { class: 'r' }, qtyTxt(C.openQty(t))), h('td', { class: 'r' }, priceTxt(D.d(t.buyPrice))), h('td', null, mk('last')), h('td', null, mk('currentStop')), h('td', null, mk('highest')), h('td', null, mk('ema10')), h('td', null, rep));
  });
  dialog({ title: 'Update prices', wide: true, ok: 'Save all', body: h('div', null, para('Type the new values. Empty or unchanged price fields stay as they are. All changes are saved together and can be undone with one click.'),
    h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, ['Symbol', 'Qty', 'Buy price', 'Last price', 'Current stop', 'Highest', 'EMA10', 'Next report'].map((x, i) => h('th', { class: i > 0 && i < 7 ? 'r' : '' }, x)))), h('tbody', null, rows)))),
    onOk: async () => {
      const changes = []; const jumps = [];
      for (const i of inputs) {
        const t = trades.find((x) => x.id === i.dataset.t); const f = i.dataset.f; const v = i.value.trim();
        const before = f === 'nextReport' ? (t.nextReport || '') : t[f] === '' ? '' : D.edit(D.d(t[f]));
        if (v === before) continue; if (v === '' && f !== 'nextReport') continue;
        if (f === 'nextReport') { if (v !== '' && !parseDMY(v)) return `${A.symbolOf(st, t)}: next report is not a valid date.`; }
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
