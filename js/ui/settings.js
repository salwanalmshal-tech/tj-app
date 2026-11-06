import { APP_VERSION } from '../model.js';
import { h, dialog, para, toast, field, infoBtn } from './dom.js';
import * as D from '../decimal.js';

// 2026-11-06 layout: grouped by what the limits are about, two cards side by side, label left and value right (close
// together), the unit next to the value. Entries: [path, label, kind, unit, why]; a plain string starts a small sub-heading.
const GROUPS = [
  ['Stops check', 'When the price is close to the stop, or far enough above it to raise the stop.', [
    'Stop below buy price',
    ['stopBelowBuy.raiseAbove', '“Raise stop” when price is above the stop by more than', 'num', '%'],
    ['stopBelowBuy.closeWithin', '“Close to stop” when price is within', 'num', '%'],
    'Stop above buy price',
    ['stopAboveBuy.raiseAbove', '“Raise stop” when price is above the stop by more than', 'num', '%'],
    ['stopAboveBuy.closeWithin', '“Close to stop” when price is within', 'num', '%']]],
  ['Stop placement', 'Where the stop sits compared with the highest and the buy price.', [
    ['highestToStop', 'Stop far below highest price: more than', 'num', '%'],
    ['stopFarBelowBuy', 'Stop far below buy price: more than', 'num', '%', 'One rule with two settings: it shows only when both are true.'],
    ['stopFarBelowBuyRisk', '… and risk at stop above', 'num', '% cap.'],
    ['profitLocked', 'Profit locked in: stop above buy price by more than', 'num', '%']]],
  ['Risk and position size', 'Risk at stop is % of the capital at open; size is % of the estimated account.', [
    'Risk at stop',
    ['riskWarn', 'Orange above', 'num', '%'],
    ['riskRed', 'Red above', 'num', '%'],
    'Position size',
    ['posNear', 'Orange from', 'num', '%'],
    ['posTooBig', 'Red above', 'num', '%'],
    ['posSmallFrom', 'Small position from', 'num', '%'],
    ['posSmallTo', 'Small position up to', 'num', '%']]],
  ['EMA10 and reports', 'Marks for the trend line and the report dates.', [
    ['emaNear', 'Near EMA10: price less than this above EMA10', 'num', '%'],
    ['reportedAgoDays', 'Show “Reported N days ago” for', 'int', 'days'],
    ['reportStaleDays', 'Report date too old: orange after', 'int', 'days', 'When the report date is this many days in the past and no new date is entered, the line needs attention.']]],
  ['History marks', 'Result marks on closed trades and per stock (% of capital at open).', [
    'Per trade',
    ['histLoss', 'Loss above', 'num', '%'],
    ['histGain', 'Gain above', 'num', '%'],
    'Per stock',
    ['stockLoss1', 'Loss above', 'num', '%'],
    ['stockLoss2', 'Big loss above', 'num', '%'],
    ['stockGain1', 'Gain above', 'num', '%'],
    ['stockGain2', 'Big gain above', 'num', '%']]],
  ['Saving and Excel copy', 'How the program saves, and the weekly Excel copy in your Drive.', [
    ['saveDelaySec', 'Save after your last edit, wait', 'int', 'sec'],
    ['bigJumpPct', 'Ask before saving a last price that jumps more than', 'num', '%', 'Typed prices that jump more than this ask “Save anyway?”.'],
    ['excelCopyDays', 'Make an Excel copy every', 'int', 'days', 'An Excel file with the same sheets as “Download Excel”, saved in the Backups folder in your Drive. It is for reading in Excel or Google Sheets; restoring always uses the JSON backups.'],
    ['excelCopyKeep', 'Keep the newest', 'int', 'copies', 'Older Excel copies are deleted when a new one is made. The JSON backups are not affected.']]],
];
const getP = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setP = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

