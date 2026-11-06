// Tiny DOM helpers. Text is ALWAYS inserted as text (never as HTML), so typed or imported data can never run as code.
import * as D from '../decimal.js';
import { fmtDMY, parseDMY, todayISO } from '../dates.js';

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  add(el, kids); return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// ---- number / date text ----
export const money = (a, o) => (a === null || a === undefined ? '–' : D.fmt(a, 2, o));
export const signed = (a) => (a === null || a === undefined ? '–' : D.fmt(a, 2, { sign: true }));
export const pctTxt = (a, dp = 2, o) => (a === null || a === undefined ? '–' : D.fmt(a, dp, o) + ' %');
export const qtyTxt = (a) => { if (a === null || a === undefined) return '–'; const s = D.fmt(a, 8); return s.includes(',') ? s.replace(/0+$/, '').replace(/,$/, '') : s; };
export const priceTxt = (a) => (a === null || a === undefined ? '–' : D.fmt(a, 2));
export const numClass = (a) => (a === null || a === undefined ? 'mut' : a > 0n ? 'pos' : a < 0n ? 'neg' : '');
export const dmy = fmtDMY;
export const num = (s) => (s === '' || s === null || s === undefined ? null : D.parse(s));

// ---- toast ----
let toastEl, toastTimer;
export function toast(text, actionLabel, onAction, ms = 5000) {
  toastEl?.remove(); clearTimeout(toastTimer);
  toastEl = h('div', { class: 'toastwrap', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'toast' }, text, actionLabel ? h('button', { onClick: () => { toastEl?.remove(); onAction?.(); } }, actionLabel) : null));
  document.body.append(toastEl); toastTimer = setTimeout(() => toastEl?.remove(), ms);
}

