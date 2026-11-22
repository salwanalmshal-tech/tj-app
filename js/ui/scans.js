// 1.8.0 Scans tab (Step 1 of 3). His UX choices 2026-11-22: a Collect → Review → Send bar; scanners with dated runs on the
// left (newest run of each ticked by default); stocks found in ALL ticked runs in the middle (New first, then Watching /
// Near buy, then Rejected dimmed, each by RS); details on the right. Ctrl+V anywhere adds a scan; the same scanner pasted
// twice on one day asks first; keys ↑ ↓ N R W Enter ?; reject reason chips (managed in Lists); marks Open / Traded before /
// Seen N× / Earnings in N days; "Download for TradingView" takes only Near buy stocks (TradingView's .txt import format).
import { h, dialog, para, toast, download, dmy, field } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';
import * as A from '../actions.js';
import * as SC from '../scans.js';

const V = { pick: null, sel: null, more: {} };
let CTX = null;

const isTyping = (el) => !!el && (el.closest?.('input, textarea, select, [contenteditable="true"]'));
const dialogOpen = () => !!document.querySelector('.scrim');

// ---------------------------------------------------------------- keys and paste (only on the Scans tab)
if (typeof document !== 'undefined') {
  document.addEventListener('paste', (e) => {
    if (!CTX || CTX.route !== 'scans' || isTyping(e.target) || dialogOpen()) return;
    const text = e.clipboardData?.getData('text') ?? ''; if (!text.trim()) return;
    e.preventDefault(); takePaste(CTX, text);
  });
  document.addEventListener('keydown', (e) => {
    if (!CTX || CTX.route !== 'scans' || isTyping(e.target) || dialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key; const rows = LAST.rows; if (!rows.length && k !== '?') return;
    const i = Math.max(0, rows.findIndex((r) => r.t === V.sel));
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); const j = Math.min(rows.length - 1, Math.max(0, i + (k === 'ArrowDown' ? 1 : -1))); V.sel = rows[j].t; CTX.redraw(); return; }
    const cur = rows[i]; if (!cur && k !== '?') return;
    if (k === 'n' || k === 'N') { e.preventDefault(); setStatus(CTX, cur, 'near'); }
    else if (k === 'w' || k === 'W') { e.preventDefault(); setStatus(CTX, cur, 'watch'); }
    else if (k === 'r' || k === 'R') { e.preventDefault(); rejectDialog(CTX, cur); }
    else if (k === 'Enter') { e.preventDefault(); window.open(tvUrl(cur), '_blank', 'noopener'); }
    else if (k === '?') { e.preventDefault(); keysHelp(); }
  });
}
let LAST = { rows: [] };

const tvUrl = (r) => 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(r.full.includes(':') ? r.full : r.t);

// ---------------------------------------------------------------- page
export function render(ctx) {
  CTX = ctx; const st = ctx.store.state; const today = ctx.today();
  const groups = SC.runsByScanner(st);
  const ids = new Set((st.scans?.runs || []).map((r) => r.id));
  let pick = (V.pick || []).filter((id) => ids.has(id)); if (!V.pick || (!pick.length && V.pick.length)) pick = SC.defaultPick(st);
  V.pick = pick;
  const cmp = SC.compare(st, pick, today); LAST = cmp;
  if (!cmp.rows.some((r) => r.t === V.sel)) V.sel = cmp.rows[0]?.t ?? null;
  const sel = cmp.rows.find((r) => r.t === V.sel) || null;

  const head = h('header', { class: 'pg-head sc-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'Trade'), h('h1', null, 'Scans'),
    h('p', { class: 'lead' }, 'Your scanner results, the stocks they have in common, and your decision on each one.')),
    h('div', { class: 'sc-headbtns' }, h('button', { class: 'btn sm', onClick: () => collectHelp() }, 'Get TJ Collect'), h('button', { class: 'btn sm', 'aria-label': 'Keyboard keys', onClick: () => keysHelp() }, 'Keys ?')));
  if (!groups.length) return h('div', { class: 'scans' }, head, emptyState(ctx));

  const scannersToday = groups.filter((g) => g.runs[0].date === today).length;
  const decided = cmp.rows.filter((r) => r.mark).length; const near = cmp.rows.filter((r) => r.mark?.st === 'near');
  const stepNow = scannersToday < groups.length ? 0 : decided < cmp.rows.length ? 1 : 2;
  const step = (i, title, text, onClick) => h('button', { type: 'button', class: 'sc-step' + (i === stepNow ? ' now' : '') + (i < stepNow ? ' done' : ''), onClick }, h('b', null, `${i + 1} ${title}`), h('span', null, text));
  const steps = h('div', { class: 'sc-steps', role: 'group', 'aria-label': 'Your scan review' },
    step(0, 'Collect', `${scannersToday} of ${groups.length} scanner${groups.length === 1 ? '' : 's'} today`, () => pasteFromButton(ctx)),
    step(1, 'Review', cmp.rows.length ? `${decided} of ${cmp.rows.length} decided` : 'No stocks in common', () => { const f = cmp.rows.find((r) => !r.mark); if (f) { V.sel = f.t; ctx.redraw(); } }),
    step(2, 'Send', near.length ? `${near.length} near buy · download for TradingView` : 'No near buy yet', () => sendFile(cmp, today)));

  return h('div', { class: 'scans' }, head, steps, h('div', { class: 'sc-grid' }, leftPanel(ctx, st, groups, pick, today), middle(ctx, st, cmp, pick, today), right(ctx, st, sel, today)));
}

