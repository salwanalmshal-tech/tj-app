// Open positions: the daily workspace. Look from the UX/UI specification; content, names and rules from the agreed decisions.
// Hierarchy: page header + four account numbers, "Needs your attention" (exceptions, 3-4 cards with a slider), and
// "All open positions" as cards (2026-11-06) with filters. A card opens the daily detail panel. All numbers come from calc.js / marks.js.
import { h, dialog, para, toast, money, pctTxt, qtyTxt, priceTxt, numClass, dmy, num, changeTable, infoBtn, pill, datePicker } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';
import * as M from '../marks.js';
import * as A from '../actions.js';
import { diffDays } from '../dates.js';
import { editTrade } from './tradeforms.js';

export const usd = (a) => (a === null || a === undefined ? '–' : (a < 0n ? '−$' : '$') + money(D.abs(a)));
export const susd = (a) => (a === null || a === undefined ? '–' : (a > 0n ? '+$' : a < 0n ? '−$' : '$') + money(D.abs(a)));
const spct = (a, dp = 1) => (a === null || a === undefined ? '–' : (a > 0n ? '+' : '') + pctTxt(a, dp));
const rTxt = (r) => (r === null || r === undefined ? '–' : (r > 0n ? '+' : '') + D.fmt(r, 2) + ' R');
const STATUS_TEXT = { act: 'Act now', rev: 'Review', ok: 'On plan' };
const ORDER = { act: 0, rev: 1, ok: 2 };
const isMissing = (marks) => marks.some((m) => m.text.startsWith('Missing'));
let filter = 'all'; // all | attention | missing

export function lines(st, today) {
  const account = C.estimatedAccount(st);
  return C.openTrades(st).map((t) => {
    const marks = M.lineMarks(st, t, today, account);
    return { t, sym: A.symbolOf(st, t), m: C.lineMetrics(st, t, account), marks, status: M.lineStatus(marks), exc: marks.filter(M.isException) };
  }).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.sym.localeCompare(b.sym) || (a.t.seq ?? 0) - (b.t.seq ?? 0));
}
// In market / Cash as one bar (Q4): blue = in market, light grey = cash; the bigger value gets the bigger part.
function marketCard(inMarket, value, account) {
  const why = `In market = value of all open lines at the last price (${usd(value)}) as % of the estimated account (${usd(account)} = Capital (closed trades) + open result). Cash = the rest.`;
  const head = h('span', { class: 'eyebrow' }, 'In market / Cash', infoBtn('In market / Cash', why));
  if (inMarket === null) return h('div', { class: 'metric' }, head, h('span', { class: 'v' }, '–'));
  const p = Math.max(0, Math.min(100, Number(inMarket) / Number(D.SCALE)));
  const cash = D.sub(D.d('100'), inMarket);
  // both values are always written on the bar; a small part keeps a minimum width so its value stays readable
  const seg = (cls, w, label, v) => h('div', { class: 'mseg ' + cls, style: { flex: `${w} 1 0`, minWidth: w > 0 ? '58px' : '0' }, title: `${label} ${pctTxt(v, 1)}` }, w >= 30 ? h('span', { class: 'ml' }, label) : null, h('b', null, pctTxt(v, 1)));
  return h('div', { class: 'metric' }, head,
    h('div', { class: 'mbar', role: 'img', 'aria-label': `In market ${pctTxt(inMarket, 1)}, cash ${pctTxt(cash, 1)}` }, p > 0 ? seg('in', p, 'In market', inMarket) : null, p < 100 ? seg('cash', 100 - p, 'Cash', cash) : null),
    h('span', { class: 'd' }, `${usd(value)} in the market`));
}

