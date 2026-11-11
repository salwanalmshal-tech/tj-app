import { h, dialog, para, toast, field, suggest } from './dom.js';
import * as A from '../actions.js';

// Layout 2026-11-06 (his Lists example + Q12): tabs Stocks / Setups / Errors with counts, search, filters, sortable columns,
// a missing-info filter, count and pages; one "…" menu per row (Edit, Archive/Restore, Delete). Rules J1–J3 unchanged.
const NAMES = { stocks: ['Stocks', 'symbol', 'stock'], setups: ['Setups', 'name', 'setup'], errors: ['Errors', 'name', 'error'] };
const LEADS = { stocks: 'Your stocks with sector, industry and exchange. Typing a symbol in Open trade fills these in.', setups: 'Reusable trade setups. Usually a short list.', errors: 'Trading mistakes you want to recognize across your journal.' };
const PAGE = 25;
const V = { tab: 'stocks', q: '', sector: '', exch: '', status: 'active', sort: { stocks: ['trades', -1], setups: ['trades', -1], errors: ['trades', -1] }, page: 0 };
const missingInfo = (it) => !it.sector || !it.industry || !it.exchange;

export function render(ctx) {
  const st = ctx.store.state; const list = V.tab; const [title, key, one] = NAMES[list];
  const count = (l) => st[l].filter((x) => !x.archived).length;
  const tabs = h('div', { class: 'ltabs', role: 'tablist' }, Object.keys(NAMES).map((l) => h('button', { type: 'button', role: 'tab', class: l === list ? 'on' : '', 'aria-selected': String(l === list), onClick: () => { V.tab = l; V.q = ''; V.sector = ''; V.exch = ''; V.status = 'active'; V.page = 0; ctx.redraw(); } }, `${NAMES[l][0]} · ${count(l)}`)));
  const addBtn = h('button', { class: 'btn pri', disabled: ctx.readOnly, onClick: () => addItem(ctx, list) }, '+ Add ' + one);
  return h('div', { class: 'lists' }, h('div', { class: 'lbar' }, tabs, addBtn), h('p', { class: 'lead', style: { margin: '-4px 0 0' } }, LEADS[list]), table(ctx, st, list, key));
}