export function render(ctx) {
  const st = ctx.store.state; const S = structuredClone(st.settings); const inputs = new Map(); const msg = h('div', { class: 'msg bad', role: 'alert', style: { display: 'none' } });
  const unitBox = (input, unit) => h('span', { class: 'set-val' }, input, unit ? h('span', { class: 'set-u' }, unit) : null);
  const mk = (path, label, kind, unit, why) => {
    const i = h('input', { value: String(getP(S, path)).replace('.', ','), inputmode: 'decimal', 'aria-label': label }); inputs.set(path, [i, kind]);
    return h('label', { class: 'set-row' }, h('span', { class: 'set-l' }, label, why ? infoBtn(label, why) : null), unitBox(i, unit));
  };
  const tables = [['rCategories', 'rCategoryElse', 'Trade R labels', 'R', 'A trade gets the first label whose R it reaches (from this R upwards).'], ['stopDistance', 'stopDistanceElse', 'Stop distance labels', '%', 'Buy price to Initial stop: the first label whose limit it stays within (up to this %).']];
  const tIn = tables.map(([k, e, title, unit, lead]) => ({ k, e, title, unit, lead, rows: S[k].map(([lim, name]) => [h('input', { value: lim.replace('.', ','), inputmode: 'decimal', 'aria-label': title + ' limit' }), h('input', { class: 'set-name', value: name, 'aria-label': title + ' name' })]), other: h('input', { class: 'set-name', value: S[e], 'aria-label': title + ' else' }) }));
  const save = async () => {
    msg.style.display = 'none'; const ns = structuredClone(st.settings);
    for (const [path, [i, kind]] of inputs) { const v = D.parse(i.value); if (v === null || v < 0n || (kind === 'int' && v % D.SCALE !== 0n)) { msg.textContent = `■ “${i.getAttribute('aria-label')}” must be a ${kind === 'int' ? 'whole ' : ''}number (0 or more).`; msg.style.display = 'flex'; return; } setP(ns, path, kind === 'int' ? String(Number(v / D.SCALE)) : D.toStr(v)); if (kind === 'int') setP(ns, path, Number(v / D.SCALE)); }
    for (const t of tIn) { ns[t.k] = []; for (const [l, n] of t.rows) { const v = D.parse(l.value); if (v === null) { msg.textContent = '■ A label limit is not a number.'; msg.style.display = 'flex'; return; } ns[t.k].push([D.toStr(v), n.value.trim()]); } ns[t.e] = t.other.value.trim(); }
    if (ns.excelCopyDays < 1 || ns.excelCopyDays > 365) { msg.textContent = '■ Make an Excel copy every 1 to 365 days.'; msg.style.display = 'flex'; return; }
    if (ns.excelCopyKeep < 1 || ns.excelCopyKeep > 52) { msg.textContent = '■ Keep between 1 and 52 Excel copies.'; msg.style.display = 'flex'; return; }
    if (ns.saveDelaySec > 120) { msg.textContent = '■ Waiting more than 120 seconds before saving is too long.'; msg.style.display = 'flex'; return; }
    const ok = await dialog({ title: 'Save the new settings?', body: para('Marks and labels are recalculated on every screen. Saved trades keep their data.', ''), ok: 'Save settings' }); if (!ok) return;
    const r = ctx.act((d) => { d.settings = ns; return { ok: true }; }, { label: 'settings', now: true }); toast(r.ok ? 'Settings saved.' : r.error);
  };
  const card = (title, lead, kids) => h('section', { class: 'panel set-card' }, h('div', { class: 'set-h' }, h('h3', null, title), lead ? h('p', null, lead) : null), h('div', { class: 'set-b' }, kids));
  const groupEls = GROUPS.map(([title, lead, rows]) => card(title, lead, rows.map((r) => (typeof r === 'string' ? h('div', { class: 'set-sub' }, r) : mk(...r)))));
  const tableEls = tIn.map((t) => card(t.title, t.lead, [...t.rows.map(([a, b]) => h('label', { class: 'set-row' }, b, unitBox(a, t.unit))),
    h('div', { class: 'set-row' }, t.other, h('span', { class: 'set-val else' }, 'anything else'))]));
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '1120px' } },
    h('div', { class: 'note' }, 'Numbers use a decimal comma. These limits only change which marks you see; they never block anything.'),
    h('div', { class: 'set-grid' }, groupEls, tableEls), msg,
    h('div', { class: 'row' }, h('button', { class: 'btn pri', disabled: ctx.readOnly, onClick: save }, 'Save settings'), h('button', { class: 'btn', onClick: () => ctx.redraw() }, 'Cancel')),
    h('section', { class: 'panel' }, h('div', { class: 'ph' }, 'Account'), h('div', { class: 'pb', style: { display: 'grid', gap: '8px' } },
      h('dl', { class: 'kv' }, h('dt', null, 'Program version'), h('dd', null, APP_VERSION + ' (Version 1)'), h('dt', null, 'Data file'), h('dd', null, ctx.demo ? 'Demo, nothing saved' : ctx.storage.describe().file + ' in “' + ctx.storage.describe().folder + '”'), h('dt', null, 'Google account'), h('dd', null, ctx.account || '–')),
      ctx.demo ? null : h('div', { class: 'row' }, h('button', { class: 'btn quiet-dng', onClick: async () => { const ok = await dialog({ title: 'Disconnect from Google?', ok: 'Disconnect', danger: true, body: para('The program forgets the connection and reloads. Your data stays in your Drive. You can sign in again at any time.', '') }); if (!ok) return; await ctx.saver.flush(); await ctx.storage.releaseLock?.(); ctx.auth.revoke(); location.reload(); } }, 'Disconnect…')))));
}