// ---- dialog: always Cancel and OK (the only exception is a one-button information box) ----
export function dialog({ title, body, ok = 'OK', cancel = 'Cancel', danger = false, info = false, onOk, wide = false, confirmWord = null, cls = '' }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    let okBtn;
    const close = (v) => { scrim.remove(); document.removeEventListener('keydown', onKey, true); prevFocus?.focus?.(); resolve(v); };
    const msg = h('div', { class: 'msg bad', style: { display: 'none', marginTop: '10px' }, role: 'alert' });
    const doOk = async () => {
      okBtn.disabled = true;
      try { const r = onOk ? await onOk() : true; if (r === false) return; if (typeof r === 'string') { msg.textContent = '■ ' + r; msg.style.display = 'flex'; return; } close(true); }
      finally { okBtn.disabled = confirmWord ? true : false; if (confirmWord) check(); }
    };
    let word;
    const check = () => { okBtn.disabled = word.value !== confirmWord; };
    if (confirmWord) word = h('input', { 'aria-label': 'Type ' + confirmWord, style: { width: '140px' }, onInput: check, autocomplete: 'off' });
    okBtn = h('button', { class: 'btn ' + (danger && !info ? 'dng' : 'pri'), onClick: doOk, disabled: !!confirmWord }, ok);
    const cancelBtn = info ? null : h('button', { class: 'btn', onClick: () => close(false) }, cancel);
    const box = h('div', { class: 'dlg' + (wide ? ' wide' : '') + (cls ? ' ' + cls : ''), role: danger ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-label': title, style: danger ? { border: '2px solid var(--neg)' } : null },
      h('h2', { style: danger ? { color: 'var(--neg)' } : null }, title), body,
      confirmWord ? h('label', { class: 'fld', style: { marginTop: '10px' } }, 'Type ' + confirmWord + ' to confirm', word) : null,
      msg,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '14px', justifyContent: 'flex-end' } }, cancelBtn, okBtn));
    const scrim = h('div', { class: 'scrim fixed' }, box);
    const onKey = (e) => {
      if (document.querySelector('.dp-pop')) return; // a calendar is open on top: it handles its own keys
      if (e.key === 'Escape') { e.stopPropagation(); close(info ? true : false); }
      else if (e.key === 'Tab') { const f = [...box.querySelectorAll('button:not(:disabled),input,select,textarea,[tabindex]')].filter((x) => x.offsetParent !== null); if (!f.length) return; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON' && !confirmWord) { e.preventDefault(); if (!okBtn.disabled) doOk(); }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.append(scrim);
    (box.querySelector('input,select,textarea') || cancelBtn || okBtn).focus();
  });
}
// A before -> after table used by pop-ups that change something.
export function changeTable(rows, head = ['Value', 'Before', 'After']) {
  return h('div', { class: 'tw' }, h('table', null,
    h('thead', null, h('tr', null, head.map((x, i) => h('th', { class: i ? 'r' : '' }, x)))),
    h('tbody', null, rows.map((r) => h('tr', { class: r.changed ? 'changed' : '' }, h('td', null, r[0]), h('td', { class: 'r' }, r[1]), h('td', { class: 'r' }, r.changed ? h('b', null, r[2]) : r[2]))))));
}
export const para = (t, cls = 'sub') => h('p', { class: cls, style: { margin: '0 0 10px' } }, t);
export function field(label, input, note) { return h('label', { class: 'fld' }, label, input, note ? h('span', { class: 'note' }, note) : null); }
export function infoBtn(title, text) {
  return h('button', { class: 'i', 'aria-label': 'Explain ' + title, title: text, onClick: (e) => { e.stopPropagation(); dialog({ title, body: para(text, ''), info: true }); } }, 'i');
}
export function pill(m) { return h('span', { class: 'pill ' + (m.level === 'plain' ? '' : m.level), title: m.say && m.say !== m.text ? m.say : m.why }, m.icon ? m.icon + ' ' : '', m.text); }
export function download(name, blob) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---- date field: shows and accepts dd-mm-yyyy (C2), any separator when typing, plus a calendar (P6) with Today and Clear (P7).
// getISO() -> 'yyyy-mm-dd', '' when empty, null when the text is not a valid date. setISO(iso) fills it and fires an input event.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function calIcon() {
  const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('aria-hidden', 'true');
  for (const [tag, at] of [['rect', { x: 2, y: 3, width: 12, height: 11, rx: 2 }], ['path', { d: 'M2 6.5h12M5.5 1.5v3M10.5 1.5v3' }]]) {
    const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(at)) e.setAttribute(k, v);
    e.setAttribute('fill', 'none'); e.setAttribute('stroke', 'currentColor'); e.setAttribute('stroke-width', '1.4'); svg.append(e);
  }
  return svg;
}
export function datePicker({ iso = '', label = 'Date', onChange } = {}) {
  const inp = h('input', { value: iso ? fmtDMY(iso) : '', placeholder: 'dd-mm-yyyy', inputmode: 'numeric', 'aria-label': label, autocomplete: 'off' });
  const btn = h('button', { type: 'button', class: 'dp-btn', 'aria-label': 'Open calendar: ' + label, 'aria-haspopup': 'dialog' }, calIcon());
  const wrap = h('div', { class: 'dp' }, inp, btn);
  const fire = () => { inp.dispatchEvent(new Event('input', { bubbles: true })); onChange?.(); };
  wrap.input = inp;
  // behaves like a plain text input for older screens: .value is the dd-mm-yyyy text, .focus() focuses the text
  Object.defineProperty(wrap, 'value', { get: () => inp.value, set: (v) => { inp.value = v; } });
  wrap.focus = () => inp.focus();
  wrap.getISO = () => { const t = inp.value.trim(); return t ? parseDMY(t) : ''; };
  wrap.setISO = (v) => { inp.value = v ? fmtDMY(v) : ''; fire(); };
  inp.addEventListener('blur', () => { const v = wrap.getISO(); if (v) inp.value = fmtDMY(v); });
  let pop = null;
  const closePop = () => { if (!pop) return; pop.remove(); pop = null; document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', keys, true); window.removeEventListener('resize', closePop); btn.setAttribute('aria-expanded', 'false'); };
  const outside = (e) => { if (pop && !pop.contains(e.target) && !btn.contains(e.target)) closePop(); };
  const keys = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); btn.focus(); } };
  const open = () => {
    if (pop) return closePop();
    const today = todayISO(); const cur = wrap.getISO() || today;
    let y = +cur.slice(0, 4), m = +cur.slice(5, 7) - 1;
    pop = h('div', { class: 'dp-pop', role: 'dialog', 'aria-label': 'Choose a date' });
    const draw = () => {
      const sel = wrap.getISO(); const first = new Date(Date.UTC(y, m, 1)); const lead = (first.getUTCDay() + 6) % 7; const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const cells = []; for (let i = 0; i < lead; i++) cells.push(h('span'));
      for (let d = 1; d <= days; d++) {
        const v = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        cells.push(h('button', { type: 'button', class: 'dp-d' + (v === sel ? ' sel' : '') + (v === today ? ' now' : ''), 'aria-label': fmtDMY(v), 'aria-pressed': v === sel ? 'true' : 'false', onClick: () => { wrap.setISO(v); closePop(); inp.focus(); } }, d));
      }
      const nav = (k) => { m += k; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } draw(); };
      clear(pop).append(
        h('div', { class: 'dp-h' }, h('button', { type: 'button', class: 'dp-n', 'aria-label': 'Previous month', onClick: () => nav(-1) }, '‹'), h('b', null, `${MONTHS[m]} ${y}`), h('button', { type: 'button', class: 'dp-n', 'aria-label': 'Next month', onClick: () => nav(1) }, '›')),
        h('div', { class: 'dp-g' }, ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((w) => h('span', { class: 'dp-w' }, w)), cells),
        h('div', { class: 'dp-f' }, h('button', { type: 'button', class: 'btn sm', onClick: () => { wrap.setISO(today); closePop(); inp.focus(); } }, 'Today'), h('button', { type: 'button', class: 'btn sm ghost', onClick: () => { wrap.setISO(''); closePop(); inp.focus(); } }, 'Clear')));
      (pop.querySelector('.dp-d.sel') || pop.querySelector('.dp-d.now') || pop.querySelector('.dp-d'))?.focus();
    };
    document.body.append(pop); draw();
    const r = wrap.getBoundingClientRect(); const w = pop.offsetWidth, hgt = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    pop.style.top = (r.bottom + 6 + hgt > innerHeight && r.top - hgt - 6 > 0 ? r.top - hgt - 6 : r.bottom + 6) + 'px';
    document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', keys, true); window.addEventListener('resize', closePop);
    btn.setAttribute('aria-expanded', 'true');
  };
  btn.addEventListener('click', open);
  inp.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); open(); } });
  return wrap;
}
