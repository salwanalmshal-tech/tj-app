// Program shell: start-up (sign in / demo), menu, status pill, banners, routing.
import { h, clear, dialog, para, toast, dmy, download, priceTxt } from './dom.js';
import { emptyState, checkFile, migrate, needsUpdateBackup, APP_VERSION } from '../model.js';
import { Store } from '../store.js';
import { Saver } from '../saver.js';
import { MemoryStorage, DriveStorage, backupsToDelete, excelCopyDue } from '../storage.js';
import { Auth, googleReady } from '../auth.js';
import { CLIENT_ID, FOLDER_NAME } from '../config.js';
import { todayISO, weekdayName } from '../dates.js';
import * as A from '../actions.js';
import * as openPos from './openpositions.js';
import * as tradeForms from './tradeforms.js';
import * as history from './history.js';
import * as capital from './capital.js';
import * as lists from './lists.js';
import * as data from './data.js';
import * as settings from './settings.js';

// own: the screen draws its own page header (redesigned screens); otherwise the shell draws eyebrow + title.
const ROUTES = {
  open: { title: 'Open positions', mod: openPos, own: true },
  'open-trade': { title: 'Open trade', mod: tradeForms, fn: 'renderOpen', parent: 'open', own: true },
  'close-trade': { title: 'Close trade', eyebrow: 'Exit', lead: 'Sell shares and see the result before anything is saved.', mod: tradeForms, fn: 'renderClose', parent: 'open' },
  history: { title: 'History', eyebrow: 'Learn', lead: 'Every sale with its result. A trade is counted when its last share is sold.', mod: history },
  capital: { title: 'Capital', eyebrow: 'Money', lead: 'What changed your capital and why.', mod: capital },
  lists: { title: 'Lists', eyebrow: 'Records', lead: 'Stocks, setups and errors used by your trades.', mod: lists },
  data: { title: 'Import / Export', eyebrow: 'Safety centre', lead: 'Export, backups, restore and import of your journal.', mod: data },
  settings: { title: 'Settings', eyebrow: 'System', lead: 'Limits for marks, labels and saving. They only change what you see; they never block anything.', mod: settings },
};
const MENU = [
  ['Trade', [['open', 'Open positions']]],
  ['Learn', [['dashboard', 'Dashboard', 'Version 2'], ['history', 'History'], ['report', 'Reports', 'Version 3'], ['tax', 'Tax report', 'Version 2']]],
  ['Records', [['capital', 'Capital'], ['lists', 'Lists']]],
  ['System', [['data', 'Import / Export'], ['settings', 'Settings']]],
];

export const ctx = {
  store: null, saver: null, storage: null, auth: new Auth(), route: 'open', params: {}, readOnly: false, demo: false,
  banner: null, status: { status: 'saved' }, account: '',
  go(route, params = {}) { ctx.route = route; ctx.params = params; location.hash = '#/' + route; draw(); },
  redraw() { draw(); },
  today: () => todayISO(),
  // run an action; show its error as a message the caller can place
  act(action, opts) { if (ctx.readOnly) return { ok: false, error: 'This window is read-only.' }; return ctx.store.run(action, opts); },
};

const root = document.getElementById('root');

// ------------------------------------------------------------- start
function welcome(errorText) {
  clear(root);
  const canGoogle = googleReady(); ctx.auth.preload();
  root.append(h('main', { class: 'welcome', id: 'main' },
    h('div', { class: 'brand', style: { padding: 0 } }, h('i', null, 'TJ'), 'Trade Journal'),
    h('h1', null, 'Your trades, in your own Google Drive'),
    para('Your data is one file in your own Google Drive. It is never stored on this website or on any other server. Nothing is installed on this computer.', ''),
    errorText ? h('div', { class: 'msg bad', role: 'alert' }, '■ ' + errorText) : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn pri', disabled: !canGoogle, onClick: signIn }, 'Sign in with Google'),
      h('button', { class: 'btn', onClick: startDemo }, 'Try without Google (nothing is saved)')),
    canGoogle ? null : h('div', { class: 'msg info' }, '● Google sign-in is not set up yet (no Client ID in the program). You can already try everything without saving.'),
    h('p', { class: 'note' }, 'The program asks Google only for access to files it creates itself (“drive.file”). It cannot see your other Drive files.')));
}
async function signIn() {
  try {
    clear(root); root.append(h('main', { class: 'welcome', id: 'main' }, h('p', null, 'Connecting to Google…')));
    await ctx.auth.signIn('select_account'); const email = await ctx.auth.who();
    ctx.account = email; ctx.demo = false;
    const storage = new DriveStorage({ auth: ctx.auth, folderName: FOLDER_NAME, account: email, session: tabSession() });
    await openStorage(storage);
  } catch (e) { welcome(e.message || String(e)); }
}
function tabSession() { try { let s = sessionStorage.getItem('tj-session'); if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('tj-session', s); } return s; } catch { return undefined; } }
async function startDemo() { ctx.demo = true; ctx.account = ''; await openStorage(new MemoryStorage()); }