function emptyState(ctx) {
  return h('section', { class: 'card sc-empty' }, h('h2', null, 'Start with your first scan'),
    h('ol', null,
      h('li', null, h('b', null, 'Put TJ Collect on your bookmarks bar. '), 'Drag this button onto the bar (show it with Ctrl + Shift + B): ', dragButton()),
      h('li', null, h('b', null, 'Open a scanner on TradingView '), 'and click TJ Collect. It copies the scanner rows with every column you see.'),
      h('li', null, h('b', null, 'Come back here and press Ctrl + V. '), 'Do the same for each scanner; the stocks found by all of them appear here.')),
    h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => pasteFromButton(ctx) }, 'Paste a scan'), h('span', { class: 'note' }, 'You can also paste plain tickers, for example NVDA, AAPL, WMT.')));
}
function dragButton() {
  return h('a', { class: 'sc-drag', href: SC.collectHref(), draggable: 'true', title: 'Drag me to your bookmarks bar', onClick: (e) => { e.preventDefault(); toast('Drag this button onto your bookmarks bar. Clicking it here does nothing.'); } }, 'TJ Collect');
}
function collectHelp() {
  dialog({ title: 'Get the TJ Collect button', info: true, body: h('div', { style: { display: 'grid', gap: '10px' } },
    para('Drag the button below onto your bookmarks bar (show the bar with Ctrl + Shift + B). Then, on a TradingView scanner, click it: it copies only the scanner rows, every column you see, the scanner name and the date.', ''),
    h('div', null, dragButton()),
    para('Already have the old TJ test bookmark? You can delete it. If dragging does not work, right-click the button, choose Copy link, and paste it as the address of a new bookmark.', 'note')) });
}
function keysHelp() {
  const k = (key, what) => h('div', { class: 'sc-key' }, h('kbd', null, key), h('span', null, what));
  dialog({ title: 'Keys in Scans', info: true, body: h('div', { style: { display: 'grid', gap: '8px' } },
    k('↑ ↓', 'Move through the list'), k('N', 'Near buy'), k('R', 'Rejected (choose a reason)'), k('W', 'Watching'), k('Enter', 'Open the stock in TradingView'), k('Ctrl + V', 'Add a scan from TJ Collect'), k('?', 'This list'),
    para('The keys work only on this tab and never while you type in a box.', 'note')) });
}

