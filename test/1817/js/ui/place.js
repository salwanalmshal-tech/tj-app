// 1.7.0 Reports and placement (agreed 2026-11-15): one library of everything that can be shown, used on Dashboard,
// History and Open positions. This file draws any block of the library on any of those screens and gives every
// placed card or block its "⇄ Swap" button (swap for another report, or take it off this screen; nothing is ever lost:
// it stays in Reports). The lists themselves are kept in the data file (calc.js placement, actions.js setShown/swapShown).
import { h, toast } from './dom.js';
import * as C from '../calc.js';
import * as A from '../actions.js';

let MOD = null; // the screen modules, filled in by app.js (avoids import loops)
export function registerScreens(mods) { MOD = mods; }

// the element of one block (not a number card): Dashboard blocks, History blocks or one of his reports
export function blockEl(ctx, id, opts = {}) {
  const st = ctx.store.state;
  if (C.isReportId(id)) { const rep = (st.reports || []).find((r) => 'r:' + r.id === id); return rep ? MOD.reports.reportBlock(ctx, rep, opts) : null; }
  if (id.startsWith('d.')) return MOD.dashboard.blockEl(ctx, id.slice(2), opts);
  if (id.startsWith('h.')) return MOD.history.historyBlock(ctx, id, opts);
  return null;
}
export const nameOf = (st, id) => (C.isReportId(id) ? (st.reports || []).find((r) => 'r:' + r.id === id)?.name ?? '?' : C.BUILTIN_BY_ID[id]?.name ?? id);

// ---------------------------------------------------------------- ⇄ Swap
let openMenu = null;
const closeMenu = () => { openMenu?.remove(); openMenu = null; };
if (typeof window !== 'undefined') { // (not in the automatic tests, which run without a browser)
  window.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.contains(e.target) && !e.target.closest('.pl-swap')) closeMenu(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('scroll', closeMenu, true);
}

export function swapButton(ctx, screen, id) {
  const st = ctx.store.state; const kind = C.isReportId(id) ? 'block' : C.BUILTIN_BY_ID[id]?.kind;
  const b = h('button', { class: 'pl-swap', type: 'button', title: 'Swap for another report, or take it off this screen', 'aria-haspopup': 'menu', disabled: ctx.readOnly }, '⇄');
  b.addEventListener('click', (e) => {
    e.stopPropagation(); if (openMenu) { closeMenu(); return; }
    const p = C.placement(st, screen); const here = new Set([...p.cards, ...p.blocks]);
    const item = (newId) => h('button', { type: 'button', role: 'menuitem', class: 'pl-it' + (newId === id ? ' cur' : ''), disabled: newId === id,
      onClick: () => { closeMenu(); const r = ctx.act((d) => A.swapShown(d, screen, id, newId), { label: 'swap on ' + C.SCREEN_NAME[screen], now: true }); if (r && !r.ok) toast(r.error); } },
      nameOf(st, newId));
    const groups = [];
    // 1.7.1 (his choice): a number card's list shows only the cards NOT on this screen (order = drag, as before)
    if (kind === 'card') { const free = C.BUILTIN.filter((x) => x.kind === 'card' && !here.has(x.id)).map((x) => x.id); if (free.length) groups.push(['Number cards not shown here', free]); }
    else {
      // 1.7.1 (his choice): blocks and reports follow the same rule — only those NOT on this screen
      const mine = (st.reports || []).map((r) => 'r:' + r.id).filter((x) => !here.has(x)); if (mine.length) groups.push(['My reports', mine]);
      for (const s of ['dashboard', 'history']) { const ids = C.BUILTIN.filter((x) => x.kind === 'block' && x.home === s && !here.has(x.id)).map((x) => x.id); if (ids.length) groups.push(['Built-in · ' + C.SCREEN_NAME[s], ids]); }
    }
    const menu = h('div', { class: 'pl-menu', role: 'menu', 'aria-label': 'Swap ' + nameOf(st, id) },
      groups.map(([g, ids]) => [h('div', { class: 'pl-gh' }, g), ids.map(item)]),
      !groups.length ? h('div', { class: 'pl-note' }, kind === 'card' ? 'All number cards are already shown here. Drag a card to change the order.' : 'Everything is already shown here. Drag a block to change the order.') : null,
      h('div', { class: 'pl-sep' }),
      h('button', { type: 'button', role: 'menuitem', class: 'pl-it out', onClick: () => { closeMenu(); const r = ctx.act((d) => A.setShown(d, screen, id, false), { label: 'off ' + C.SCREEN_NAME[screen], now: true });
        if (r && r.ok) toast(`“${nameOf(st, id)}” is off ${C.SCREEN_NAME[screen]}. It stays in Reports.`, 'Undo', () => ctx.store.undo()); } }, 'Take it off this screen'),
      h('div', { class: 'pl-note' }, 'Nothing is lost: every block stays in Reports.'));
    document.body.append(menu); openMenu = menu;
    const r = b.getBoundingClientRect(); const w = 270;
    menu.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
    const below = r.bottom + 6; menu.style.top = below + 'px';
    const mh = menu.getBoundingClientRect().height; if (below + mh > window.innerHeight - 8) menu.style.top = Math.max(8, r.top - mh - 6) + 'px';
  });
  return b;
}