function table(ctx, st, list, key) {
  const usage = new Map(st[list].map((it) => [it.id, A.listUsageDetail(st, list, it.id)]));
  // filters
  let rows = st[list].filter((it) => V.status === 'all' ? true : V.status === 'archived' ? it.archived : V.status === 'missing' ? !it.archived && list === 'stocks' && missingInfo(it) : !it.archived);
  const q = V.q.trim().toLowerCase();
  if (q) rows = rows.filter((it) => [it[key], it.sector, it.industry, it.exchange].some((x) => (x || '').toLowerCase().includes(q)));
  if (list === 'stocks' && V.sector) rows = rows.filter((it) => (it.sector || '') === V.sector);
  if (list === 'stocks' && V.exch) rows = rows.filter((it) => (it.exchange || '') === V.exch);
  // sort
  const [sk, sd] = V.sort[list];
  const val = (it) => (sk === 'trades' ? usage.get(it.id).trades : (it[sk] || '').toLowerCase());
  rows.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sd || a[key].localeCompare(b[key]); });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); if (V.page >= pages) V.page = pages - 1;
  const shown = rows.slice(V.page * PAGE, V.page * PAGE + PAGE);

  // toolbar
  const search = h('input', { class: 'lsearch', type: 'search', value: V.q, placeholder: list === 'stocks' ? 'Search symbol, sector or industry' : 'Search name', 'aria-label': 'Search' });
  search.addEventListener('input', () => { V.q = search.value; V.page = 0; ctx.redraw(); });
  search.dataset.keep = 'lsearch'; search.addEventListener('focus', () => { const n = search.value.length; search.setSelectionRange(n, n); });
  const sel = (value, opts, onPick, label) => { const s = h('select', { 'aria-label': label }, opts.map(([v, t]) => h('option', { value: v, selected: v === value }, t))); s.addEventListener('change', () => { onPick(s.value); V.page = 0; ctx.redraw(); }); return s; };
  const uniq = (f) => [...new Set(st.stocks.map((x) => x[f]).filter(Boolean))].sort();
  const nMissing = list === 'stocks' ? st.stocks.filter((x) => !x.archived && missingInfo(x)).length : 0;
  const tools = h('div', { class: 'ltools' }, search, h('div', { class: 'lfilters' },
    list === 'stocks' ? sel(V.sector, [['', 'All sectors'], ...uniq('sector').map((x) => [x, x])], (v) => { V.sector = v; }, 'Sector') : null,
    list === 'stocks' ? sel(V.exch, [['', 'All exchanges'], ...uniq('exchange').map((x) => [x, x])], (v) => { V.exch = v; }, 'Exchange') : null,
    sel(V.status, [['active', 'Active'], ...(list === 'stocks' ? [['missing', `Missing info · ${nMissing}`]] : []), ['archived', 'Archived'], ['all', 'All']], (v) => { V.status = v; }, 'Status')));

  // table
  const cols = list === 'stocks' ? [['symbol', 'Symbol'], ['sector', 'Sector'], ['industry', 'Industry'], ['exchange', 'Exchange'], ['trades', 'Trades'], [null, 'Status'], [null, '']] : [['name', 'Name'], ['trades', 'Trades'], [null, 'Status'], [null, '']];
  const th = ([k, t]) => k ? h('th', { class: 'sortable' + (k === sk ? ' on' : ''), 'aria-sort': k === sk ? (sd > 0 ? 'ascending' : 'descending') : 'none' },
    h('button', { type: 'button', onClick: () => { V.sort[list] = [k, k === sk ? -sd : k === 'trades' ? -1 : 1]; ctx.redraw(); } }, t, h('span', { class: 'sa' }, k === sk ? (sd > 0 ? '▲' : '▼') : '↕'))) : h('th', null, t);
  const miss = h('span', { class: 'lmiss' }, 'Missing');
  const cell = (v) => (v ? v : miss.cloneNode(true));
  const body = shown.map((it) => {
    const n = usage.get(it.id);
    const status = h('span', { class: 'lst ' + (it.archived ? 'arch' : 'act') }, it.archived ? 'Archived' : 'Active');
    const trades = h('span', { class: 'ltr' + (n.trades ? '' : ' zero') }, (n.trades === 1 ? '1 trade' : n.trades + ' trades') + (n.dividends ? ` · ${n.dividends === 1 ? '1 dividend' : n.dividends + ' dividends'}` : ''));
    const menu = rowMenu(ctx, list, it, n);
    return list === 'stocks'
      ? h('tr', { class: it.archived ? 'arch' : '' }, h('td', null, h('b', { class: 'lsym' }, it.symbol)), h('td', null, cell(it.sector)), h('td', null, cell(it.industry)), h('td', null, cell(it.exchange)), h('td', null, trades), h('td', null, status), h('td', { class: 'r' }, menu))
      : h('tr', { class: it.archived ? 'arch' : '' }, h('td', null, h('b', null, it.name)), h('td', null, trades), h('td', null, status), h('td', { class: 'r' }, menu));
  });
  const empty = h('div', { class: 'empty' }, h('b', null, st[list].length ? 'Nothing matches' : 'Nothing here yet'), h('span', null, st[list].length ? 'Change the search or the filters.' : `Add your first ${NAMES[list][2]} with “+ Add ${NAMES[list][2]}”.`));
  const pager = pages > 1 ? h('div', { class: 'row lpager' }, ...Array.from({ length: pages }, (_, i) => h('button', { type: 'button', class: 'btn sm' + (i === V.page ? ' on' : ''), onClick: () => { V.page = i; ctx.redraw(); } }, String(i + 1))),
    h('button', { type: 'button', class: 'btn sm', disabled: V.page >= pages - 1, onClick: () => { V.page++; ctx.redraw(); } }, 'Next ›')) : null;
  return h('section', { class: 'scard ltable' }, h('div', { class: 'lhead' }, tools),
    shown.length ? h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, cols.map(th))), h('tbody', null, body))) : empty,
    h('div', { class: 'lfoot' }, h('span', { class: 'note' }, `Showing ${shown.length} of ${rows.length} ${NAMES[list][0].toLowerCase()}`), pager));
}

