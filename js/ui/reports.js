// 1.7.0 Reports (plan step 3, agreed 2026-11-15, preview "TJ Reports preview"): ONE place for all reports.
// Tab "My reports": the builder (group by, then by, measures, Bars | Line, his own saved filters) + his reports (3 examples
// to start), Excel, and switches to show a report on Dashboard, History or Open positions.
// Tab "Built-in blocks": every block the program has, under the screen it comes from, each with a Shown switch.
// Numbers come from History's own engine (runReport), so a report and History never disagree.
import { h, toast, dialog, para, download } from './dom.js';
import * as C from '../calc.js';
import * as A from '../actions.js';
import { runReport, GROUP_NAMES, MEASURE_NAMES, measureText, measureTone, filterBar, blankFilters, filterText, openTradesInHistory } from './history.js';
import { todayISO } from '../dates.js';

const V = { tab: 'mine', cur: null, draft: null, dirty: false };
export function openReport(id) { V.tab = 'mine'; V.cur = id; V.draft = null; V.dirty = false; }

const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const SERIES = ['#326B9E', '#28765A', '#9B6B23', '#6B4FA0', '#AC4C45', '#3D8C9E'];

// ---------------------------------------------------------------- chart + table of one report
function chartEl(run, rep, compact) {
  const m = rep.measures[0]; const W = compact ? 440 : 900, H = compact ? 190 : 240, L = 56, Rr = 12, T = 22, B = compact ? 30 : 34;
  const series = rep.g2 ? run.series.slice(0, 6) : null;
  const cell = (r, sk) => (series ? r.sub?.find((x) => x.key === sk)?.vals[m] ?? null : r.vals[m]);
  const vals = run.rows.flatMap((r) => (series ? series.map((sr) => cell(r, sr.key)) : [cell(r)])).filter((v) => v !== null && Number.isFinite(v));
  if (!run.rows.length || !vals.length) return h('div', { class: 'r-empty' }, run.trades ? 'Nothing to draw for this measure.' : 'No closed trades match these filters.');
  let hi = Math.max(0, ...vals), lo = Math.min(0, ...vals); if (hi === lo) hi = lo + 1;
  const y = (v) => T + (H - T - B) * (hi - v) / (hi - lo); const zero = y(0);
  const n = run.rows.length, step = (W - L - Rr) / n, x = (i) => L + step * (i + 0.5);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'r-chart', role: 'img', 'aria-label': `${rep.name}: ${MEASURE_NAMES[m]}` });
  for (const v of [hi, (hi + lo) / 2, lo]) { svg.append(s('line', { x1: L, x2: W - Rr, y1: y(v), y2: y(v), class: 'r-gl' }), s('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'r-ax' }, measureText(m, v))); }
  svg.append(s('line', { x1: L, x2: W - Rr, y1: zero, y2: zero, class: 'r-zero' }));
  const col = (v, i) => (series ? SERIES[i % SERIES.length] : ['trades', 'wins', 'losses', 'sales', 'winRate', 'be', 'days', 'ratio'].includes(m) ? '#326B9E' : v >= 0 ? '#28765A' : '#AC4C45');
  const showVal = !compact && !series && n <= 14;
  if (rep.chart === 'line') {
    const lines = series ? series.map((sr) => run.rows.map((r, i) => [i, cell(r, sr.key)])) : [run.rows.map((r, i) => [i, cell(r)])];
    lines.forEach((pts, si) => { const ok = pts.filter(([, v]) => v !== null);
      if (ok.length > 1) svg.append(s('polyline', { points: ok.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '), class: 'r-line', stroke: series ? SERIES[si % SERIES.length] : '#326B9E' }));
      for (const [i, v] of ok) { svg.append(s('circle', { cx: x(i), cy: y(v), r: 4.5, class: 'r-dot', stroke: series ? SERIES[si % SERIES.length] : '#326B9E' }));
        if (showVal) svg.append(s('text', { x: x(i), y: y(v) - 10, 'text-anchor': 'middle', class: 'r-val' }, measureText(m, v))); } });
    if (m === 'winRate' && !series && run.total.be !== undefined) { /* break-even line only when that measure is ticked too */ }
  } else {
    const k = series ? series.length : 1; const bw = Math.min(64, (step * 0.72) / k);
    run.rows.forEach((r, i) => { (series || [null]).forEach((sr, si) => { const v = cell(r, sr?.key); if (v === null) return;
      const bx = x(i) - (bw * k) / 2 + bw * si; const top = Math.min(y(v), zero), hgt = Math.max(1.5, Math.abs(y(v) - zero));
      svg.append(s('rect', { x: bx + 1, y: top, width: Math.max(2, bw - 2), height: hgt, rx: 4, fill: col(v, si), class: 'r-bar' }));
      if (showVal) svg.append(s('text', { x: x(i), y: v >= 0 ? top - 6 : top + hgt + 13, 'text-anchor': 'middle', class: 'r-val' }, measureText(m, v))); }); });
  }
  const every = Math.ceil(n / (compact ? 5 : 14));
  run.rows.forEach((r, i) => { if (i % every === 0) svg.append(s('text', { x: x(i), y: H - (compact ? 10 : 12), 'text-anchor': 'middle', class: 'r-ax' }, r.label.length > 14 ? r.label.slice(0, 13) + '…' : r.label)); });
  const legend = series ? h('div', { class: 'r-legend' }, series.map((sr, i) => h('span', null, h('i', { style: { background: SERIES[i % SERIES.length] } }), sr.label)), run.series.length > 6 ? h('span', { class: 'note' }, `+${run.series.length - 6} more in the table`) : null) : null;
  return h('div', null, svg, legend);
}
function tableEl(ctx, run, rep, compact) {
  const cells = (vals) => rep.measures.map((m) => h('td', { class: 'r ' + measureTone(m, vals[m]) }, measureText(m, vals[m])));
  const open = (ids, label) => (ids.length ? () => openTradesInHistory(ctx, ids, label) : null);
  const body = [];
  for (const r of run.rows) {
    body.push(h('tr', { class: 'r-row', title: 'Open these trades in History', onClick: open(r.ids, `${rep.name}: ${r.label}`) }, h('td', null, r.label, h('span', { class: 'note' }, ` · ${r.n}`)), cells(r.vals)));
    for (const x of r.sub || []) body.push(h('tr', { class: 'r-row sub', onClick: open(x.ids, `${rep.name}: ${r.label} · ${x.label}`) }, h('td', null, x.label, h('span', { class: 'note' }, ` · ${x.n}`)), cells(x.vals)));
  }
  body.push(h('tr', { class: 'r-tot' }, h('td', null, 'All'), cells(run.total)));
  return h('div', { class: 'r-tw' + (compact ? ' compact' : '') }, h('table', { class: 'r-table' },
    h('thead', null, h('tr', null, h('th', null, GROUP_NAMES[rep.g1] + (rep.g2 ? ' · ' + GROUP_NAMES[rep.g2] : '')), rep.measures.map((m) => h('th', { class: 'r' }, MEASURE_NAMES[m])))),
    h('tbody', null, body)));
}
// a report as a block on Dashboard, History or Open positions (its own saved filters)
export function reportBlock(ctx, rep, opts = {}) {
  const run = runReport(ctx.store.state, rep);
  return h('section', { class: 'scard r-blk' },
    h('div', { class: 'r-bh' }, opts.grip ? opts.grip.cloneNode(true) : null,
      h('button', { class: 'r-title', type: 'button', title: 'Open in Reports', onClick: () => { openReport(rep.id); ctx.go('report'); } }, rep.name, ' →'),
      h('span', { class: 'r-mine' }, 'My report')),
    h('span', { class: 'note r-ft' }, filterText(ctx.store.state, rep.filters) + ` · ${run.trades} trade${run.trades === 1 ? '' : 's'}`),
    chartEl(run, rep, true), tableEl(ctx, run, rep, true));
}
async function exportExcel(ctx, rep) {
  try {
    const run = runReport(ctx.store.state, rep); const X = await (await import('./data.js')).loadXLSX();
    const row = (a, b, vals) => ({ [GROUP_NAMES[rep.g1]]: a, ...(rep.g2 ? { [GROUP_NAMES[rep.g2]]: b } : {}), ...Object.fromEntries(rep.measures.map((m) => [MEASURE_NAMES[m], vals[m] === null ? '' : +(+vals[m]).toFixed(4)])) });
    const data = []; for (const r of run.rows) { data.push(row(r.label, '', r.vals)); for (const x of r.sub || []) data.push(row(r.label, x.label, x.vals)); }
    data.push(row('All', '', run.total));
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.json_to_sheet(data), 'Report');
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet([{ Report: rep.name, Trades: filterText(ctx.store.state, rep.filters), 'Made on': todayISO() }]), 'About');
    download(`TradeJournal-Report-${rep.name.replace(/[^\w-]+/g, '_')}-${todayISO()}.xlsx`, new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  } catch (e) { toast(e.message); }
}

// ---------------------------------------------------------------- the page
export function render(ctx) {
  const st = ctx.store.state;
  const tabs = h('div', { class: 'seg', role: 'tablist' }, [['mine', 'My reports'], ['blocks', 'Built-in blocks']].map(([k, l]) =>
    h('button', { class: 'seg-b', role: 'tab', 'aria-pressed': String(V.tab === k), onClick: () => { V.tab = k; ctx.redraw(); } }, l)));
  const head = h('header', { class: 'pg-head' },
    h('div', null, h('div', { class: 'eyebrow' }, 'Learn'), h('h1', null, 'Reports'),
      h('p', { class: 'lead' }, V.tab === 'mine' ? 'Your own tables and charts. Each report keeps its own filters and updates after every closed trade.' : 'Every block the program has, under the screen it comes from. Switch one off to take it away from that screen; it stays here.')),
    h('div', { class: 'acts' }, tabs));
  return h('div', { class: 'rpage' }, head, V.tab === 'mine' ? mine(ctx, st) : builtIns(ctx, st));
}

const sw = (on, label, onClick, disabled, title) => h('button', { class: 'r-sw' + (on ? ' on' : ''), type: 'button', 'aria-pressed': String(on), disabled, title, onClick }, h('span', { class: 'r-knob' }, h('i')), label);

function mine(ctx, st) {
  const reps = st.reports || [];
  if (V.cur !== 'new' && !reps.some((r) => r.id === V.cur)) { V.cur = reps[0]?.id ?? 'new'; V.draft = null; V.dirty = false; }
  if (!V.draft) { const r = reps.find((x) => x.id === V.cur); V.draft = r ? structuredClone(r) : { id: null, name: 'New report', g1: 'month', g2: '', measures: ['net', 'trades', 'winRate'], chart: 'bar', filters: { period: 'year' } }; V.dirty = !r; }
  const d = V.draft; d.filters = { ...blankFilters(), ...(d.filters || {}) };
  const pick = async (id) => { if (V.dirty && V.cur !== id) { const go = await dialog({ title: 'Leave this report without saving?', ok: 'Leave without saving', body: para('Your changes to this report are not saved yet.', '') }); if (!go) return; } V.cur = id; V.draft = null; V.dirty = false; ctx.redraw(); };
  const list = h('nav', { class: 'scard r-list', 'aria-label': 'My reports' },
    h('button', { class: 'btn pri', type: 'button', disabled: ctx.readOnly, onClick: () => pick('new') }, '+ New report'),
    reps.map((r) => { const on = C.shownOn(st, 'r:' + r.id);
      return h('button', { class: 'r-li' + (r.id === V.cur ? ' on' : ''), type: 'button', onClick: () => pick(r.id) }, h('b', null, r.name), h('span', null, on.length ? 'On ' + on.map((x) => C.SCREEN_NAME[x]).join(', ') : 'Only here')); }),
    V.cur === 'new' ? h('button', { class: 'r-li on', type: 'button' }, h('b', null, d.name || 'New report'), h('span', null, 'Not saved yet')) : null,
    h('div', { class: 'note', style: { padding: '10px 10px 2px' } }, 'The 3 examples can be changed, copied or deleted.'));

  const result = h('section', { class: 'scard r-res' });
  const status = h('span', { class: 'r-status' });
  const drawResult = () => {
    const run = runReport(st, d); const ok = d.measures.length && d.g1;
    status.textContent = V.dirty ? 'Not saved' : 'Saved'; status.className = 'r-status ' + (V.dirty ? 'warn' : 'ok');
    result.replaceChildren(h('div', { class: 'r-bh' }, h('h3', null, d.name || 'New report'), h('span', { class: 'note' }, ok ? `Chart: ${MEASURE_NAMES[d.measures[0]].toLowerCase()} · ${run.trades} closed trade${run.trades === 1 ? '' : 's'} · click a row to open its trades in History` : '')),
      ok ? chartEl(run, d, false) : h('div', { class: 'r-empty' }, 'Tick at least one measure.'), ok ? tableEl(ctx, run, d, false) : null);
  };
  const change = () => { V.dirty = true; drawResult(); };
  const sel = (label, value, opts, onPick) => { const e = h('select', { 'aria-label': label }, opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l))); e.addEventListener('change', () => onPick(e.value)); return e; };
  const g1 = sel('Group by', d.g1, Object.entries(GROUP_NAMES), (v) => { d.g1 = v; if (d.g2 === v) d.g2 = ''; V.dirty = true; ctx.redraw(); });
  const g2 = sel('Then by', d.g2, [['', '— none —'], ...Object.entries(GROUP_NAMES).filter(([k]) => k !== d.g1)], (v) => { d.g2 = v; change(); });
  const chartSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Chart' }, [['bar', 'Bars'], ['line', 'Line']].map(([k, l]) => h('button', { class: 'seg-b', type: 'button', 'aria-pressed': String(d.chart === k), onClick: () => { d.chart = k; V.dirty = true; ctx.redraw(); } }, l)));
  const chips = h('div', { class: 'r-chips' }, Object.entries(MEASURE_NAMES).map(([k, l]) => { const i = d.measures.indexOf(k);
    return h('button', { class: 'r-chip' + (i >= 0 ? ' on' : '') + (i === 0 ? ' first' : ''), type: 'button', 'aria-pressed': String(i >= 0), title: i === 0 ? 'In the chart' : i > 0 ? 'In the table' : 'Click to add',
      onClick: () => { d.measures = i >= 0 ? d.measures.filter((x) => x !== k) : [...d.measures, k]; V.dirty = true; ctx.redraw(); } }, i === 0 ? '◆ ' + l : l); }));
  const name = h('input', { class: 'r-name', value: d.name, 'aria-label': 'Report name', maxlength: 80 }); name.addEventListener('input', () => { d.name = name.value; V.dirty = true; status.textContent = 'Not saved'; status.className = 'r-status warn'; });
  const saved = reps.find((x) => x.id === V.cur);
  const save = () => { const r = ctx.act((x) => A.saveReport(x, { ...d, id: saved ? saved.id : null }), { label: 'report ' + (d.name || ''), now: true });
    if (!r.ok) return toast(r.error); V.cur = r.data.id; V.draft = null; V.dirty = false; ctx.redraw(); toast('Report saved.'); };
  const placeSw = C.SCREENS.map((sc) => { const on = !!saved && C.shownOn(st, 'r:' + saved.id).includes(sc);
    return sw(on, C.SCREEN_NAME[sc], () => { const r = ctx.act((x) => A.setShown(x, sc, 'r:' + saved.id, !on), { label: (on ? 'report off ' : 'report on ') + C.SCREEN_NAME[sc], now: true }); if (r && !r.ok) toast(r.error); },
      !saved || ctx.readOnly, !saved ? 'Save the report first' : on ? 'Shown there. Click to take it off (it stays here).' : 'Click to show it there'); });
  const builder = h('section', { class: 'scard r-build' },
    h('div', { class: 'r-top' }, h('label', { class: 'r-f' }, h('span', { class: 'eyebrow' }, 'Name'), name),
      h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } }, status,
        h('button', { class: 'btn', type: 'button', disabled: !saved || ctx.readOnly, onClick: () => { const r = ctx.act((x) => A.copyReport(x, saved.id), { label: 'copy report', now: true }); if (r.ok) { V.cur = r.data.id; V.draft = null; V.dirty = false; ctx.redraw(); toast('Copy made.'); } } }, 'Copy'),
        h('button', { class: 'btn', type: 'button', disabled: !d.measures.length, onClick: () => exportExcel(ctx, d) }, 'Excel'),
        h('button', { class: 'btn quiet-dng', type: 'button', disabled: !saved || ctx.readOnly, onClick: async () => {
          const on = C.shownOn(st, 'r:' + saved.id); const ok = await dialog({ title: `Delete the report “${saved.name}”?`, danger: true, ok: 'Delete report', body: para('The report is removed' + (on.length ? ', also from ' + on.map((x) => C.SCREEN_NAME[x]).join(', ') : '') + '. Your trades do not change. Undo is in the top bar right after.', '') });
          if (!ok) return; const r = ctx.act((x) => A.deleteReport(x, saved.id), { label: 'delete report', now: true }); if (r.ok) { V.cur = null; V.draft = null; V.dirty = false; ctx.redraw(); toast('Report deleted.', 'Undo', () => ctx.store.undo()); } } }, 'Delete…'),
        h('button', { class: 'btn pri', type: 'button', disabled: ctx.readOnly, onClick: save }, 'Save report'))),
    h('div', { class: 'r-g3' }, h('label', { class: 'r-f' }, h('span', { class: 'eyebrow' }, 'Group by'), g1), h('label', { class: 'r-f' }, h('span', { class: 'eyebrow' }, 'Then by (optional)'), g2), h('div', { class: 'r-f' }, h('span', { class: 'eyebrow' }, 'Chart'), chartSeg)),
    h('div', { class: 'r-f' }, h('span', { class: 'eyebrow' }, 'Measures · ◆ the first ticked one is in the chart, all ticked ones are in the table'), chips),
    h('div', { class: 'r-f' }, h('span', { class: 'eyebrow' }, 'Which trades · the same filters as History, saved with this report'), filterBar(st, d.filters, change)),
    h('div', { class: 'r-place' }, h('span', { class: 'eyebrow' }, 'Show this report on'), placeSw,
      h('span', { class: 'note' }, saved ? 'It goes last on that screen; move it there with drag and drop. Off = only taken off there, the report stays here.' : 'Save the report first.')));
  drawResult();
  return h('div', { class: 'r-grid' }, list, h('div', { class: 'r-main' }, builder, result));
}