async function openStorage(storage) {
  try {
    ctx.storage = storage;
    const { data: raw } = await storage.open();
    let state;
    if (raw) {
      const c = checkFile(raw);
      if (!c.ok) { await dialog({ title: 'Cannot open the data file', body: para(c.reason, ''), info: true }); return welcome(); }
      // B5: the first time a new version opens the data, the file as it was is backed up before anything changes
      if (needsUpdateBackup(raw)) {
        let done = false; try { await storage.writeBackup('before-update', raw); done = true; } catch { /* asked below */ }
        if (!done && !(await dialog({ title: 'The backup before this update could not be made', ok: 'Open anyway', cancel: 'Cancel',
          body: para(`Program version ${APP_VERSION} is opening your data for the first time (saved by version ${raw.meta?.version ?? 'unknown'}). A backup of your data should be made first, but it failed (check your connection). Cancel and try again, or open anyway.`, '') }))) return welcome();
      }
      state = migrate(raw);
    } else state = emptyState();
    // lock: someone else (another window) has the file open?
    ctx.readOnly = false;
    const lock = await storage.lockInfo();
    if (lock) {
      const take = await dialog({ title: 'Open in another place', body: para(`This data file is open in another window or computer (last active ${Math.max(0, Math.round((Date.now() - lock.renewedAt) / 60000))} min ago). If you continue here, the other window becomes read-only and keeps its unsaved changes without overwriting anything.`, ''), ok: 'Take over', cancel: 'Open read-only' });
      ctx.readOnly = !take;
    }
    if (!ctx.readOnly) await storage.acquireLock();
    start(state, !raw);
  } catch (e) { welcome(e.auth ? e.message : 'Could not open your data: ' + e.message); }
}

