// Tiny DOM helpers. Text is ALWAYS inserted as text (never as HTML), so typed or imported data can never run as code.
import * as D from '../decimal.js';
import { fmtDMY } from '../dates.js';

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
export function dialog({ title, body, ok = 'OK', cancel = 'Cancel', danger = false, info = false, onOk, wide = false, confirmWord = null }) {
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
    const box = h('div', { class: 'dlg' + (wide ? ' wide' : ''), role: danger ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-label': title, style: danger ? { border: '2px solid var(--neg)' } : null },
      h('h2', { style: danger ? { color: 'var(--neg)' } : null }, title), body,
      confirmWord ? h('label', { class: 'fld', style: { marginTop: '10px' } }, 'Type ' + confirmWord + ' to confirm', word) : null,
      msg,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '14px', justifyContent: 'flex-end' } }, cancelBtn, okBtn));
    const scrim = h('div', { class: 'scrim fixed' }, box);
    const onKey = (e) => {
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
export function pill(m) { return h('span', { class: 'pill ' + (m.level === 'plain' ? '' : m.level), title: m.why }, m.icon ? m.icon + ' ' : '', m.text); }
export function download(name, blob) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