// ---------------------------------------------------------------- left: scanners and their runs
function leftPanel(ctx, st, groups, pick, today) {
  const toggle = (id, on) => { V.pick = on ? [...new Set([...pick, id])] : pick.filter((x) => x !== id); if (!V.pick.length) V.pick = []; ctx.redraw(); };
  const runLine = (r) => h('div', { class: 'sc-run' + (pick.includes(r.id) ? ' on' : '') },
    h('label', null, h('input', { type: 'checkbox', checked: pick.includes(r.id), onChange: (e) => toggle(r.id, e.target.checked) }),
      h('span', null, (r.date === today ? 'Today' : dmy(r.date)) + ' · ' + r.rows.length), r.trimmed ? h('span', { class: 'note', title: `Older than ${st.settings.scanKeepDays} days: only the tickers are kept` }, ' · short') : null),
    h('button', { class: 'sc-x', 'aria-label': `Delete the ${r.scanner} scan of ${dmy(r.date)}`, disabled: ctx.readOnly, onClick: async () => {
      const ok = await dialog({ title: `Delete the ${r.scanner} scan of ${dmy(r.date)}?`, ok: 'Delete', danger: true, body: para('It moves to the Trash for 15 days. Your statuses on the stocks stay.', '') });
      if (!ok) return; const res = ctx.act((d) => A.deleteScanRun(d, r.id), { label: 'delete scan', now: true }); if (res.ok) toast('Scan moved to the Trash.', 'Restore', () => ctx.store.undo()); } }, '×'));
  return h('aside', { class: 'card sc-left', 'aria-label': 'Scanners' },
    h('h3', null, 'Scanners'),
    groups.map((g) => { const all = V.more[g.scanner]; const runs = all ? g.runs : g.runs.slice(0, 3);
      return h('div', { class: 'sc-scanner' }, h('div', { class: 'sc-sname', title: g.scanner }, g.scanner), runs.map(runLine),
        g.runs.length > 3 ? h('button', { class: 'linkish', onClick: () => { V.more[g.scanner] = !all; ctx.redraw(); } }, all ? 'Show fewer' : `Show ${g.runs.length - 3} older`) : null); }),
    h('div', { class: 'sc-paste' }, h('span', null, 'Press ', h('kbd', null, 'Ctrl'), ' + ', h('kbd', null, 'V'), ' to add a scan'), h('button', { class: 'btn sm', disabled: ctx.readOnly, onClick: () => pasteFromButton(ctx) }, 'Paste')));
}

// ---------------------------------------------------------------- middle: stocks in all ticked runs
function middle(ctx, st, cmp, pick, today) {
  const shown = shownCols(st, cmp.cols);
  const scanners = [...new Set(cmp.runs.map((r) => r.scanner))];
  const title = !pick.length ? 'Tick at least one scan' : pick.length === 1 ? `Stocks in ${cmp.runs[0].scanner}` : `In all ${pick.length} ticked scans`;
  const info = buildTradeInfo(st);
  const top = h('div', { class: 'sc-mhead' }, h('div', null, h('h3', null, title, h('span', { class: 'sc-count' }, cmp.rows.length)),
    h('span', { class: 'note' }, scanners.length > 1 ? scanners.join(' ∩ ') : `${cmp.universe} stocks in the ticked scan${pick.length === 1 ? '' : 's'}`)),
    h('button', { class: 'btn sm', onClick: () => colsDialog(ctx, cmp.cols, shown) }, 'Columns'));
  if (!cmp.rows.length) return h('section', { class: 'card sc-mid' }, top, h('div', { class: 'empty' }, h('b', null, pick.length ? `No stock is in all ${pick.length} ticked scans` : 'No scan ticked'), h('span', null, pick.length ? 'Untick a scan on the left to see more.' : 'Tick a scan on the left.')));
  const group = (r) => (!r.mark ? 0 : r.mark.st === 'rej' ? 2 : 1);
  const GN = ['New', 'Watching and near buy', 'Rejected'];
  const nGroup = [0, 1, 2].map((g) => cmp.rows.filter((r) => group(r) === g).length);
  const head = h('tr', null, h('th', null, 'Stock'), h('th', { class: 'r', title: 'RS (scan): strength over 3, 6 and 12 months, ranked 1–99 against every stock in the ticked scans. Needs the Perf 3M column in your scanner.' }, 'RS'), shown.map((c) => h('th', { class: 'r' }, c)), h('th', null, 'Status'));
  const body = []; let last = -1;
  for (const r of cmp.rows) {
    const g = group(r); if (g !== last) { last = g; body.push(h('tr', { class: 'sc-grp' }, h('td', { colspan: String(shown.length + 3) }, `${GN[g]} · ${nGroup[g]}`))); }
    body.push(h('tr', { class: 'sc-row' + (r.t === V.sel ? ' on' : '') + (g === 2 ? ' rej' : ''), tabindex: '-1', 'aria-selected': String(r.t === V.sel), onClick: () => { V.sel = r.t; ctx.redraw(); } },
      h('td', null, h('div', { class: 'sc-sym' }, h('b', null, r.t), g === 0 ? h('span', { class: 'sc-tag new' }, 'New') : null, ...marks(st, r, info, today, true))),
      h('td', { class: 'r' + (r.rs !== null && r.rs >= 80 ? ' sc-strong' : '') }, r.rs ?? '–'),
      shown.map((c) => h('td', { class: 'r' }, r.vals[c] || '–')),
      h('td', null, statusText(st, r.mark))));
  }
  setTimeout(() => document.querySelector('.sc-row.on')?.scrollIntoView({ block: 'nearest' }), 0);
  return h('section', { class: 'card sc-mid' }, top, h('div', { class: 'sc-tw' }, h('table', { class: 'sc-t' }, h('thead', null, head), h('tbody', null, body))),
    h('div', { class: 'note sc-foot' }, h('kbd', null, '↑'), ' ', h('kbd', null, '↓'), ' move · ', h('kbd', null, 'N'), ' near buy · ', h('kbd', null, 'R'), ' reject · ', h('kbd', null, 'W'), ' watch · ', h('kbd', null, 'Enter'), ' TradingView'));
}
function shownCols(st, cols) {
  const saved = (st.scans?.showCols || []).filter((c) => cols.includes(c)); if (saved.length) return saved;
  const want = [/^adr/i, /sector/i, /^price$/i, /^float\s*%|float %/i, /earning/i]; const out = [];
  for (const re of want) { const c = cols.find((x) => re.test(x) && !out.includes(x)); if (c) out.push(c); }
  return out.length ? out : cols.slice(0, 4);
}
function colsDialog(ctx, cols, shown) {
  if (!cols.length) return dialog({ title: 'No columns', info: true, body: para('This scan has only tickers. Scans copied with TJ Collect bring every column you see in TradingView.', '') });
  const boxes = cols.map((c) => [c, h('input', { type: 'checkbox', checked: shown.includes(c) })]);
  dialog({ title: 'Columns to show', ok: 'Show', body: h('div', { class: 'sc-cols' }, para('Up to 8. All columns stay saved with each scan; this only chooses what you see.', 'note'), boxes.map(([c, b]) => h('label', null, b, ' ', c))),
    onOk: () => { const pickd = boxes.filter(([, b]) => b.checked).map(([c]) => c); if (pickd.length > 8) return 'Choose 8 columns at most.'; const r = ctx.act((d) => A.setScanCols(d, pickd), { label: 'scan columns', now: true }); return r.ok ? true : r.error; } });
}

