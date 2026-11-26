// Exact decimal arithmetic. A value is a BigInt scaled by 10^8 (8 decimals).
// No floating point is used for money, quantities or percentages.
export const SCALE = 100000000n;
const SCALE_DIGITS = 8;

// Parse text like "1 234,56", "1234.56", "-0,5", "12" into a scaled BigInt. Returns null if not a number.
export function parse(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'bigint') return input;
  let s = String(input).trim().replace(/[\s ]/g, '').replace('−', '-');
  if (s === '') return null;
  // decimal comma or dot; if both appear, the last one is the decimal mark
  const lastC = s.lastIndexOf(','), lastD = s.lastIndexOf('.');
  if (lastC >= 0 && lastD >= 0) {
    if (lastC > lastD) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastC >= 0) {
    s = s.replace(',', '.');
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  let neg = false;
  if (s[0] === '-') { neg = true; s = s.slice(1); } else if (s[0] === '+') s = s.slice(1);
  let [ip, fp = ''] = s.split('.');
  if (ip === '') ip = '0';
  let extra = '';
  if (fp.length > SCALE_DIGITS) { extra = fp.slice(SCALE_DIGITS); fp = fp.slice(0, SCALE_DIGITS); }
  fp = fp.padEnd(SCALE_DIGITS, '0');
  let v = BigInt(ip) * SCALE + BigInt(fp);
  if (extra && extra[0] >= '5') v += 1n; // round half up on the 9th digit
  return neg ? -v : v;
}
export const d = (x) => { const v = parse(x); if (v === null) throw new Error('Not a number: ' + x); return v; };
export const ZERO = 0n;
export const add = (a, b) => a + b;
export const sub = (a, b) => a - b;
export const neg = (a) => -a;
export const abs = (a) => (a < 0n ? -a : a);
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const isZero = (a) => a === 0n;
export const sign = (a) => (a > 0n ? 1 : a < 0n ? -1 : 0);

function divRound(n, m) { // round half away from zero
  if (m === 0n) throw new Error('Division by zero');
  const negr = (n < 0n) !== (m < 0n);
  let nn = n < 0n ? -n : n, mm = m < 0n ? -m : m;
  let q = nn / mm; const r = nn % mm;
  if (r * 2n >= mm) q += 1n;
  return negr ? -q : q;
}
export const mul = (a, b) => divRound(a * b, SCALE);
export const div = (a, b) => divRound(a * SCALE, b);
// ratio a / b as a percentage value (e.g. 0.0525 -> 5.25), scaled
export const pct = (a, b) => (b === 0n ? null : divRound(a * 100n * SCALE, b));

// Canonical text for storage: dot decimal, no thousands, trimmed zeros.
export function toStr(a) {
  if (a === null || a === undefined) return '';
  const negv = a < 0n; let v = negv ? -a : a;
  const ip = v / SCALE; let fp = (v % SCALE).toString().padStart(SCALE_DIGITS, '0').replace(/0+$/, '');
  return (negv ? '-' : '') + ip.toString() + (fp ? '.' + fp : '');
}
// Display text: 1 234,56 with chosen decimals (default 2), optional sign.
export function fmt(a, dp = 2, opts = {}) {
  if (a === null || a === undefined) return '–';
  const f = 10n ** BigInt(SCALE_DIGITS - dp);
  let v = divRound(a, f); // at dp decimals
  const negv = v < 0n; if (negv) v = -v;
  const unit = 10n ** BigInt(dp);
  const ip = (v / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fp = dp > 0 ? ',' + (v % unit).toString().padStart(dp, '0') : '';
  const body = ip + fp;
  const plus = opts.sign && !negv && v !== 0n ? '+' : '';
  return (negv ? '−' : plus) + body;
}
// exact text for an input box while editing (comma decimal, no thousands)
export function edit(a) { return a === null || a === undefined ? '' : toStr(a).replace('.', ','); }
export function toNumber(a) { return Number(a) / Number(SCALE); } // for drawing charts only, never for money logic
// split total over weights, remainder on the last part (all parts add up exactly)
export function split(total, weights) {
  const sum = weights.reduce((x, y) => x + y, 0n);
  if (sum === 0n) return weights.map(() => 0n);
  const out = []; let used = 0n;
  weights.forEach((w, i) => {
    if (i === weights.length - 1) out.push(total - used);
    else { const p = divRound(total * w, sum); out.push(p); used += p; }
  });
  return out;
}