export function render(ctx) {
  const st = ctx.store.state; const today = ctx.today();
  const account = C.estimatedAccount(st);
  const all = lines(st, today);
  const capital = C.capitalNow(st);
  const openPL = all.reduce((a, l) => a + (l.m.openPL ?? 0n), 0n);
  const loss = C.lossIfAllStopsHit(st);
  const value = all.reduce((a, l) => a + (l.m.value ?? 0n), 0n);
  const inMarket = account > 0n ? D.pct(value, account) : null;
  const noStop = all.filter((l) => num(l.t.currentStop) === null).length;

  const wrap = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } });
  wrap.append(h('header', { class: 'pg-head' },
    h('div', null, h('div', { class: 'eyebrow' }, 'Daily workspace'), h('h1', null, 'Open positions'), h('p', { class: 'lead' }, 'Focus on exceptions first. Do not encourage unnecessary action.')),
    h('div', { class: 'acts' }, h('button', { class: 'btn pri big', disabled: ctx.readOnly || !st.capital.start, onClick: () => ctx.go('open-trade') }, '+ Open trade'))));

  if (!st.capital.start) wrap.append(h('div', { class: 'msg warn' }, '◆ Capital is not set yet. ', h('a', { href: '#/capital', onClick: (e) => { e.preventDefault(); ctx.go('capital'); } }, 'Set the start capital first.')));

  const metric = (label, why, v, cls, d) => h('div', { class: 'metric' }, h('span', { class: 'eyebrow' }, label, infoBtn(label, why)), h('span', { class: 'v ' + (cls || '') }, v), d ? h('span', { class: 'd' }, d) : null);
  wrap.append(h('section', { class: 'metrics', 'aria-label': 'Account' },
    metric('Capital (closed trades)', `Start capital + deposits − withdrawals + dividends + net result of every sale. Open positions are not included. Now: ${usd(capital)}.`, usd(capital), '', 'Start capital, deposits, dividends and sales'),
    metric('Open P&L', `(Last price − buy price) × open shares, summed over all open lines. Commissions count when you sell. Now: ${susd(openPL)} on ${all.length} lines.`, susd(openPL), numClass(openPL), `${all.length} open line${all.length === 1 ? '' : 's'}`),
    metric('Loss if all stops hit', `From now: (Current stop − last price) × open shares, summed over all lines with a stop, as % of the estimated account (capital + open result = ${usd(account)}). Lines without a stop are not included.`, susd(loss.loss), loss.loss < 0n ? 'neg' : '', (loss.pctOfAccount === null ? '' : `${pctTxt(D.abs(loss.pctOfAccount))} of estimated account`) + (noStop ? ` · ${noStop} without stop` : '')),
    marketCard(inMarket, value, account)));

  if (!all.length) {
    wrap.append(h('section', { class: 'card' }, h('div', { class: 'card-b', style: { paddingTop: '22px' } }, h('div', { class: 'calm' }, '✓ You have no open positions.'))));
    return wrap;
  }

  // ---- Needs your attention: 3-4 cards visible, the rest behind the slider
  const exc = all.filter((l) => l.status !== 'ok');
  const track = h('div', { class: 'attn-track', tabindex: exc.length > 1 ? 0 : null, 'aria-label': 'Lines that need attention' }, exc.map((l) => {
    const top = l.exc[0]; const rest = l.exc.slice(1);
    return h('div', { class: 'attn-c ' + l.status },
      h('div', { class: 'sym' }, l.sym, h('span', { class: 's2' }, ' · ' + l.t.id)),
      h('div', { class: 'kind' }, (l.status === 'act' ? 'Act now' : 'Review') + ' · ' + top.text),
      h('p', { class: 'why' }, top.why, rest.length ? ` Also: ${rest.map((x) => x.text).join('; ')}.` : ''),
      h('div', { class: 'row' },
        l.status === 'act' ? h('button', { class: 'btn sm risk', disabled: ctx.readOnly, onClick: () => ctx.go('close-trade', { tradeId: l.t.id }) }, 'Close…') : null,
        h('button', { class: 'btn sm', onClick: () => detail(ctx, l.t.id) }, 'Open line')));
  }));
  const counter = h('span', { class: 'note', 'aria-live': 'polite' });
  const prev = h('button', { class: 'btn sm', 'aria-label': 'Previous cards', onClick: () => slide(-1) }, '‹');
  const next = h('button', { class: 'btn sm', 'aria-label': 'Next cards', onClick: () => slide(1) }, '›');
  function slide(dir) { track.scrollBy({ left: dir * track.clientWidth, behavior: 'smooth' }); }
  function paintSlider() {
    const card = track.firstElementChild; if (!card || !track.isConnected || track.clientWidth === 0) { prev.hidden = next.hidden = counter.hidden = true; return; }
    const w = card.getBoundingClientRect().width + 12; const per = Math.max(1, Math.round(track.clientWidth / w));
    const first = Math.round(track.scrollLeft / w) + 1; const lastShown = Math.min(exc.length, first + per - 1);
    const show = exc.length > per; prev.hidden = next.hidden = !show; counter.hidden = !show;
    counter.textContent = `${first}–${lastShown} of ${exc.length}`; prev.disabled = first <= 1; next.disabled = lastShown >= exc.length;
  }
  track.addEventListener('scroll', () => requestAnimationFrame(paintSlider));
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => paintSlider()).observe(track);
  track.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { e.preventDefault(); slide(1); } if (e.key === 'ArrowLeft') { e.preventDefault(); slide(-1); } });
  prev.hidden = next.hidden = counter.hidden = true;
  wrap.append(h('section', { class: 'card', 'aria-label': 'Needs your attention' },
    h('div', { class: 'card-h' }, h('div', null, h('h2', null, exc.length ? `Needs your attention (${exc.length})` : 'Needs your attention'), h('p', { class: 'lead' }, 'Only lines that may need a decision. Most urgent first.')),
      exc.length ? h('div', { class: 'row' }, counter, prev, next) : null),
    h('div', { class: 'card-b' }, exc.length ? track : h('div', { class: 'calm' }, '✓ Nothing needs a decision today. All lines are on plan.'))));

  // ---- All open positions as cards (2026-11-06): one card per buy line, most urgent first; the related value is highlighted
  const nAtt = exc.length, nMiss = all.filter((l) => isMissing(l.marks)).length;
  if (filter === 'attention' && !nAtt || filter === 'missing' && !nMiss) filter = 'all';
  const shown = filter === 'attention' ? exc : filter === 'missing' ? all.filter((l) => isMissing(l.marks)) : all;
  const chip = (key, label, n) => h('button', { class: 'chip', 'aria-pressed': String(filter === key), onClick: () => { filter = key; ctx.redraw(); } }, `${label} · ${n}`);
  const cardsSorted = [...shown].sort((a, b) => CS_ORDER[M.cardStatus(a.marks)] - CS_ORDER[M.cardStatus(b.marks)] || a.sym.localeCompare(b.sym) || (a.t.seq ?? 0) - (b.t.seq ?? 0));
  const totPL = shown.reduce((a, l) => a + (l.m.openPL ?? 0n), 0n);
  wrap.append(h('section', { class: 'card', 'aria-label': 'All open positions' },
    h('div', { class: 'card-h', style: { paddingBottom: '6px' } }, h('div', null, h('h2', null, 'All open positions'), h('p', { class: 'lead' }, 'Most urgent first. The value that needs a look is highlighted. Click a card to update, close or edit the line.')),
      h('div', { class: 'row' }, chip('all', 'All', all.length), nAtt ? chip('attention', 'Needs attention', nAtt) : null, nMiss ? chip('missing', 'Missing data', nMiss) : null,
        h('button', { class: 'btn', disabled: ctx.readOnly, onClick: () => updatePrices(ctx, all.map((l) => l.t)) }, 'Update prices'))),
    h('div', { class: 'pcards' }, cardsSorted.map((l) => posCard(ctx, l, today))),
    h('div', { class: 'pfoot' }, h('span', null, `${shown.length} line${shown.length === 1 ? '' : 's'}${filter === 'all' ? '' : ' (filtered)'} · Open P&L `, h('b', { class: numClass(totPL) }, susd(totPL)), ' · Loss if all stops hit ', h('b', { class: 'neg' }, susd(loss.loss)), noStop ? ` · ${noStop} without stop not included` : ''),
      h('span', null, `In market ${pctTxt(inMarket, 1)}`))));
  return wrap;
}