// open / traded before per symbol, from his trades
function buildTradeInfo(st) {
  const m = new Map();
  for (const t of st.trades) {
    const sym = (A.symbolOf(st, t) || '').toUpperCase(); if (!m.has(sym)) m.set(sym, { open: false, closed: [] });
    const x = m.get(sym); if (C.openQty(t) > 0n) x.open = true; else if (t.sales.length) x.closed.push(t);
  }
  return m;
}
function marks(st, r, info, today, short) {
  const out = []; const x = info.get(r.t);
  if (x?.open) out.push(h('span', { class: 'sc-tag open', title: 'You hold this stock now' }, '● Open'));
  if (x?.closed.length) {
    const rs = x.closed.map((t) => C.rMultiple(t)).filter((v) => v !== null); const sum = rs.reduce((a, b) => a + b, 0n);
    const when = x.closed.map((t) => `${t.id} · bought ${dmy(t.buyDate)}`).join('\n');
    out.push(h('span', { class: 'sc-tag past', title: when }, `↺ ${x.closed.length} trade${x.closed.length === 1 ? '' : 's'}` + (rs.length ? `, ${D.fmt(sum, 1, { sign: true })} R` : '')));
  }
  const seen = SC.seenCount(st, r.t, today); if (seen >= 2) out.push(h('span', { class: 'sc-tag seen', title: `Found by your scans on ${seen} different days in the last ${SC.SEEN_DAYS} days` }, `Seen ${seen} days`));
  if (r.earnings && r.earnings.days >= 0 && r.earnings.days <= 30) out.push(h('span', { class: 'sc-tag ' + (r.earnings.days <= 7 ? 'earn' : 'earnlater'), title: 'Earnings date ' + dmy(r.earnings.iso) }, r.earnings.days === 0 ? 'Earnings today' : `Earnings in ${r.earnings.days} d`));
  return out;
}
function statusText(st, m) {
  if (!m) return h('span', { class: 'sc-st new' }, 'Not decided');
  const reasons = m.st === 'rej' ? reasonNames(st, m) : '';
  return h('span', { class: 'sc-st ' + m.st, title: `${SC.STATUS[m.st]} on ${dmy(m.date)}${reasons ? ' · ' + reasons : ''}` }, SC.STATUS[m.st], m.st === 'rej' && reasons ? h('span', { class: 'sc-why' }, ' · ' + reasons) : null);
}
const reasonNames = (st, m) => [...(m.reasons || []).map((id) => st.rejects.find((x) => x.id === id)?.name).filter(Boolean), m.other || ''].filter(Boolean).join(', ');