function builtIns(ctx, st) {
  const group = (title, note, screen, items) => {
    const p = C.placement(st, screen); const here = new Set([...p.cards, ...p.blocks]);
    const rows = items.map((b) => { const on = here.has(b.id); const elsewhere = C.shownOn(st, b.id).filter((x) => x !== screen);
      return h('div', { class: 'r-brow' + (on ? '' : ' off') },
        h('span', { class: 'r-bt' }, h('span', { class: 'r-bn' }, h('b', null, b.name), h('span', { class: 'r-kind' }, b.kind === 'card' ? 'Number card' : 'Block')),
          h('span', { class: 'note' }, b.desc + (elsewhere.length ? ' · also on ' + elsewhere.map((x) => C.SCREEN_NAME[x]).join(', ') : ''))),
        sw(on, on ? 'Shown' : 'Not shown', () => { const r = ctx.act((x) => A.setShown(x, screen, b.id, !on), { label: (on ? 'off ' : 'on ') + C.SCREEN_NAME[screen], now: true }); if (r && !r.ok) toast(r.error); }, ctx.readOnly)); });
    const n = items.filter((b) => here.has(b.id)).length;
    return h('section', { class: 'scard r-bgroup' }, h('div', { class: 'r-bh' }, h('h3', null, title), h('span', { class: 'note' }, `${n} of ${items.length} shown`)), h('p', { class: 'note', style: { margin: '0' } }, note), rows);
  };
  const cards = C.BUILTIN.filter((b) => b.kind === 'card');
  return h('div', { class: 'r-bgrid' },
    group('Dashboard', 'Number cards and blocks of the Dashboard.', 'dashboard', C.BUILTIN.filter((b) => b.home === 'dashboard')),
    group('History', 'The Trades tab. The 7 checks stay in their own tab.', 'history', C.BUILTIN.filter((b) => b.home === 'history')),
    group('Open positions', `The number cards above your position cards (at most ${C.PLACE_CARD_MAX.open}). The position cards themselves always stay.`, 'open', cards));
}