// ---- Position card (agreed 2026-11-05/06) ----
const CS_ORDER = { red: 0, orange: 1, green: 2 };
const CS_WORD = { red: 'Warning', orange: 'Attention', green: 'Healthy' };
const SIZE_FULL = 15; // the size line is full at 15 % of the account
// which value on the card a mark highlights
const HL = { 'Missing: stop': 'stop', 'Raise stop': 'stop', 'Stop far below highest price': 'stop', 'Stop far below buy price': 'stop',
  'At or below stop': 'last', 'Close to stop': 'last', 'Missing: last price': 'last', 'Missing: highest price': 'hi',
  'Below EMA10': 'ema', 'Near EMA10': 'ema', 'Missing: EMA10': 'ema', 'Missing: Initial stop': 'init', 'Position too big': 'size', 'Near size limit': 'size' };
const hlKey = (text) => HL[text] ?? (text.startsWith('Report') ? 'rep' : text.startsWith('Risk above') ? 'risk' : null);
function highlights(marks) {
  const out = {};
  for (const m of marks) {
    const k = hlKey(m.text); const c = m.level === 'crit' || m.level === 'neg' ? 'r' : m.level === 'warn' ? 'o' : null;
    if (!k || !c) continue;
    out[k] ??= { c, why: [] }; if (c === 'r') out[k].c = 'r'; out[k].why.push(m.text);
  }
  return out;
}
function reportText(iso, today) {
  if (!iso) return '–';
  const d = diffDays(today, iso);
  if (d === 0) return 'today'; if (d === 1) return '1 day'; if (d > 1) return d + ' days';
  return -d === 1 ? '1 day ago' : -d + ' days ago';
}
function posCard(ctx, l, today) {
  const S = ctx.store.state.settings; const { t, m, marks } = l;
  const hl = highlights(marks); const cs = M.cardStatus(marks);
  const buy = D.d(t.buyPrice), last = num(t.last), stop = num(t.currentStop), init = num(t.initialStop);
  const val = (k, text, cls = '') => h('b', { class: `cv ${cls}${hl[k] ? ' hl-' + hl[k].c : ''}${text === '–' ? ' none' : ''}`, title: hl[k] ? hl[k].why.join(' · ') : null }, text);
  const lab = (text) => h('span', { class: 'cl' }, text);
  const risk = stop === null ? '–' : stop >= buy ? 'None' : pctTxt(m.riskAtStopPct, 2);
  const result = last === null || buy === 0n ? null : D.pct(D.sub(last, buy), buy);
  const buyToStop = stop === null || buy === 0n ? null : D.pct(D.sub(stop, buy), buy);
  const locked = buyToStop !== null && buyToStop > D.d(S.profitLocked);
  const size = m.positionPct; const sizeN = size === null ? 0 : Math.max(0, Number(size) / Number(D.SCALE));
  const tick = Math.min(100, Number(D.d(S.posSmallTo)) / Number(D.SCALE) / SIZE_FULL * 100);
  const sizeCls = hl.size ? hl.size.c : 'g';
  const open = () => detail(ctx, t.id);
  return h('article', { class: 'pcard ' + cs, tabindex: 0, 'aria-label': `${l.sym} ${t.id}: ${CS_WORD[cs]}. Open the line`, onClick: open, onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
    h('div', { class: 'pc-top' }, h('span', { class: 'pc-sym', title: t.id + (t.sales.length ? ' · partly sold' : '') }, l.sym, t.sales.length ? h('span', { class: 's2' }, ' ½') : null), h('span', { class: 'pc-st ' + cs }, CS_WORD[cs])),
    h('div', { class: 'pc-main' },
      h('div', { class: 'pc-left' },
        h('div', { class: 'pc-stop' }, lab('Stop loss'), val('stop', stop === null ? 'None' : priceTxt(stop), 'big')),
        h('div', { class: 'pc-vals' },
          h('div', null, lab('Buy price'), val('buy', priceTxt(buy))),
          h('div', null, lab('Last price'), val('last', priceTxt(last))),
          h('div', null, lab('Highest price'), val('hi', priceTxt(num(t.highest)))),
          h('div', null, lab('EMA10'), val('ema', priceTxt(num(t.ema10))))),
        h('div', { class: 'pc-small' }, h('span', null, 'Report: ', val('rep', reportText(t.nextReport, today))), h('span', null, 'Initial stop: ', val('init', init === null ? 'None' : priceTxt(init))))),
      h('div', { class: 'pc-right' },
        h('div', null, lab('Risk'), val('risk', risk, 'mid')),
        h('div', null, lab('Result'), h('b', { class: 'cv res' + (locked ? ' locked' : ''), title: locked ? `Profit locked in: stop more than ${S.profitLocked.replace('.', ',')} % above the buy price` : 'From buy price to last price' }, result === null ? '–' : spct(result, 2))))),
    h('div', { class: 'pc-size', title: 'Position size: last price × open shares as % of the estimated account' },
      h('div', { class: 'sbar' }, h('i', { class: 'fill ' + sizeCls, style: { width: Math.min(100, sizeN / SIZE_FULL * 100) + '%' } }), h('i', { class: 'tick', style: { left: tick + '%' } })),
      h('span', { class: 'sz' + (hl.size ? ' t-' + hl.size.c : ''), title: hl.size ? hl.size.why.join(' · ') : null }, 'Size ' + pctTxt(size, 1))));
}

// ---- Line panel: all marks, the daily values (B2: saved at once, Undo for the last change), the facts, and the actions ----
function detail(ctx, id) {
  document.querySelector('.sheet-scrim')?.remove();
  const st = ctx.store.state; const t = A.tradeById(st, id); if (!t) return;
  const sym = A.symbolOf(st, t); const account = C.estimatedAccount(st);
  const marks = M.lineMarks(st, t, ctx.today(), account); const status = M.lineStatus(marks); const m = C.lineMetrics(st, t, account);
  const prevFocus = document.activeElement;
  const inputs = {};
  const numField = (f, label) => {
    const cur = t[f] ?? '';
    const inp = h('input', { inputmode: 'decimal', value: cur === '' ? '' : D.edit(D.d(cur)), 'aria-label': label, autocomplete: 'off', placeholder: 'Empty' });
    inputs[f] = { get: () => inp.value.trim(), el: inp, kind: 'num', label, before: inp.value.trim() };
    return h('label', { class: 'of' }, h('span', { class: 'l' }, label), h('div', { class: 'box' }, h('span', { class: 'pre' }, '$'), inp));
  };
  const rep = datePicker({ iso: t.nextReport || '', label: 'Next report' });
  inputs.nextReport = { get: () => rep.getISO(), el: rep.input, kind: 'date', label: 'Next report', before: t.nextReport || '' };
  const com = h('textarea', { 'aria-label': 'Comment', rows: 2 }); com.value = t.comment || '';
  inputs.comment = { get: () => com.value, el: com, kind: 'text', label: 'Comment', before: com.value };
  const msg = h('div', { class: 'msg bad', role: 'alert', hidden: true });
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey, true); prevFocus?.focus?.(); };
  async function save() {
    const changes = [];
    for (const [f, x] of Object.entries(inputs)) {
      const v = x.get(); if (v === x.before) continue;
      if (x.kind === 'num' && v !== '' && (D.parse(v) === null || D.parse(v) <= 0n)) { msg.textContent = `■ ${x.label} must be a number above 0, or empty.`; msg.hidden = false; x.el.focus(); return; }
      if (x.kind === 'date' && v === null) { msg.textContent = '■ Next report is not a valid date. Use dd-mm-yyyy or the calendar.'; msg.hidden = false; x.el.focus(); return; }
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
    if (document.querySelector('.scrim.fixed') || document.querySelector('.dp-pop')) return; // a confirmation or calendar is open on top
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && scrim.contains(e.target)) { e.preventDefault(); save(); }
  };
  const lv = (k, v, why, cls) => h('div', null, h('dt', null, k, why ? infoBtn(k, why) : null), h('dd', { class: cls || '' }, v));
  const setup = st.setups.find((x) => x.id === t.setupId)?.name;
  const locked = m.lockedAtStop !== null && m.lockedAtStop > 0n;
  const R = (() => { const rps = C.riskPerShare(t), last = num(t.last); return rps === null || rps <= 0n || last === null ? null : D.div(D.sub(last, D.d(t.buyPrice)), rps); })();
  const sheet = h('aside', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': sym + ' line' },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' } },
      h('div', null, h('div', { class: 'eyebrow' }, `${t.id}${setup ? ' · ' + setup : ''}`), h('h2', { class: 'sh-title' }, sym), h('span', { class: 'st ' + status }, STATUS_TEXT[status])),
      h('button', { class: 'x', 'aria-label': 'Close', onClick: close }, '×')),
    marks.length ? h('div', { class: 'mlist' }, marks.map((x) => h('div', { class: 'mitem ' + x.level }, h('b', null, (x.icon ? x.icon + ' ' : '') + x.text), x.why ? h('span', null, ' · ' + x.why) : null))) : h('div', { class: 'calm' }, '✓ On plan. Nothing to decide today.'),
    h('section', { class: 'card acc' }, h('div', { class: 'card-h' }, h('div', null, h('h2', null, 'Update today'), h('p', { class: 'lead' }, 'Your daily values. Leave a field empty to clear it.'))),
      h('div', { class: 'card-b', style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        h('div', { class: 'fgrid' }, numField('last', 'Last price'), numField('currentStop', 'Current stop'),
          numField('ema10', 'EMA10'), numField('highest', 'Highest price'), h('label', { class: 'of' }, h('span', { class: 'l' }, 'Next report'), h('div', { class: 'box' }, rep))),
        h('label', { class: 'of' }, h('span', { class: 'l' }, 'Comment'), com), msg,
        h('div', { class: 'row' }, h('button', { class: 'btn pri big', disabled: ctx.readOnly, onClick: save }, 'Save'), h('button', { class: 'btn big', onClick: close }, 'Cancel')))),
    h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h2', null, 'Line')), h('div', { class: 'card-b' }, h('dl', { class: 'facts', style: { margin: 0 } },
      lv('Qty open', qtyTxt(C.openQty(t)) + (t.sales.length ? ` of ${qtyTxt(D.d(t.qty))} bought` : '')), lv('Buy date', dmy(t.buyDate)), lv('Buy price', usd(D.d(t.buyPrice))),
      lv('Initial stop', t.initialStop ? usd(D.d(t.initialStop)) : 'No SL', 'The stop you had when you bought. R and risk use it. It changes only with “Correct initial stop” in Edit trade.'),
      lv('Open P&L', susd(m.openPL), '(Last price − buy price) × open shares.', numClass(m.openPL)),
      lv('R now', R === null ? 'No SL' : rTxt(R), '(Last price − buy price) ÷ (buy price − Initial stop).'),
      locked ? lv('Locked-in result at Current stop', susd(m.lockedAtStop) + (m.lockedR === null ? '' : ' · ' + rTxt(m.lockedR)), '(Current stop − buy price) × open shares, and the same in R: (Current stop − buy price) ÷ (buy price − Initial stop).', 'pos')
        : lv('Loss if stop hit', susd(m.lossIfStop) + (m.lockedR === null ? '' : ' · ' + rTxt(m.lockedR) + ' at stop'), '(Current stop − last price) × open shares. In R: (Current stop − buy price) ÷ (buy price − Initial stop).', numClass(m.lossIfStop)),
      lv('Risk at stop %', m.riskAtStopPct === null ? '–' : pctTxt(m.riskAtStopPct) + ' of capital at open', 'Loss at the Current stop as % of the capital this trade was opened with.'),
      lv('Position size %', pctTxt(m.positionPct, 1), 'Last price × open shares as % of the estimated account.'),
      m.realized !== null ? lv('Realized so far', susd(m.realized) + (m.rReal === null ? '' : ' · ' + rTxt(m.rReal)), 'Net result of the shares already sold from this line.', numClass(m.realized)) : null,
      m.realized !== null ? lv('Still at risk', susd(m.lossIfStop), 'Remaining shares at the Current stop.', numClass(m.lossIfStop)) : null))),
    h('div', { class: 'row' },
      h('button', { class: 'btn risk big', disabled: ctx.readOnly, onClick: () => { close(); ctx.go('close-trade', { tradeId: t.id }); } }, 'Close trade…'),
      h('button', { class: 'btn big', disabled: ctx.readOnly, onClick: () => { close(); editTrade(ctx, t.id); } }, 'Edit trade')));
  const scrim = h('div', { class: 'sheet-scrim', onClick: (e) => { if (e.target === scrim) close(); } }, sheet);
  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim);
  if (ctx.readOnly) { for (const x of Object.values(inputs)) x.el.disabled = true; sheet.querySelector('.x').focus(); }
  else { inputs.last.el.focus(); inputs.last.el.select(); }
}