// ---------------------------------------------------------------- right: the selected stock
function right(ctx, st, r, today) {
  if (!r) return h('aside', { class: 'card sc-right' }, h('div', { class: 'empty' }, h('b', null, 'No stock selected'), h('span', null, 'Pick a stock in the list.')));
  const info = buildTradeInfo(st); const m = r.mark;
  const btn = (key, label, s) => h('button', { type: 'button', class: 'sc-sbtn ' + s + (m?.st === s ? ' on' : ''), 'aria-pressed': String(m?.st === s), disabled: ctx.readOnly, onClick: () => (s === 'rej' ? rejectDialog(ctx, r) : setStatus(ctx, r, s)) }, label, h('kbd', null, key));
  const vals = Object.entries(r.vals).filter(([, v]) => v);
  return h('aside', { class: 'card sc-right', 'aria-label': 'Selected stock' },
    h('div', { class: 'sc-rhead' }, h('div', null, h('div', { class: 'sc-big' }, r.t), h('span', { class: 'note' }, (r.full.includes(':') ? r.full.split(':')[0] : 'Exchange unknown') + (r.rs !== null ? ` · RS ${r.rs}` : ''))),
      h('a', { class: 'btn sm', href: tvUrl(r), target: '_blank', rel: 'noopener' }, 'Open in TradingView ↗')),
    h('div', { class: 'sc-sbtns', role: 'group', 'aria-label': 'Status' }, btn('W', 'Watching', 'watch'), btn('N', 'Near buy', 'near'), btn('R', 'Rejected', 'rej')),
    m ? h('p', { class: 'note' }, `${SC.STATUS[m.st]} since ${dmy(m.date)}` + (m.st === 'rej' && reasonNames(st, m) ? ' · ' + reasonNames(st, m) : ''), m.st === 'rej' ? h('button', { class: 'linkish', onClick: () => rejectDialog(ctx, r) }, ' Change reason') : null)
      : h('p', { class: 'note' }, 'Not decided yet.'),
    h('div', { class: 'sc-marks' }, marks(st, r, info, today, false)),
    vals.length ? h('dl', { class: 'sc-vals' }, vals.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])) : h('p', { class: 'note' }, 'Only the ticker was pasted for this stock.'));
}

// ---------------------------------------------------------------- actions
function setStatus(ctx, r, status, reasons = [], other = '') {
  const res = ctx.act((d) => A.setScanMark(d, r.t, { status, reasons, other, date: ctx.today() }), { label: `${r.t} ${SC.STATUS[status].toLowerCase()}`, now: true });
  if (!res.ok) return toast(res.error);
  // after a decision, go on to the next stock that is not decided yet (keeps the review flowing)
  const next = LAST.rows.find((x) => !x.mark && x.t !== r.t); if (next && !r.mark) V.sel = next.t;
  ctx.redraw();
}
function rejectDialog(ctx, r) {
  if (ctx.readOnly) return;
  const st = ctx.store.state; const m = r.mark?.st === 'rej' ? r.mark : null;
  const on = new Set(m?.reasons || []);
  const chips = st.rejects.filter((x) => !x.archived || on.has(x.id)).map((x) => { const b = h('button', { type: 'button', class: 'sc-chip' + (on.has(x.id) ? ' on' : ''), 'aria-pressed': String(on.has(x.id)), onClick: () => { if (on.has(x.id)) on.delete(x.id); else on.add(x.id); b.classList.toggle('on'); b.setAttribute('aria-pressed', String(on.has(x.id))); } }, x.name); return b; });
  const other = h('input', { value: m?.other || '', placeholder: 'Other reason (optional)', 'aria-label': 'Other reason', maxlength: '120' });
  dialog({ title: `Reject ${r.t}`, ok: 'Reject', body: h('div', { style: { display: 'grid', gap: '10px' } }, h('div', { class: 'sc-chips' }, chips), field('Other', other), para('Add or rename the chips in Lists → Reject reasons.', 'note')),
    onOk: () => { setStatus(ctx, r, 'rej', [...on], other.value); return true; } });
}

