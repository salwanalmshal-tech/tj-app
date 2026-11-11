// Settings (redesign 2026-11-06, after his "Settings Control Center" example): a left menu with six sections, each section
// shows its limits as rows (meaning, value, the mark it gives) or as zone cards (one card per colour zone). Only the layout
// changed: the limits, rules, validation and the Save confirmation are the same as before. Nothing here blocks a trade.
import { APP_VERSION } from '../model.js';
import { h, dialog, para, toast, infoBtn } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';

const getP = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
const setP = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
const show = (v) => String(v).replace('.', ',');
let lastSection = 'rules';
export const goSection = (k) => { lastSection = k; };

const SECTIONS = [
  ['Trading', [['rules', 'Trading rules', 'Stops, EMA10 and reports'], ['risk', 'Risk and position size', 'Capital at risk and allocation']]],
  ['Journal', [['results', 'Results and labels', 'R labels and stop distance'], ['history', 'History marks', 'Closed-trade highlighting']]],
  ['System', [['saving', 'Saving and backup', 'Autosave and Excel copies'], ['account', 'Account and data', 'Version, file and connection']]],
];

export function render(ctx) {
  const st = ctx.store.state; const S = structuredClone(st.settings);
  const inputs = new Map(); const live = []; // live = small texts that follow the typed values
  const msg = h('div', { class: 'msg bad', role: 'alert', style: { display: 'none' } });
  const status = h('span', { class: 'set-status ok' }, 'All changes saved');
  const dirty = () => { status.className = 'set-status warn'; status.textContent = 'Unsaved changes'; };
  const refresh = () => { for (const f of live) f(); };
  const val = (path) => { const i = inputs.get(path)?.[0]; return i ? i.value.trim() || '–' : show(getP(S, path)); };

  // a number box with its unit inside
  const num = (path, kind, unit, label) => {
    const i = h('input', { value: show(getP(S, path)), inputmode: 'decimal', 'aria-label': label });
    i.addEventListener('input', () => { dirty(); refresh(); });
    inputs.set(path, [i, kind]);
    return h('span', { class: 'sv' }, i, unit ? h('span', { class: 'su' }, unit) : null);
  };
  // a row: meaning (+ one quiet line), the value, and the mark it gives
  const row = ({ path, kind = 'num', unit = '%', label, sub, why, chip, tone = 'plain' }) =>
    h('div', { class: 'srow' },
      h('div', { class: 'sl' }, h('b', null, label, why ? infoBtn(label, why) : null), sub ? h('span', null, sub) : null),
      num(path, kind, unit, label),
      h('span', { class: 'schip ' + tone }, chip));
  // a zone card: coloured top line, name, value (typed or derived), one quiet line
  const zone = ({ tone, name, body, note }) => h('div', { class: 'zone ' + tone }, h('div', { class: 'zn' }, name), h('div', { class: 'zv' }, body), note ? h('div', { class: 'zd' }, note) : null);
  const derived = (fn) => { const el = h('span', { class: 'zt' }); const f = () => { el.textContent = fn(); }; live.push(f); f(); return el; };
  const card = (title, tag, ...kids) => h('section', { class: 'scard' }, h('div', { class: 'sch' }, h('h3', null, title), tag ? h('span', { class: 'stag' }, tag) : null), h('div', { class: 'scb' }, kids));

  // ---------------------------------------------------------------- sections
  const rules = [
    card('Stop management', 'Open positions',
      row({ path: 'stopBelowBuy.raiseAbove', label: 'Raise stop · stop below buy price', sub: 'When the last price moves far above the stop.', chip: 'Raise stop', tone: 'warn' }),
      row({ path: 'stopBelowBuy.closeWithin', label: 'Close to stop · stop below buy price', sub: 'When the last price is this close above the stop.', chip: 'Close to stop', tone: 'warn' }),
      row({ path: 'stopAboveBuy.raiseAbove', label: 'Raise stop · stop above buy price', sub: 'Profit is protected; review the stop once the price runs.', chip: 'Raise stop', tone: 'warn' }),
      row({ path: 'stopAboveBuy.closeWithin', label: 'Close to stop · stop above buy price', chip: 'Close to stop', tone: 'warn' }),
      row({ path: 'highestToStop', label: 'Stop far below highest price', sub: 'Highest price is more than this above the stop.', chip: 'Stop far below highest price', tone: 'warn' })),
    card('Price and report signals', 'Daily monitoring',
      row({ path: 'emaNear', label: 'Near EMA10', sub: 'Last price less than this above EMA10. Below EMA10 is always red.', chip: 'Near EMA10', tone: 'warn' }),
      row({ path: 'reportedAgoDays', kind: 'int', unit: 'days', label: 'Show “Reported N days ago”', sub: 'Quiet reminder after a report.', chip: 'Reported N days ago', tone: 'plain' }),
      row({ path: 'reportStaleDays', kind: 'int', unit: 'days', label: 'Report date too old', sub: 'No new report date entered after this many days.', chip: 'Needs attention', tone: 'warn' })),
  ];
  const risk = [
    card('Risk at stop', '% of capital at open',
      h('div', { class: 'zones' },
        zone({ tone: 'blue', name: 'Normal', body: derived(() => 'up to ' + val('riskWarn') + ' %'), note: 'No mark.' }),
        zone({ tone: 'amber', name: 'Orange', body: h('span', { class: 'zt' }, 'above ', num('riskWarn', 'num', '%', 'Risk at stop, orange above')), note: 'Risk of Capital shown orange.' }),
        zone({ tone: 'red', name: 'Red', body: h('span', { class: 'zt' }, 'above ', num('riskRed', 'num', '%', 'Risk at stop, red above')), note: 'Risk of Capital shown red.' }))),
    card('Position size', '% of estimated account',
      h('div', { class: 'zones' },
        zone({ tone: 'blue', name: 'Small', body: h('span', { class: 'zt' }, num('posSmallFrom', 'num', '', 'Small position from'), '–', num('posSmallTo', 'num', '%', 'Small position up to')), note: 'Position size shown blue.' }),
        zone({ tone: 'green', name: 'Normal', body: derived(() => 'below ' + val('posNear') + ' %'), note: 'Position size green.' }),
        zone({ tone: 'amber', name: 'Near limit', body: h('span', { class: 'zt' }, 'from ', num('posNear', 'num', '%', 'Position size, orange from')), note: 'Position size orange.' }),
        zone({ tone: 'red', name: 'Too big', body: h('span', { class: 'zt' }, 'above ', num('posTooBig', 'num', '%', 'Position size, red above')), note: 'Position size red.' }))),
    card('Stop compared with the buy price', 'Card marks',
      row({ path: 'stopFarBelowBuy', label: 'Stop far below buy price', sub: derived(() => `Only when the stop is more than ${val('stopFarBelowBuy')} % below the buy price AND the risk at stop is above ${val('stopFarBelowBuyRisk')} %.`), why: 'One rule with two settings: it shows only when both are true.', chip: 'Stop far below buy price', tone: 'warn' }),
      row({ path: 'stopFarBelowBuyRisk', label: '… and risk at stop above', unit: '% cap.', chip: 'Both must be true', tone: 'plain' }),
      row({ path: 'profitLocked', label: 'Profit locked in', sub: 'Stop more than this above the buy price. Also keeps a near report calm.', chip: 'Profit locked in', tone: 'pos' })),
  ];

  // R labels and stop distance labels: name and limit can both be changed
  const tables = [];
  const labelZones = (k, e, unit, word, tones, elseNote) => {
    const rows = S[k].map(([lim, name], n) => {
      const nm = h('input', { class: 'zname', value: name, 'aria-label': `Label ${n + 1} name` }); const li = h('input', { value: show(lim), inputmode: 'decimal', 'aria-label': `${name} limit` });
      for (const x of [nm, li]) x.addEventListener('input', () => { dirty(); refresh(); });
      return { nm, li, tone: tones[n] ?? 'blue' };
    });
    const other = h('input', { class: 'zname', value: S[e], 'aria-label': 'Label for anything else' }); other.addEventListener('input', dirty);
    tables.push({ k, e, rows, other });
    const lastLim = () => rows.at(-1)?.li.value.trim() || '–';
    return h('div', { class: 'zones' },
      ...rows.map((r) => zone({ tone: r.tone, name: r.nm, body: h('span', { class: 'zt' }, word, ' ', h('span', { class: 'sv' }, r.li, h('span', { class: 'su' }, unit))) })),
      zone({ tone: tones.at(-1), name: other, body: derived(() => (k === 'rCategories' ? 'below ' : 'above ') + lastLim() + (unit === 'R' ? ' R' : ' %')), note: elseNote }));
  };
  const results = [
    card('Trade result · R multiple', 'Outcome scale',
      h('p', { class: 'snote' }, 'A trade gets the first label whose R it reaches, from the top.'),
      labelZones('rCategories', 'rCategoryElse', 'R', 'from', C.R_TONES, 'Anything lower.')),
    card('Stop distance', 'Buy price to Initial stop',
      h('p', { class: 'snote' }, 'Distance from the buy price down to the Initial stop. The first label it stays within is used.'),
      labelZones('stopDistance', 'stopDistanceElse', '%', 'up to', ['blue', 'green', 'amber', 'red'], 'Anything wider.')),
    card('How labels work', 'Display only', h('p', { class: 'snote', style: { margin: 0 } }, 'Labels turn numbers into the same words everywhere in the journal. They never change a calculation, the win rate or the statistics.')),
  ];
  const history = [
    card('Result per trade', '% of capital at open',
      h('p', { class: 'snote' }, 'Shown in History\'s "% capital" column: ▼ red for a loss past the limit, ▲ green for a gain past the limit.'),
      row({ path: 'histLoss', label: 'Loss to highlight', sub: 'Closed trades that lost more than this of the capital.', chip: 'Loss above', tone: 'neg' }),
      row({ path: 'histGain', label: 'Gain to highlight', sub: 'Closed trades that gained more than this of the capital.', chip: 'Gain above', tone: 'pos' })),
    card('Result per stock', 'Coming with the Dashboard', h('p', { class: 'snote', style: { margin: 0 } }, 'Results grouped by stock will live on the Dashboard (not built yet). These limits are hidden here until then; nothing is lost.')),
  ];
  const saving = [
    card('Saving', 'Automatic',
      row({ path: 'saveDelaySec', kind: 'int', unit: 'sec', label: 'Save after your last edit', sub: 'Only for the Setup, Mistake and Stars edits in History\'s trade details, which save as you change them, with no Save button. Everywhere else, saving happens the moment you press Save.', chip: 'Automatic save', tone: 'plain' }),
      row({ path: 'bigJumpPct', label: 'Unusual last price jump', sub: 'Typed prices that jump more than this ask first.', chip: 'Save anyway?', tone: 'warn' })),
    card('Excel copy', 'Safety copy',
      row({ path: 'excelCopyDays', kind: 'int', unit: 'days', label: 'Make an Excel copy every', sub: 'Saved in the Backups folder in your Drive, for reading in Excel. Restoring always uses the JSON backups.', chip: 'Excel copy', tone: 'plain' }),
      row({ path: 'excelCopyKeep', kind: 'int', unit: 'copies', label: 'Keep the newest', sub: 'Older Excel copies are deleted; JSON backups are not.', chip: 'Older removed', tone: 'plain' })),
  ];
  const kv = (k, v) => h('div', { class: 'srow kv' }, h('div', { class: 'sl' }, h('span', null, k)), h('b', null, v));
  const account = [
    card('Program', 'Read only',
      kv('Program version', APP_VERSION + ' · Version 1'),
      kv('Data file', ctx.demo ? 'Demo, nothing saved' : ctx.storage.describe().file + ' in “' + ctx.storage.describe().folder + '”'),
      kv('Google account', ctx.account || '–'),
      ctx.demo ? null : h('div', { class: 'srow kv' }, h('div', { class: 'sl' }, h('span', null, 'Connection')), h('button', { class: 'btn quiet-dng', onClick: async () => { const ok = await dialog({ title: 'Disconnect from Google?', ok: 'Disconnect', danger: true, body: para('The program forgets the connection and reloads. Your data stays in your Drive. You can sign in again at any time.', '') }); if (!ok) return; await ctx.saver.flush(); await ctx.storage.releaseLock?.(); ctx.auth.revoke(); location.reload(); } }, 'Disconnect…'))),
  ];
  const BODY = { rules, risk, results, history, saving, account };
  const TITLES = Object.fromEntries(SECTIONS.flatMap(([g, items]) => items.map(([k, t, sub]) => [k, [g, t, sub]])));

  // ---------------------------------------------------------------- save (same checks as before)
  const save = async () => {
    msg.style.display = 'none'; const ns = structuredClone(st.settings);
    const fail = (t) => { msg.textContent = '■ ' + t; msg.style.display = 'flex'; };
    for (const [path, [i, kind]] of inputs) { const v = D.parse(i.value); if (v === null || v < 0n || (kind === 'int' && v % D.SCALE !== 0n)) return fail(`“${i.getAttribute('aria-label')}” must be a ${kind === 'int' ? 'whole ' : ''}number (0 or more).`); setP(ns, path, kind === 'int' ? Number(v / D.SCALE) : D.toStr(v)); }
    for (const t of tables) { ns[t.k] = []; for (const r of t.rows) { const v = D.parse(r.li.value); if (v === null) return fail('A label limit is not a number.'); if (!r.nm.value.trim()) return fail('A label name is empty.'); ns[t.k].push([D.toStr(v), r.nm.value.trim()]); } ns[t.e] = t.other.value.trim(); }
    if (ns.excelCopyDays < 1 || ns.excelCopyDays > 365) return fail('Make an Excel copy every 1 to 365 days.');
    if (ns.excelCopyKeep < 1 || ns.excelCopyKeep > 52) return fail('Keep between 1 and 52 Excel copies.');
    if (ns.saveDelaySec > 120) return fail('Waiting more than 120 seconds before saving is too long.');
    // review fix 2026-11-09: limits that contradict each other would make some marks or labels never appear
    const num = (x) => D.d(String(x));
    for (let i = 1; i < ns.rCategories.length; i++) if (num(ns.rCategories[i][0]) >= num(ns.rCategories[i - 1][0])) return fail(`Trade result labels: each limit must be lower than the one above it (“${ns.rCategories[i][1]}”).`);
    for (let i = 1; i < ns.stopDistance.length; i++) if (num(ns.stopDistance[i][0]) <= num(ns.stopDistance[i - 1][0])) return fail(`Stop distance labels: each limit must be higher than the one above it (“${ns.stopDistance[i][1]}”).`);
    if (num(ns.riskWarn) >= num(ns.riskRed)) return fail('The risk attention limit must be lower than the red risk limit.');
    if (num(ns.posSmallFrom) >= num(ns.posSmallTo)) return fail('Position size “small from” must be lower than “small to”.');
    if (num(ns.posNear) >= num(ns.posTooBig)) return fail('Position size “near the limit” must be lower than “too big”.');
    // Q20 (agreed 2026-11-08): say how many closed trades get a different label
    let changed = 0; for (const t of st.trades) { if (!(t.sales.length && C.openQty(t) === 0n)) continue; const R = C.rMultiple(t), sd = C.stopDistancePct(t);
      if (C.rCategory(R, st.settings) !== C.rCategory(R, ns) || C.stopDistanceLabel(sd, st.settings) !== C.stopDistanceLabel(sd, ns)) changed++; }
    const ok = await dialog({ title: 'Save the new settings?', body: para('Marks and labels are recalculated on every screen. Saved trades keep their data.' + (changed ? ` ${changed} closed trade${changed === 1 ? ' gets' : 's get'} a different result or stop-distance label.` : ''), ''), ok: 'Save settings' }); if (!ok) return;
    const r = ctx.act((d) => { d.settings = ns; return { ok: true }; }, { label: 'settings', now: true }); toast(r.ok ? 'Settings saved.' : r.error);
  };

  // ---------------------------------------------------------------- layout
  const panes = {}; const navBtns = {};
  const head = h('div', { class: 'spane-h' });
  const pick = (key) => {
    lastSection = key;
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== key;
    for (const [k, b] of Object.entries(navBtns)) b.classList.toggle('on', k === key);
    const [g, t, sub] = TITLES[key]; head.replaceChildren(h('div', { class: 'crumb' }, g + ' / ' + t), h('h2', null, t), h('p', null, sub));
  };
  for (const [k, kids] of Object.entries(BODY)) panes[k] = h('div', { class: 'spane-b' }, kids);
  const nav = h('nav', { class: 'snav', 'aria-label': 'Settings sections' }, SECTIONS.map(([g, items]) => [h('div', { class: 'sng' }, g),
    ...items.map(([k, t, sub]) => (navBtns[k] = h('button', { type: 'button', onClick: () => pick(k) }, h('b', null, t), h('span', null, sub))))]));
  pick(BODY[lastSection] ? lastSection : 'rules');
  return h('div', { class: 'sset' },
    h('div', { class: 'sset-top' }, status),
    h('div', { class: 'sset-grid' }, nav,
      h('div', { class: 'spane' }, head, ...Object.values(panes), msg,
        h('div', { class: 'sfoot' }, h('span', { class: 'note' }, 'Settings change marks and guidance only. They never block a trade.'),
          h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => ctx.redraw() }, 'Cancel'), h('button', { class: 'btn pri', disabled: ctx.readOnly, onClick: save }, 'Save settings'))))));
}