function start(state, isNew) {
  const saver = new Saver({
    storage: ctx.storage, getData: () => ctx.store.state, getDelay: () => ctx.store.state.settings.saveDelaySec,
    onStatus: (s) => { ctx.status = s; paintStatus(); },
    onConflict: () => { ctx.readOnly = true; setBanner('ro', 'Read-only: the file in Google Drive was changed somewhere else. Your last change here is not saved. Download a copy, then reload.', 'Download a copy', () => download('TradeJournal-copy.json', new Blob([JSON.stringify(ctx.store.state, null, 1)], { type: 'application/json' }))); draw(); },
    onAuth: () => setBanner('ns', 'Not saved yet: the Google connection has ended. Nothing is lost.', 'Reconnect', reconnect),
    onBackupDue: () => backupIfDue('auto'),
  });
  ctx.saver = saver;
  ctx.store = new Store(state, { onSave: (o) => { if (!ctx.demo || true) saver.markDirty(o); }, onChange: () => draw() });
  if (ctx.readOnly) { saver.readOnly = true; setBanner('ro', 'Read-only: this window is open in another place.', 'Take over…', takeOver); }
  if (!ctx.readOnly && !ctx.demo) { backupIfDue('auto'); startTimers(); }
  window.addEventListener('pagehide', () => { if (!ctx.readOnly && !ctx.demo) ctx.storage.releaseLockOnExit?.(); });
  window.addEventListener('beforeunload', (e) => { if (saver.hasUnsaved() && !ctx.demo) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('hashchange', () => { const r = location.hash.replace('#/', ''); if (ROUTES[r] && r !== ctx.route) { ctx.route = r; draw(); } });
  const r0 = location.hash.replace('#/', ''); ctx.route = ROUTES[r0] ? r0 : 'open';
  if (isNew || !state.capital.start) ctx.route = 'capital', ctx.params = { first: true };
  draw();
}

// ------------------------------------------------------------- timers, lock, token, backups
let timers = [];
function startTimers() {
  timers.forEach(clearInterval);
  timers = [
    setInterval(async () => {
      if (ctx.readOnly) return;
      try { if (!(await ctx.storage.stillMine())) { ctx.readOnly = true; ctx.saver.readOnly = true; setBanner('ro', 'Read-only: you took over in another place. Unsaved changes here are kept but not saved.', 'Take over…', takeOver); draw(); } else await ctx.storage.renewLock(); } catch { /* network blip: ignore */ }
    }, 60000),
    setInterval(() => {
      if (ctx.demo) return; const left = ctx.auth.expiresAt() - Date.now();
      if (left <= 0) setBanner('ns', ctx.saver.hasUnsaved() ? 'Not saved yet: the Google connection has ended. Nothing is lost.' : 'The Google connection has ended.', 'Reconnect', reconnect);
      else if (left < 10 * 60000 && ctx.banner?.kind !== 'ro') setBanner('rc', `The Google connection ends in ${Math.max(1, Math.round(left / 60000))} minutes. Reconnect to keep saving.`, 'Reconnect', reconnect);
    }, 20000),
  ];
}
async function reconnect() {
  try { await ctx.auth.reconnect(); setBanner(null); ctx.saver.error = null; await ctx.saver.flush(); toast('Reconnected.'); } catch (e) { toast('Could not reconnect: ' + e.message); }
}
async function takeOver() {
  const ok = await dialog({ title: 'Take over this file?', body: para('This window becomes the editing window. Any other window becomes read-only. If this window has an older copy, reload the page first to see the newest data.', ''), ok: 'Take over' });
  if (!ok) return;
  try {
    const { data: raw } = await ctx.storage.open(); // refresh version
    if (raw) { ctx.store.replace(migrate(raw)); }
    await ctx.storage.acquireLock(); ctx.readOnly = false; ctx.saver.readOnly = false; setBanner(null); startTimers(); draw();
  } catch (e) { toast('Could not take over: ' + e.message); }
}
let lastBackupCheck = 0;
export async function backupIfDue(kind) {
  if (ctx.demo || ctx.readOnly) return;
  if (kind === 'auto' && Date.now() - lastBackupCheck < 10 * 60000) return;
  lastBackupCheck = Date.now();
  if (kind === 'auto') excelCopyIfDue();
  try {
    const list = await ctx.storage.listBackups(); const today = new Date().toISOString().slice(0, 10);
    if (kind === 'auto' && list.some((b) => b.time.slice(0, 10) === today && b.kind === 'auto')) return;
    await ctx.storage.writeBackup(kind, ctx.store.state);
    for (const id of backupsToDelete(await ctx.storage.listBackups())) await ctx.storage.deleteBackup(id);
    ctx.lastBackup = new Date(); paintStatus();
  } catch { /* backups are best effort; the main file is already saved */ }
}
// weekly Excel copy (settings excelCopyDays / excelCopyKeep); best effort, never blocks or slows the program
async function excelCopyIfDue() {
  try {
    const S = ctx.store.state.settings;
    if (!excelCopyDue(await ctx.storage.listExcelCopies(), S.excelCopyDays)) return;
    await data.makeExcelCopy(ctx);
  } catch { /* the JSON backups are the real backups; try again next session */ }
}
export async function safetyBackup(kind) {
  if (ctx.demo) { await ctx.storage.writeBackup(kind, ctx.store.state); return true; }
  try { await ctx.storage.writeBackup(kind, ctx.store.state); return true; } catch { return false; }
}

// ------------------------------------------------------------- shell
function setBanner(kind, text, label, fn) { ctx.banner = kind ? { kind, text, label, fn } : null; drawBanner(); }
let bannerEl, statusEl;
function drawBanner() {
  if (!bannerEl) return; clear(bannerEl);
  const b = ctx.banner; if (!b) return;
  const icon = { ro: '●', ns: '■', rc: '◆' }[b.kind];
  bannerEl.append(h('div', { class: 'gbanner ' + b.kind, role: b.kind === 'ns' ? 'alert' : 'status' }, icon + ' ' + b.text, b.label ? h('button', { class: 'btn sm' + (b.kind === 'ns' ? ' pri' : ''), style: { marginLeft: 'auto' }, onClick: b.fn }, b.label) : null));
}
function paintStatus() {
  if (!statusEl) return; clear(statusEl);
  const s = ctx.status || {}; const hhmm = (d) => d ? d.toTimeString().slice(0, 5) : '';
  let el;
  if (ctx.demo) el = h('span', { class: 'pill warn', title: 'Nothing you enter here is saved. Close this page and everything is gone.' }, '◆ Demo: nothing is saved');
  else if (ctx.readOnly) el = h('span', { class: 'pill info' }, '● Read-only');
  else if (s.status === 'saving') el = h('span', { class: 'pill' }, h('span', { class: 'dot', style: { background: 'transparent', border: '2px solid var(--muted)' } }), 'Saving…');
  else if (s.status === 'unsaved') el = h('span', { class: 'pill' }, h('span', { class: 'dot', style: { background: 'var(--warn)' } }), 'Not saved yet');
  else if (s.status === 'failed' || s.status === 'reconnect' || s.status === 'conflict') el = h('span', { class: 'pill crit' }, '■ Not saved yet');
  else el = h('span', { class: 'pill' }, h('span', { class: 'dot' }), s.at || ctx.saver?.lastSaved ? 'Saved ' + hhmm(s.at || ctx.saver.lastSaved) : 'Saved', ctx.lastBackup ? ' · Backup today' : '');
  statusEl.append(h('button', { class: 'btn ghost', style: { padding: 0, height: 'auto' }, 'aria-label': 'Save status', onClick: statusDetails }, el));
}
function statusDetails() {
  const d = ctx.storage?.describe?.() || {};
  dialog({ title: 'Saving', info: true, ok: 'Close', body: h('div', null,
    h('dl', { class: 'kv' }, h('dt', null, 'Where'), h('dd', null, ctx.demo ? 'Nowhere (demo)' : `${d.file} in “${d.folder}”`), h('dt', null, 'Google account'), h('dd', null, d.account || '–'),
      h('dt', null, 'Last backup'), h('dd', null, ctx.lastBackup ? 'today' : '–'), h('dt', null, 'Status'), h('dd', null, ctx.status?.message || ctx.status?.status || '')),
    h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn sm', onClick: () => download('TradeJournal-copy.json', new Blob([JSON.stringify(ctx.store.state, null, 1)], { type: 'application/json' })) }, 'Download a copy'),
      h('button', { class: 'btn sm', onClick: () => ctx.saver?.flush() }, 'Save now'))) });
}

function draw() {
  if (!ctx.store) return;
  const active = document.activeElement; const keep = active?.dataset?.keep;
  const st = ctx.store.state; const route = ROUTES[ctx.route] || ROUTES.open; const menuKey = route.parent || ctx.route;
  const scroll = document.querySelector('.tw.fx')?.scrollTop;
  clear(root);
  const menu = MENU.map(([grp, items]) => [h('div', { class: 'grp' }, grp), items.map(([key, label, later]) => later
    ? h('a', { 'aria-disabled': 'true', title: 'Comes in ' + later.toLowerCase() }, label, h('span', { class: 'later' }, later))
    : h('a', { href: '#/' + key, class: key === menuKey ? 'on' : '', 'aria-current': key === menuKey ? 'page' : null, onClick: (e) => { e.preventDefault(); ctx.go(key); } }, label,
      key === 'open' && attentionCount() ? h('span', { class: 'cnt', 'aria-label': attentionCount() + ' lines need attention' }, attentionCount()) : null))]);
  const side = h('nav', { class: 'side', 'aria-label': 'Main' }, h('div', { class: 'brand' }, h('i', null, 'TJ'), 'Trade Journal'), menu,
    h('div', { class: 'foot' }, ctx.demo ? 'Demo · not saved' : 'Google Drive', h('br'), 'Version ' + APP_VERSION));
  statusEl = h('span');
  bannerEl = h('div');
  const body = h('main', { id: 'main', class: 'body' }, ctx.readOnly ? h('div', { class: 'note' }, 'Read-only window: you can look and copy, but not change anything.') : null,
    route.own ? null : h('header', { class: 'pg-head' }, h('div', null, h('div', { class: 'eyebrow' }, route.eyebrow || ''), h('h1', null, route.title), route.lead ? h('p', { class: 'lead' }, route.lead) : null)));
  const mod = route.mod; const fn = route.fn || 'render';
  try { body.append(mod[fn](ctx)); } catch (e) { console.error(e); body.append(h('div', { class: 'msg bad', role: 'alert' }, '■ This screen could not be drawn: ' + e.message)); }
  const t = todayISO();
  const top = h('header', { class: 'top', 'aria-label': 'Status' },
    ctx.store.canUndo() && !ctx.readOnly ? h('button', { class: 'btn sm', onClick: () => { const l = ctx.store.undoLabel(); ctx.store.undo(); toast('Undone: ' + (l || 'last change')); } }, '↶ Undo ' + ctx.store.undoLabel()) : null,
    h('span', { class: 'spacer' }), statusEl, h('span', { class: 'note', style: { whiteSpace: 'nowrap' } }, `Today · ${weekdayName(t).slice(0, 3)} ${dmy(t)}`),
    route.own ? null : h('button', { class: 'btn sm', onClick: () => ctx.go('open-trade'), disabled: ctx.readOnly }, '+ Open trade'));
  root.append(h('div', { class: 'app' }, side, h('div', { class: 'main' }, top, bannerEl, body)));
  paintStatus(); drawBanner();
  if (scroll) { const tw = document.querySelector('.tw.fx'); if (tw) tw.scrollTop = scroll; }
  if (keep) document.querySelector(`[data-keep="${keep}"]`)?.focus();
  checkShared();
}

// ------------------------------------------------------------- same stock, several open lines (2026-11-06)
// When open lines of the same stock show different shared values (first open of this version, import, restore):
// the higher highest price is used, and for last price, EMA10 and next report he chooses once in one pop-up.
// Checked again only when the set of open lines changes, so Undo or "Later" does not bring the pop-up straight back.
let sharedKey = null, sharedBusy = false;
function checkShared() {
  if (ctx.readOnly || sharedBusy || !ctx.store) return;
  const st = ctx.store.state;
  const key = st.trades.filter((t) => C.openQty(t) > 0n).map((t) => t.id + ':' + t.stockId).sort().join();
  if (key === sharedKey) return; sharedKey = key;
  const diffs = A.sharedDiffs(st); if (!diffs.length) return;
  sharedBusy = true; setTimeout(() => askShared(diffs).finally(() => { sharedBusy = false; }), 0);
}
async function askShared(diffs) {
  const asks = diffs.filter((g) => g.fields.length);
  const hiText = (g) => `${g.symbol}: highest price ${priceTxt(D.d(g.highest))} used on all ${g.trades.length} lines (the higher value).`;
  if (!asks.length) {
    const r = ctx.act((d) => A.alignShared(d), { label: 'highest price aligned', now: true });
    if (r.ok) toast(diffs.map(hiText).join(' '));
    return;
  }
  const NAMES = { last: 'Last price', ema10: 'EMA10', nextReport: 'Next report' };
  const show = (f, v) => v === '' ? 'Empty' : f === 'nextReport' ? dmy(v) : priceTxt(D.d(v));
  const picks = {};
  const body = h('div', null,
    para('Your open lines of the same stock now share last price, highest price, EMA10 and next report. Some values differ and the program cannot know which one is newer. Choose the right value once; after that they stay the same.', ''),
    ...diffs.map((g) => h('section', { class: 'shared-sec' },
      h('h3', null, g.symbol, h('span', { class: 'note' }, ' · ' + g.trades.join(', '))),
      g.highest !== null ? h('div', { class: 'note' }, `Highest price: ${show('highest', g.highest)} (the higher value is used, no choice needed).`) : null,
      ...g.fields.map((fd) => h('fieldset', { class: 'shared-f' }, h('legend', null, NAMES[fd.field]),
        ...fd.options.map((o) => h('label', { class: 'shared-o' },
          h('input', { type: 'radio', name: g.stockId + '-' + fd.field, onChange: () => { (picks[g.stockId] ??= {})[fd.field] = o.value; } }),
          h('b', null, show(fd.field, o.value)), h('span', { class: 'note' }, ' on ' + o.trades.join(', ')))))))));
  const done = await dialog({ title: 'Same stock, different values', wide: true, body, ok: 'Use these values', cancel: 'Later',
    onOk: () => {
      for (const g of asks) for (const fd of g.fields) if (picks[g.stockId]?.[fd.field] === undefined) return `Choose a value for ${g.symbol} ${NAMES[fd.field].toLowerCase()}.`;
      const r = ctx.act((d) => A.alignShared(d, picks), { label: 'shared values aligned', now: true });
      return r.ok ? true : r.error;
    } });
  if (done) toast('Values aligned.', 'Undo', () => ctx.store.undo());
  else toast('Not changed. You will be asked again next time the program opens.');
}
import * as C from '../calc.js';
import * as M from '../marks.js';
import * as D from '../decimal.js';
// same rule as "Needs your attention" on Open positions, so both numbers always match
function attentionCount() { return openPos.lines(ctx.store.state, todayISO()).filter((l) => l.status !== 'ok').length; }

welcome();