// paste: from Ctrl+V anywhere on the tab, or the Paste button (asks the browser for the clipboard; falls back to a box)
async function pasteFromButton(ctx) {
  if (ctx.readOnly) return;
  try { const t = await navigator.clipboard.readText(); if (t && t.trim()) return takePaste(ctx, t); } catch { /* browser said no: use the box */ }
  const box = h('textarea', { rows: '6', 'aria-label': 'Paste here', placeholder: 'Press Ctrl + V here' });
  setTimeout(() => box.focus(), 0);
  dialog({ title: 'Paste a scan', ok: 'Add', body: h('div', { style: { display: 'grid', gap: '8px' } }, para('Click TJ Collect on your TradingView scanner, then paste here. Plain tickers work too.', 'note'), box),
    onOk: () => { const p = SC.parsePaste(box.value); if (!p.ok) return p.error; setTimeout(() => takePaste(ctx, box.value), 0); return true; } });
}
async function takePaste(ctx, text) {
  if (ctx.readOnly) return;
  const p = SC.parsePaste(text); if (!p.ok) return toast(p.error);
  const today = ctx.today(); let scanner = p.scanner; let date = p.date || today;
  if (p.kind === 'plain' || !scanner) {
    const names = SC.runsByScanner(ctx.store.state).map((g) => g.scanner);
    const nm = h('input', { value: scanner || '', list: 'sc-names', 'aria-label': 'Scanner name', maxlength: '60' });
    setTimeout(() => nm.focus(), 0);
    const ok = await dialog({ title: `Name this scan (${p.rows.length} stock${p.rows.length === 1 ? '' : 's'})`, ok: 'Add', body: h('div', { style: { display: 'grid', gap: '8px' } }, field('Scanner', nm), h('datalist', { id: 'sc-names' }, names.map((n) => h('option', { value: n }))),
      p.skipped?.length ? para(`Not tickers, left out: ${p.skipped.slice(0, 8).join(', ')}${p.skipped.length > 8 ? '…' : ''}`, 'note') : null),
      onOk: () => (nm.value.trim() ? true : 'Give the scanner a name.') });
    if (!ok) return; scanner = nm.value.trim();
  }
  let replace = false;
  if (A.scanRunExists(ctx.store.state, scanner, date)) {
    const keep = h('input', { type: 'radio', name: 'sc-dup', value: 'keep' }); const rep = h('input', { type: 'radio', name: 'sc-dup', value: 'replace', checked: true });
    const ok = await dialog({ title: `${scanner} was already added ${date === today ? 'today' : 'on ' + dmy(date)}`, ok: 'Add', body: h('div', { class: 'sc-dup' },
      h('label', null, rep, ' Replace that scan with this one'), h('label', null, keep, ' Keep both'), para('Your statuses on the stocks stay either way.', 'note')) });
    if (!ok) return; replace = rep.checked;
  }
  const res = ctx.act((d) => A.addScanRun(d, { scanner, date, cols: p.cols, rows: p.rows, shown: p.shown }, { replace, today }), { label: 'scan ' + scanner, now: true });
  if (!res.ok) return toast(res.error);
  V.pick = null; V.sel = null; ctx.redraw();
  const miss = p.shown && p.rows.length < p.shown ? ` TradingView showed ${p.shown}; scroll to the bottom of the list and collect again to get all.` : '';
  toast(`${scanner}: ${p.rows.length} stocks added.` + miss, 'Undo', () => ctx.store.undo(), miss ? 9000 : 5000);
}
function sendFile(cmp, today) {
  const near = cmp.rows.filter((r) => r.mark?.st === 'near');
  if (!near.length) return toast('No stock is marked Near buy yet. Select a stock and press N.');
  download(`TJ near buy ${dmy(today)}.txt`, new Blob([SC.tradingViewText(near)], { type: 'text/plain' }));
  dialog({ title: `${near.length} near buy stock${near.length === 1 ? '' : 's'} saved for TradingView`, info: true, body: h('div', { style: { display: 'grid', gap: '8px' } },
    para('In TradingView: click the name of a watchlist at the top of the right panel, choose Import list…, and pick the file “' + `TJ near buy ${dmy(today)}.txt` + '” from your Downloads.', ''),
    para('Importing lists needs a paid TradingView plan (Essential or higher).', 'note')) });
}
