import { h, dialog, para, toast, field, infoBtn } from './dom.js';
import * as D from '../decimal.js';

const GROUPS = [
  ['Saving', [['saveDelaySec', 'Seconds to wait after your last edit before saving', 'int'], ['bigJumpPct', 'Ask before saving a last price that jumps more than (%)', 'num', 'Starting value. Typed prices that jump more than this ask “Save anyway?”.']]],
  ['Stops check', [['stopBelowBuy.raiseAbove', 'Stop below buy price: “Raise stop” when price is more than (%) above the stop', 'num'], ['stopBelowBuy.closeWithin', 'Stop below buy price: “Close to stop” within (%)', 'num'], ['stopAboveBuy.raiseAbove', 'Stop above buy price: “Raise stop” when more than (%)', 'num'], ['stopAboveBuy.closeWithin', 'Stop above buy price: “Close to stop” within (%)', 'num']]],
  ['Other line marks', [['reportedAgoDays', 'Show “Reported N days ago” for (days)', 'int'], ['highestToStop', 'Stop far below highest price: more than (%)', 'num'], ['emaNear', 'Near EMA10: less than (%) above', 'num'], ['stopFarBelowBuy', 'Stop far below buy price: more than (%)', 'num'], ['profitLocked', 'Profit locked in: stop more than (%) above buy', 'num'],
    ['riskWarn', 'Risk at stop, warning above (% of capital)', 'num'], ['riskRed', 'Risk at stop, red above (% of capital)', 'num'], ['posTooBig', 'Position too big above (% of account)', 'num'], ['posNear', 'Near size limit from (%)', 'num'], ['posSmallFrom', 'Small position from (%)', 'num'], ['posSmallTo', 'Small position up to (%)', 'num']]],
  ['History marks', [['histLoss', 'Loss above (% of capital at open)', 'num'], ['histGain', 'Gain above (% of capital at open)', 'num'], ['stockLoss1', 'Per stock: loss above (%)', 'num'], ['stockLoss2', 'Per stock: big loss above (%)', 'num'], ['stockGain1', 'Per stock: gain above (%)', 'num'], ['stockGain2', 'Per stock: big gain above (%)', 'num']]],
];
const getP = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setP = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

export function render(ctx) {
  const st = ctx.store.state; const S = structuredClone(st.settings); const inputs = new Map(); const msg = h('div', { class: 'msg bad', role: 'alert', style: { display: 'none' } });
  const mk = (path, label, kind, why) => { const i = h('input', { value: String(getP(S, path)).replace('.', ','), inputmode: 'decimal', style: { width: '90px', textAlign: 'right' }, 'aria-label': label }); inputs.set(path, [i, kind]); return h('label', { class: 'fld', style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } }, h('span', null, label, why ? infoBtn(label, why) : null), i); };
  const tables = [['rCategories', 'rCategoryElse', 'Trade R labels (from this R upwards)'], ['stopDistance', 'stopDistanceElse', 'Stop distance labels (up to this %)']];
  const tIn = tables.map(([k, e, title]) => ({ k, e, title, rows: S[k].map(([lim, name]) => [h('input', { value: lim.replace('.', ','), style: { width: '70px', textAlign: 'right' }, 'aria-label': title + ' limit' }), h('input', { value: name, 'aria-label': title + ' name' })]), other: h('input', { value: S[e], 'aria-label': title + ' else' }) }));
  const save = async () => {
    msg.style.display = 'none'; const ns = structuredClone(st.settings);
    for (const [path, [i, kind]] of inputs) { const v = D.parse(i.value); if (v === null || v < 0n || (kind === 'int' && v % D.SCALE !== 0n)) { msg.textContent = `■ “${i.getAttribute('aria-label')}” must be a ${kind === 'int' ? 'whole ' : ''}number (0 or more).`; msg.style.display = 'flex'; return; } setP(ns, path, kind === 'int' ? String(Number(v / D.SCALE)) : D.toStr(v)); if (kind === 'int') setP(ns, path, Number(v / D.SCALE)); }
    for (const t of tIn) { ns[t.k] = []; for (const [l, n] of t.rows) { const v = D.parse(l.value); if (v === null) { msg.textContent = '■ A label limit is not a number.'; msg.style.display = 'flex'; return; } ns[t.k].push([D.toStr(v), n.value.trim()]); } ns[t.e] = t.other.value.trim(); }
    if (ns.saveDelaySec > 120) { msg.textContent = '■ Waiting more than 120 seconds before saving is too long.'; msg.style.display = 'flex'; return; }
    const ok = await dialog({ title: 'Save the new settings?', body: para('Marks and labels are recalculated on every screen. Saved trades keep their data.', ''), ok: 'Save settings' }); if (!ok) return;
    const r = ctx.act((d) => { d.settings = ns; return { ok: true }; }, { label: 'settings', now: true }); toast(r.ok ? 'Settings saved.' : r.error);
  };
  const groupEls = GROUPS.map(([title, rows]) => h('section', { class: 'panel' }, h('div', { class: 'ph' }, title), h('div', { class: 'pb', style: { display: 'grid', gap: '8px' } }, rows.map(([p, l, k, why]) => mk(p, l, k, why)))));
  const tableEls = tIn.map((t) => h('section', { class: 'panel' }, h('div', { class: 'ph' }, t.title), h('div', { class: 'pb', style: { display: 'grid', gap: '8px' } }, t.rows.map(([a, b]) => h('div', { class: 'row' }, a, b)), h('div', { class: 'row' }, h('span', { class: 'note' }, 'Anything else:'), t.other))));
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '900px' } },
    h('div', { class: 'note' }, 'Numbers use a decimal comma. These limits only change which marks you see; they never block anything.'),
    groupEls, tableEls, msg,
    h('div', { class: 'row' }, h('button', { class: 'btn pri', disabled: ctx.readOnly, onClick: save }, 'Save settings'), h('button', { class: 'btn', onClick: () => ctx.redraw() }, 'Cancel')),
    h('section', { class: 'panel' }, h('div', { class: 'ph' }, 'Account'), h('div', { class: 'pb', style: { display: 'grid', gap: '8px' } },
      h('dl', { class: 'kv' }, h('dt', null, 'Program version'), h('dd', null, '1.0.0 (Version 1)'), h('dt', null, 'Data file'), h('dd', null, ctx.demo ? 'Demo, nothing saved' : ctx.storage.describe().file + ' in “' + ctx.storage.describe().folder + '”'), h('dt', null, 'Google account'), h('dd', null, ctx.account || '–')),
      ctx.demo ? null : h('div', { class: 'row' }, h('button', { class: 'btn quiet-dng', onClick: async () => { const ok = await dialog({ title: 'Disconnect from Google?', ok: 'Disconnect', danger: true, body: para('The program forgets the connection and reloads. Your data stays in your Drive. You can sign in again at any time.', '') }); if (!ok) return; await ctx.saver.flush(); await ctx.storage.releaseLock?.(); ctx.auth.revoke(); location.reload(); } }, 'Disconnect…')))));
}
