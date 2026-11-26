// Dates are stored as ISO text yyyy-mm-dd and shown as dd-mm-yyyy. The program never changes a typed date.
const pad = (n) => String(n).padStart(2, '0');
export function parseDMY(text) { // accepts dd-mm-yyyy, dd.mm.yyyy, dd/mm/yyyy, also yyyy-mm-dd
  if (!text) return null;
  const s = String(text).trim();
  let m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s);
  let y, mo, da;
  if (m) { da = +m[1]; mo = +m[2]; y = +m[3]; }
  else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) { y = +m[1]; mo = +m[2]; da = +m[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, da));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== da) return null;
  return `${y}-${pad(mo)}-${pad(da)}`;
}
export function fmtDMY(iso) { if (!iso) return '–'; const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}`; }
const toUTC = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export function diffDays(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); } // b - a
export function addDays(iso, n) { const dt = new Date(toUTC(iso) + n * 86400000); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; }
export function weekday(iso) { return new Date(toUTC(iso)).getUTCDay(); } // 0 Sunday
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekdayName = (iso) => WEEKDAYS[weekday(iso)];
export const isWeekend = (iso) => { const w = weekday(iso); return w === 0 || w === 6; };
export function todayISO(now = new Date()) { return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; } // computer clock, local time
export function weekStart(iso) { const w = weekday(iso); return addDays(iso, -((w + 6) % 7)); } // Monday
export const monthKey = (iso) => iso.slice(0, 7);
export const yearKey = (iso) => iso.slice(0, 4);