// ---- Update prices: all lines in one table, one Undo step ----
function updatePrices(ctx, trades) {
  const st = ctx.store.state; const inputs = [];
  const rows = trades.map((t) => {
    const mk = (f, w = 80) => { const i = h('input', { class: 'cell', 'aria-label': `${A.symbolOf(st, t)} ${f}`, value: t[f] === '' ? '' : D.edit(D.d(t[f])), style: { width: w + 'px' } }); inputs.push({ t, f, get: () => i.value.trim(), before: i.value.trim() }); return i; };
    const rep = datePicker({ iso: t.nextReport || '', label: A.symbolOf(st, t) + ' next report' });
    inputs.push({ t, f: 'nextReport', get: () => rep.getISO(), before: t.nextReport || '' });
    return h('tr', null, h('td', null, h('b', null, A.symbolOf(st, t)), h('div', { class: 'note' }, t.id)), h('td', { class: 'r' }, qtyTxt(C.openQty(t))), h('td', { class: 'r' }, priceTxt(D.d(t.buyPrice))), h('td', null, mk('last')), h('td', null, mk('currentStop')), h('td', null, mk('highest')), h('td', null, mk('ema10')), h('td', null, h('div', { class: 'cellbox' }, rep)));
  });
  dialog({ title: 'Update prices', wide: true, ok: 'Save all', body: h('div', null, para('Type the new values. Empty or unchanged price fields stay as they are. All changes are saved together and can be undone with one click.'),
    h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, ['Symbol', 'Qty', 'Buy price', 'Last price', 'Current stop', 'Highest', 'EMA10', 'Next report'].map((x, i) => h('th', { class: i > 0 && i < 7 ? 'r' : '' }, x)))), h('tbody', null, rows)))),
    onOk: async () => {
      const changes = []; const jumps = [];
      for (const x of inputs) {
        const { t, f } = x; const v = x.get();
        if (v === x.before) continue;
        if (f === 'nextReport') { if (v === null) return `${A.symbolOf(st, t)}: next report is not a valid date (dd-mm-yyyy).`; }
        else { if (v === '') continue; if (D.parse(v) === null || D.parse(v) <= 0n) return `${A.symbolOf(st, t)}: enter ${f === 'last' ? 'the last price' : f} as a number above 0.`; }
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
