// Reminder pop-ups for the later History options (agreed 2026-11-08, Q18): at 100 closed trades for option 2 (pattern search),
// at 150 for option 3 (AI review). "Stop reminding me" ends it for good; "Remind me after 10 more closed trades" waits.
// Counts fully closed trades only. Shown after a closing is finished, or when the program opens (e.g. after an import). Saved in the data file.
import { h, dialog, para } from './dom.js';
import * as C from '../calc.js';

const ITEMS = [
  { key: 'o2', at: 100, title: 'History option 2: pattern search',
    text: (n) => `You now have ${n} closed trades — enough for option 2. The program would look through all your trades for groups that do clearly better or worse (for example by setup, days held, stop distance or how you bought), each with a sample-size warning. Ask Claude to plan it with you.` },
  { key: 'o3', at: 150, title: 'History option 3: AI review',
    text: (n) => `You now have ${n} closed trades — enough for option 3. An AI would read your checks, trades and comments and give a written review, compared with the principles of the traders you follow. It sends your trade data to an AI service and costs money per review. Ask Claude to plan it with you.` },
];
export const closedCount = (st) => st.trades.filter((t) => t.sales.length && C.openQty(t) === 0n).length;
let busy = false;
export async function checkReminders(ctx) {
  if (busy || ctx.readOnly || !ctx.store) return; busy = true;
  try {
    for (const it of ITEMS) {
      const st = ctx.store.state; const n = closedCount(st); const r = st.reminders?.[it.key] || { stopped: false, next: it.at };
      if (r.stopped || n < r.next) continue;
      const stop = await dialog({ title: it.title, ok: 'Stop reminding me', cancel: 'Remind me after 10 more closed trades', body: h('div', null, para(it.text(n), '')) });
      const val = stop ? { stopped: true, next: r.next } : { stopped: false, next: n + 10 };
      ctx.act((d) => { d.reminders = { ...(d.reminders || {}), [it.key]: val }; return { ok: true }; }, { label: 'reminder', noUndo: true, now: true });
    }
  } finally { busy = false; }
}
