// Marks (G): quiet hints only. They never block or change data. Every mark has an icon AND text.
import * as D from './decimal.js';
import { diffDays, weekStart, addDays } from './dates.js';
import * as C from './calc.js';

const lt = (a, b) => a !== null && b !== null && a < b;
export function lineMarks(state, t, today, account) {
  const S = state.settings; const out = [];
  const m = C.lineMetrics(state, t, account);
  const last = C.N(t.last), stop = C.N(t.currentStop), buy = D.d(t.buyPrice), hi = C.N(t.highest), ema = C.N(t.ema10);
  const stopAbove = stop !== null && stop > buy;
  // say = what is wrong, with the number (2026-11-06): shown on hover on the card and in the line panel
  // code (1.5.7) = a FIXED name the program uses to recognise a mark (filters, highlights, Auto order). The words
  // (text, why, say) are only what the screen shows, so they can be reworded without changing how the program works.
  const add = (code, level, icon, text, why, say) => out.push({ code, level, icon, text, why, say: say ?? text });
  const P = (x) => D.fmt(D.abs(x), 1) + ' %';
  const lim = (x) => x.replace('.', ',') + ' %';

  // G1 stops check
  if (last !== null && stop !== null) {
    if (last <= stop) add('atstop', 'crit', '■', 'At or below stop', 'Decide yourself: nothing was changed.', last === stop ? 'Last price is exactly at the stop' : `Last price is ${P(D.pct(D.sub(stop, last), stop))} below the stop`);
    else if (m.toStopPct !== null) {
      const L = stopAbove ? S.stopAboveBuy : S.stopBelowBuy;
      if (m.toStopPct <= D.d(L.closeWithin)) add('close', 'warn', '●', 'Close to stop', `Limit: within ${lim(L.closeWithin)}.`, `Price only ${P(m.toStopPct)} above the stop`);
      else if (m.toStopPct > D.d(L.raiseAbove)) add('raise', 'warn', '↑', 'Raise stop', `Limit: more than ${lim(L.raiseAbove)} above the stop.`, `Price ${P(m.toStopPct)} above the stop: raise the stop`);
    }
  } else if (stop === null) add('missing-stop', 'crit', '■', 'Missing: stop', 'No Current stop entered. Check that the position has a stop in your broker: without it the loss is not limited.');
  // Q11: no Initial stop -> R and risk cannot be calculated; always shown in "Needs your attention"
  if (C.N(t.initialStop) === null) add('missing-initial', 'warn', '◆', 'Missing: Initial stop', 'R cannot be calculated. Add it with Edit trade → Initial stop.');
  if (last === null) add('missing-last', 'warn', '◆', 'Missing: last price', 'No last price entered.');
  if (hi === null) add('missing-highest', 'warn', '◆', 'Missing: highest price', 'No highest price entered.');
  if (ema === null) add('missing-ema', 'warn', '◆', 'Missing: EMA10', 'No EMA10 entered.');
  // profit locked = stop more than profitLocked % above the buy price (2026-11-06: also decides red/orange for a near report)
  const buyToStop = stop !== null && buy > 0n ? D.pct(D.sub(stop, buy), buy) : null;
  const profitLocked = buyToStop !== null && buyToStop > D.d(S.profitLocked);

  // G2 next report
  if (t.nextReport) {
    const days = diffDays(today, t.nextReport);
    const noProfit = !profitLocked;
    const tail = noProfit ? (stop === null ? ': no stop, no profit locked' : `: stop not more than ${S.profitLocked.replace('.', ',')} % above buy price, no profit locked`) : '';
    const sayStop = !noProfit ? `stop ${P(buyToStop)} above buy price, profit locked` : stop === null ? 'no stop' : buyToStop < 0n ? `stop still ${P(buyToStop)} below buy price` : `stop only ${P(buyToStop)} above buy price`;
    if (days >= 0) {
      const wk = weekStart(today), nextWk = addDays(wk, 7);
      const rw = weekStart(t.nextReport);
      let text = null, strong = false;
      if (days === 0) { text = 'Report today'; strong = true; }
      else if (days === 1) { text = 'Report tomorrow'; strong = true; }
      else if (rw === wk) text = 'Report this week';
      else if (rw === nextWk) text = 'Report next week';
      const when = days === 0 ? 'Report today' : days === 1 ? 'Report tomorrow' : `Report in ${days} days`;
      if (text) add(days === 0 ? 'report-today' : days === 1 ? 'report-tomorrow' : rw === wk ? 'report-week' : 'report-nextweek', strong && noProfit ? 'neg' : 'warn', strong && noProfit ? '■' : '●', text + tail, `Report on ${t.nextReport.split('-').reverse().join('-')}.`, `${when}, ${sayStop}`);
    } else if (-days >= S.reportStaleDays) add('report-stale', 'warn', '◆', `Reported ${-days} days ago`, `Limit: ${S.reportStaleDays} days. Enter the next report date.`, `Last report ${-days} days ago, no new date entered`);
    else if (-days <= S.reportedAgoDays) add('reported', 'plain', '', `Reported ${-days} day${-days === 1 ? '' : 's'} ago`, 'Quiet reminder.');
  }
  // G3 highest to stop
  if (hi !== null && stop !== null && stop > 0n) {
    const p = D.pct(D.sub(hi, stop), hi);
    if (p !== null && p > D.d(S.highestToStop)) add('high-far', 'warn', '◆', 'Stop far below highest price', `Limit: ${lim(S.highestToStop)}.`, `Stop ${P(p)} below the highest price`);
  }
  // G4 EMA10
  if (last !== null && ema !== null && ema > 0n) {
    if (last < ema) add('below-ema', 'neg', '■', 'Below EMA10', 'Last price is below EMA10.', `Below EMA10 by ${P(D.pct(D.sub(ema, last), ema))}`);
    else if (D.pct(D.sub(last, ema), ema) < D.d(S.emaNear)) add('near-ema', 'warn', '●', 'Near EMA10', `Limit: less than ${lim(S.emaNear)} above EMA10.`, `Price only ${P(D.pct(D.sub(last, ema), ema))} above EMA10`);
  }
  // G5 stop vs buy price
  if (stop !== null && buy > 0n) {
    const p = D.pct(D.sub(stop, buy), buy);
    // one rule, two settings (2026-11-06): the stop is far below the buy price AND the risk at the stop is above the limit
    if (p < -D.d(S.stopFarBelowBuy)) { if (m.riskAtStopPct !== null && m.riskAtStopPct > D.d(S.stopFarBelowBuyRisk)) add('stop-far-buy', 'warn', '◆', 'Stop far below buy price', `Limits: more than ${lim(S.stopFarBelowBuy)} below buy and risk above ${lim(S.stopFarBelowBuyRisk)}.`, `Stop ${P(p)} below buy price (risk ${D.fmt(m.riskAtStopPct, 2)} % of capital)`); }
    else if (p > D.d(S.profitLocked)) add('profit-locked', 'pos', '✓', 'Profit locked in', `Limit: more than ${lim(S.profitLocked)} above buy.`, `Stop ${P(p)} above buy price: profit locked in`);
  }
  // G6 risk at stop
  if (m.riskAtStopPct !== null) {
    const why = 'Loss at the stop, as % of the capital this trade was opened with.';
    if (m.riskAtStopPct > D.d(S.riskRed)) add('risk-red', 'neg', '■', `Risk above ${S.riskRed.replace('.', ',')} %`, why, `Risk ${D.fmt(m.riskAtStopPct, 2)} % of capital (limit ${lim(S.riskRed)})`);
    else if (m.riskAtStopPct > D.d(S.riskWarn)) add('risk-warn', 'warn', '●', `Risk above ${S.riskWarn.replace('.', ',')} %`, why, `Risk ${D.fmt(m.riskAtStopPct, 2)} % of capital (limit ${lim(S.riskWarn)})`);
  }
  // G7 position size
  if (m.positionPct !== null) {
    const p = m.positionPct;
    if (p > D.d(S.posTooBig)) add('pos-big', 'neg', '■', 'Position too big', 'Last price × open shares, as % of the estimated account.', `Position ${P(p)} of account (limit ${lim(S.posTooBig)})`);
    else if (p >= D.d(S.posNear)) add('pos-near', 'warn', '●', 'Near size limit', 'Last price × open shares, as % of the estimated account.', `Position ${P(p)} of account (near the ${lim(S.posTooBig)} limit)`);
    else if (p >= D.d(S.posSmallFrom) && p <= D.d(S.posSmallTo)) add('pos-small', 'info', '◇', 'Small position', `Between ${S.posSmallFrom} % and ${S.posSmallTo} % of the estimated account.`, `Small position: ${P(p)} of account`);
  }
  const order = { crit: 0, neg: 1, warn: 2, info: 3, pos: 4, plain: 5 };
  out.sort((a, b) => order[a.level] - order[b.level]);
  return out;
}
// "needs attention" categories used by the chips on Open positions
export function attention(marks) {
  const cats = new Set();
  for (const m of marks) {
    // by the fixed code, never by the shown words (1.5.7)
    if (m.code === 'atstop') cats.add('atstop');
    else if (m.code === 'close') cats.add('close');
    else if (m.code === 'raise') cats.add('raise');
    else if (['report-today', 'report-tomorrow', 'report-week', 'report-nextweek'].includes(m.code)) cats.add('report');
    else if (m.code.startsWith('missing-')) cats.add('missing');
  }
  return cats;
}
// History result % of capital marks (G8) and per-stock marks
export function resultPctMark(pct, S) {
  if (pct === null) return null;
  if (pct <= -D.d(S.histLoss)) return { level: 'neg', icon: '▼', text: `Loss above ${S.histLoss.replace('.', ',')} %` };
  if (pct >= D.d(S.histGain)) return { level: 'pos', icon: '▲', text: `Gain above ${S.histGain.replace('.', ',')} %` };
  return null;
}
export function stockPctMark(pct, S) {
  if (pct === null) return null;
  if (pct <= -D.d(S.stockLoss2)) return { level: 'neg', icon: '■', text: `Loss above ${S.stockLoss2.replace('.', ',')} %` };
  if (pct <= -D.d(S.stockLoss1)) return { level: 'warn', icon: '▼', text: `Loss above ${S.stockLoss1.replace('.', ',')} %` };
  if (pct >= D.d(S.stockGain2)) return { level: 'pos', icon: '▲▲', text: `Gain above ${S.stockGain2.replace('.', ',')} %` };
  if (pct >= D.d(S.stockGain1)) return { level: 'pos', icon: '▲', text: `Gain above ${S.stockGain1.replace('.', ',')} %` };
  return null;
}

// Exceptions on Open positions ("Needs your attention", the status column and the menu count all use this one rule).
// 2026-11-06: every red and every orange mark needs attention (blue info, green and grey marks do not).
export function isException(m) {
  return m.level === 'crit' || m.level === 'neg' || m.level === 'warn';
}
// Card colour of a line: 'red' (Warning), 'orange' (Attention) or 'green' (Healthy)
export function cardStatus(marks) {
  if (marks.some((m) => m.level === 'crit' || m.level === 'neg')) return 'red';
  return marks.some((m) => m.level === 'warn') ? 'orange' : 'green';
}
// 'act' = act now (at or below the stop), 'rev' = review, 'ok' = on plan
export function lineStatus(marks) {
  if (marks.some((m) => m.level === 'crit')) return 'act';
  return marks.some(isException) ? 'rev' : 'ok';
}