// "…" menu per row: Edit, Archive / Restore, Delete (rules J2: archive instead of delete; delete only when unused)
let openMenu = null;
document.addEventListener('click', (e) => { if (openMenu && !openMenu.contains(e.target)) { openMenu.classList.remove('open'); openMenu = null; } });
function rowMenu(ctx, list, it, usage) {
  const item = (label, fn, cls = '') => h('button', { type: 'button', class: cls, disabled: ctx.readOnly, onClick: (e) => { e.stopPropagation(); wrap.classList.remove('open'); openMenu = null; fn(); } }, label);
  const wrap = h('div', { class: 'lmenu' },
    h('button', { type: 'button', class: 'btn sm ldots', 'aria-label': 'Actions for ' + it[NAMES[list][1]], onClick: (e) => { e.stopPropagation(); const was = wrap.classList.contains('open'); if (openMenu) openMenu.classList.remove('open'); wrap.classList.toggle('open', !was); openMenu = was ? null : wrap; } }, '•••'),
    h('div', { class: 'lpop' }, item('Edit…', () => edit(ctx, list, it)), item(it.archived ? 'Restore' : 'Archive', () => archive(ctx, list, it)), item('Delete…', () => del(ctx, list, it, usage), 'dng')));
  return wrap;
}
// #14: "2 trades" / "1 trade and 2 dividends" / "3 dividends" - never one mixed number
const usageText = (usage) => {
  const parts = []; if (usage.trades) parts.push(usage.trades === 1 ? '1 trade' : usage.trades + ' trades');
  if (usage.dividends) parts.push(usage.dividends === 1 ? '1 dividend' : usage.dividends + ' dividends');
  return parts.length ? parts.join(' and ') : '0 trades';
};
// sector / industry / exchange suggestions from the 2nd letter (2026-11-09), from the values your stocks already use
function suggestInfo(st, x) {
  const uniqOf = (k) => [...new Set(st.stocks.map((s) => (s[k] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  suggest(x.sector, () => uniqOf('sector').map((v) => ({ value: v })));
  suggest(x.industry, () => { const sec = x.sector.value.trim().toLowerCase(); const inSec = new Set(st.stocks.filter((s) => (s.sector || '').toLowerCase() === sec).map((s) => s.industry)); return uniqOf('industry').sort((a, b) => inSec.has(b) - inSec.has(a)).map((v) => ({ value: v, sub: inSec.has(v) ? x.sector.value.trim() : '' })); });
  suggest(x.exchange, () => uniqOf('exchange').map((v) => ({ value: v })), { min: 1 });
}
function addItem(ctx, list) {
  const [, key, one] = NAMES[list];
  const name = h('input', { 'aria-label': list === 'stocks' ? 'Symbol' : 'Name', style: list === 'stocks' ? { textTransform: 'uppercase' } : null, autocomplete: 'off' });
  const extra = list === 'stocks' ? { sector: h('input', { 'aria-label': 'Sector' }), industry: h('input', { 'aria-label': 'Industry' }), exchange: h('input', { 'aria-label': 'Exchange' }) } : null;
  if (extra) suggestInfo(ctx.store.state, extra);
  setTimeout(() => name.focus(), 0);
  dialog({ title: 'Add ' + one, ok: 'Add', body: h('div', { style: { display: 'grid', gap: '10px' } }, field(list === 'stocks' ? 'Symbol' : 'Name', name), extra ? [field('Sector', extra.sector), field('Industry', extra.industry), field('Exchange', extra.exchange)] : null),
    onOk: () => {
      const r = ctx.act((d) => A.addListItem(d, list, name.value, extra ? { sector: extra.sector.value.trim(), industry: extra.industry.value.trim(), exchange: extra.exchange.value.trim() } : {}), { label: 'new ' + one, now: true });
      if (!r.ok) return r.error; toast(`${r.data[key]} added.`); return true;
    } });
}
function edit(ctx, list, it) {
  const key = NAMES[list][1]; const name = h('input', { value: it[key], 'aria-label': 'Name' });
  const extra = list === 'stocks' ? { sector: h('input', { value: it.sector || '', 'aria-label': 'Sector' }), industry: h('input', { value: it.industry || '', 'aria-label': 'Industry' }), exchange: h('input', { value: it.exchange || '', 'aria-label': 'Exchange' }) } : null;
  if (extra) suggestInfo(ctx.store.state, extra);
  dialog({ title: `Edit ${it[key]}`, ok: 'Save', body: h('div', { style: { display: 'grid', gap: '10px' } }, field(list === 'stocks' ? 'Symbol' : 'Name', name), extra ? [field('Sector', extra.sector), field('Industry', extra.industry), field('Exchange', extra.exchange)] : null),
    onOk: async () => {
      if (name.value.trim().toUpperCase() !== it[key].toUpperCase() || (list !== 'stocks' && name.value.trim() !== it[key])) {
        const trial = structuredClone(ctx.store.state); const r = A.renameListItem(trial, list, it.id, name.value);
        if (!r.ok && r.exists) {
          const n = A.listUsageDetail(ctx.store.state, list, it.id);
          const ok = await dialog({ title: `“${r.exists[key]}” already exists. Merge?`, ok: 'Merge', body: para(`${usageText(n)} of “${it[key]}” move to “${r.exists[key]}”, and “${it[key]}” is removed from the list. This cannot be split apart again (Undo works for the last change).`, '') });
          if (!ok) return false;
          const m = ctx.act((d) => A.renameListItem(d, list, it.id, name.value, { merge: true }), { label: 'merge', now: true }); return m.ok ? true : m.error;
        }
        if (!r.ok) return r.error;
      }
      const res = ctx.act((d) => { const r = A.renameListItem(d, list, it.id, name.value); if (!r.ok) return r; if (extra) return A.updateStock(d, it.id, { sector: extra.sector.value.trim(), industry: extra.industry.value.trim(), exchange: extra.exchange.value.trim() }); return r; }, { label: 'edit ' + it[key], now: true });
      return res.ok ? true : res.error;
    } });
}
async function archive(ctx, list, it) {
  const key = NAMES[list][1];
  if (!it.archived) { const probe = A.archiveListItem(structuredClone(ctx.store.state), list, it.id, true); if (!probe.ok) return dialog({ title: `${it[key]} still has an open position`, body: para('Close it first, then archive. Nothing was changed.', ''), info: true }); }
  const r = ctx.act((d) => A.archiveListItem(d, list, it.id, !it.archived), { label: it.archived ? 'restore ' + it[key] : 'archive ' + it[key], now: true }); if (!r.ok) toast(r.error);
}
async function del(ctx, list, it, usage) {
  const key = NAMES[list][1];
  if (usage.trades || usage.dividends) return dialog({ title: `${it[key]} is in use`, body: para(`${usageText(usage)} use it. Archive it instead: archived items stay in old trades but disappear from the pick lists.`, ''), info: true });
  const ok = await dialog({ title: `Delete ${it[key]}?`, danger: true, ok: 'Delete', body: para('It moves to the Trash for 15 days.', '') }); if (!ok) return;
  const r = ctx.act((d) => A.deleteListItem(d, list, it.id), { label: 'delete ' + it[key], now: true }); if (r.ok) toast(`${it[key]} moved to the Trash.`, 'Restore', () => ctx.store.undo()); else toast(r.error);
}
