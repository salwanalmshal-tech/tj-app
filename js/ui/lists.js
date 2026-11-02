import { h, dialog, para, toast, field } from './dom.js';
import * as A from '../actions.js';

let showArchived = false;
const NAMES = { stocks: ['Stocks', 'symbol'], setups: ['Setups', 'name'], errors: ['Errors', 'name'] };

export function render(ctx) {
  const st = ctx.store.state;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    h('label', { class: 'row note' }, h('input', { type: 'checkbox', checked: showArchived, onChange: (e) => { showArchived = e.target.checked; ctx.redraw(); } }), ' Show archived items'),
    ['stocks', 'setups', 'errors'].map((list) => panel(ctx, st, list)));
}
function panel(ctx, st, list) {
  const [title, key] = NAMES[list]; const items = st[list].filter((x) => showArchived || !x.archived).sort((a, b) => a[key].localeCompare(b[key]));
  const add = h('input', { 'aria-label': 'New ' + title.toLowerCase().slice(0, -1), placeholder: list === 'stocks' ? 'Symbol' : 'Name', style: list === 'stocks' ? { textTransform: 'uppercase' } : null }); const msg = h('span', { class: 'err', role: 'alert' });
  const doAdd = () => { const r = ctx.act((d) => A.addListItem(d, list, add.value), { label: 'new ' + title.toLowerCase().slice(0, -1), now: true }); if (!r.ok) msg.textContent = r.error; };
  add.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  const head = ['Name', ...(list === 'stocks' ? ['Sector', 'Industry', 'Exchange'] : []), 'Used by', 'Status', ''];
  return h('section', { class: 'panel' }, h('div', { class: 'ph' }, title, h('span', { class: 'sub' }, `${items.length} item${items.length === 1 ? '' : 's'}`)),
    h('div', { class: 'pb row' }, add, h('button', { class: 'btn pri', disabled: ctx.readOnly, onClick: doAdd }, 'Add'), msg),
    items.length ? h('div', { class: 'tw' }, h('table', null, h('thead', null, h('tr', null, head.map((x) => h('th', null, x)))), h('tbody', null, items.map((it) => {
      const used = A.listUsage(st, list, it.id);
      return h('tr', { class: it.archived ? 'mut' : '' }, h('td', { class: list === 'stocks' ? 'mono' : '' }, it[key]), ...(list === 'stocks' ? [it.sector, it.industry, it.exchange].map((x) => h('td', null, x || '–')) : []), h('td', null, used ? String(used) : '–'), h('td', null, it.archived ? h('span', { class: 'pill' }, 'Archived') : 'Active'),
        h('td', { class: 'r' }, h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: () => edit(ctx, list, it) }, 'Edit'),
          h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: () => archive(ctx, list, it) }, it.archived ? 'Restore' : 'Archive'),
          h('button', { class: 'btn sm quiet-dng', disabled: ctx.readOnly, onClick: () => del(ctx, list, it, used) }, 'Delete'))));
    })))) : h('div', { class: 'pb note' }, 'Nothing here yet.'));
}
function edit(ctx, list, it) {
  const key = NAMES[list][1]; const name = h('input', { value: it[key], 'aria-label': 'Name' });
  const extra = list === 'stocks' ? { sector: h('input', { value: it.sector || '', 'aria-label': 'Sector' }), industry: h('input', { value: it.industry || '', 'aria-label': 'Industry' }), exchange: h('input', { value: it.exchange || '', 'aria-label': 'Exchange' }) } : null;
  dialog({ title: `Edit ${it[key]}`, ok: 'Save', body: h('div', { style: { display: 'grid', gap: '10px' } }, field(list === 'stocks' ? 'Symbol' : 'Name', name), extra ? [field('Sector', extra.sector), field('Industry', extra.industry), field('Exchange', extra.exchange)] : null),
    onOk: async () => {
      if (name.value.trim().toUpperCase() !== it[key].toUpperCase() || (list !== 'stocks' && name.value.trim() !== it[key])) {
        const trial = structuredClone(ctx.store.state); const r = A.renameListItem(trial, list, it.id, name.value);
        if (!r.ok && r.exists) {
          const n = A.listUsage(ctx.store.state, list, it.id);
          const ok = await dialog({ title: `“${r.exists[key]}” already exists. Merge?`, ok: 'Merge', body: para(`${n} trade${n === 1 ? '' : 's'}${list === 'stocks' ? ' and dividends' : ''} of “${it[key]}” move to “${r.exists[key]}”, and “${it[key]}” is removed from the list. This cannot be split apart again (Undo works for the last change).`, '') });
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
async function del(ctx, list, it, used) {
  const key = NAMES[list][1];
  if (used) return dialog({ title: `${it[key]} is in use`, body: para(`${used} trade${used === 1 ? '' : 's'} use it. Archive it instead: archived items stay in old trades but disappear from the pick lists.`, ''), info: true });
  const ok = await dialog({ title: `Delete ${it[key]}?`, danger: true, ok: 'Delete', body: para('It moves to the Trash for 15 days.', '') }); if (!ok) return;
  const r = ctx.act((d) => A.deleteListItem(d, list, it.id), { label: 'delete ' + it[key], now: true }); if (r.ok) toast(`${it[key]} moved to the Trash.`, 'Restore', () => ctx.store.undo()); else toast(r.error);
}
