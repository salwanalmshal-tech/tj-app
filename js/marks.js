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
  const add = (level, icon, text, why) => out.push({ level, icon, text, why });

  // G1 stops check
  if (last !== null && stop !== null) {
    if (last <= stop) add('crit', '■', 'At or below stop', 'Last price is at or below the Current stop. Decide yourself: nothing was changed.');
    else if (m.toStopPct !== null) {
      const lim = stopAbove ? S.stopAboveBuy : S.stopBelowBuy;
      if (m.toStopPct <= D.d(lim.closeWithin)) add('warn', '●', 'Close to stop', `Price is within ${lim.closeWithin.replace('.', ',')} % of the stop.`);
      else if (m.toStopPct > D.d(lim.raiseAbove)) add('info', '↑', 'Raise stop', `Price is more than ${lim.raiseAbove.replace('.', ',')} % above the stop.`);
    }
  } else if (stop === null) add('warn', '◆', 'Missing: stop', 'No stop entered, risk cannot be calculated.');
  if (last === null) add('warn', '◆', 'Missing: last price', 'No last price entered.');

  // G2 next report
  if (t.nextReport) {
    const days = diffDays(today, t.nextReport);
    const noProfit = !(stop !== null && stop > buy);
    const tail = noProfit ? (stop === null ? ': no stop, no profit locked' : ': stop not above buy price, no profit locked') : '';
    if (days >= 0) {
      const wk = weekStart(today), nextWk = addDays(wk, 7);
      const rw = weekStart(t.nextReport);
      let text = null, strong = false;
      if (days === 0) { text = 'Report today'; strong = true; }
      else if (days === 1) { text = 'Report tomorrow'; strong = true; }
      else if (rw === wk) text = 'Report this week';
      else if (rw === nextWk) text = 'Report next week';
      if (text) add(strong && noProfit ? 'neg' : 'warn', strong && noProfit ? '■' : '●', text + tail, `Report on ${t.nextReport}.`);
    } else if (-days <= S.reportedAgoDays) add('plain', '', `Reported ${-days} day${-days === 1 ? '' : 's'} ago`, 'Quiet reminder.');
  }
  // G3 highest to stop
  if (hi !== null && stop !== null && stop > 0n) {
    const p = D.pct(D.sub(hi, stop), hi);
    if (p !== null && p > D.d(S.highestToStop)) add('info', '◆', 'Stop far below highest price', `Highest price is more than ${S.highestToStop.replace('.', ',')} % above the stop.`);
  }
  // G4 EMA10
  if (last !== null && ema !== null && ema > 0n) {
    if (last < ema) add('neg', '■', 'Below EMA10', 'Last price is below EMA10.');
    else if (D.pct(D.sub(last, ema), ema) < D.d(S.emaNear)) add('warn', '●', 'Near EMA10', `Last price is less than ${S.emaNear.replace('.', ',')} % above EMA10.`);
  }
  // G5 stop vs buy price
  if (stop !== null && buy > 0n) {
    const p = D.pct(D.sub(stop, buy), buy);
    if (p < -D.d(S.stopFarBelowBuy)) add('warn', '◆', 'Stop far below buy price', `Stop is more than ${S.stopFarBelowBuy.replace('.', ',')} % below the buy price.`);
    else if (p > D.d(S.profitLocked)) add('pos', '✓', 'Profit locked in', `Stop is more than ${S.profitLocked.replace('.', ',')} % above the buy price.`);
  }
  // G6 risk at stop
  if (m.riskAtStopPct !== null) {
    if (m.riskAtStopPct > D.d(S.riskRed)) add('neg', '■', `Risk above ${S.riskRed.replace('.', ',')} %`, 'Loss at the stop, as % of the capital this trade was opened with.');
    else if (m.riskAtStopPct > D.d(S.riskWarn)) add('warn', '●', `Risk above ${S.riskWarn.replace('.', ',')} %`, 'Loss at the stop, as % of the capital this trade was opened with.');
  }
  // G7 position size
  if (m.positionPct !== null) {
    const p = m.positionPct;
    if (p > D.d(S.posTooBig)) add('neg', '■', 'Position too big', `Above ${S.posTooBig.replace('.', ',')} % of the estimated account.`);
    else if (p >= D.d(S.posNear)) add('warn', '●', 'Near size limit', `Between ${S.posNear.replace('.', ',')} % and ${S.posTooBig.replace('.', ',')} %.`);
    else if (p >= D.d(S.posSmallFrom) && p <= D.d(S.posSmallTo)) add('info', '◇', 'Small position', `Between ${S.posSmallFrom} % and ${S.posSmallTo} % of the estimated account.`);
  }
  const order = { crit: 0, neg: 1, warn: 2, info: 3, pos: 4, plain: 5 };
  out.sort((a, b) => order[a.level] - order[b.level]);
  return out;
}
// "needs attention" categories used by the chips on Open positions
export function attention(marks) {
  const cats = new Set();
  for (const m of marks) {
    if (m.text === 'At or below stop') cats.add('atstop');
    else if (m.text === 'Close to stop') cats.add('close');
    else if (m.text === 'Raise stop') cats.add('raise');
    else if (m.text.startsWith('Report today') || m.text.startsWith('Report tomorrow') || m.text.startsWith('Report this week') || m.text.startsWith('Report next week')) cats.add('report');
    else if (m.text.startsWith('Missing')) cats.add('missing');
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
