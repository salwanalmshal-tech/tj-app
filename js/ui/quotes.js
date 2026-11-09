// Small handwritten quotes in the empty top bar (2026-11-09). A new quote each time you open a page.
// Short quotes from the traders the journal follows: Jesse Livermore, Mark Minervini, Kristjan Kullamägi (Qullamaggie).
export const QUOTES = [
  ['It was never my thinking that made the big money for me. It was always my sitting.', 'Jesse Livermore'],
  ['Markets are never wrong, but opinions often are.', 'Jesse Livermore'],
  ['Never average losses.', 'Jesse Livermore'],
  ['Not taking the loss, that is what does damage to the pocketbook and to the soul.', 'Jesse Livermore'],
  ["If you can't sleep at night because of your stock position, then you have gone too far.", 'Jesse Livermore'],
  ["Don't try to play the market all the time.", 'Jesse Livermore'],
  ['Trade along the path of least resistance.', 'Jesse Livermore'],
  ['I never argue with the tape.', 'Jesse Livermore'],
  ['Watch the market leaders.', 'Jesse Livermore'],
  ['Being a little late in a trade is insurance that your opinion is correct.', 'Jesse Livermore'],
  ['Trading is not a get rich quick scheme.', 'Jesse Livermore'],
  ['Successful trading is always an emotional battle for the speculator, not an intelligent battle.', 'Jesse Livermore'],
  ["I don't buy long stocks on a scale down, I buy on scale-up.", 'Jesse Livermore'],
  ['Stocks are never too high for you to begin buying or too low to begin selling.', 'Jesse Livermore'],
  ['What has happened in the past will happen again.', 'Jesse Livermore'],
  ["It's better to lose correctly than to win incorrectly.", 'Mark Minervini'],
  ['Never stray from the basics of rule number one of always going in with a plan.', 'Mark Minervini'],
  ['To compound your money, and not your mistakes, buy on the way up—not on the way down.', 'Mark Minervini'],
  ['There really is no intelligent reason to increase your trading size if your positions are showing losses.', 'Mark Minervini'],
  ['During a difficult trading environment your gains will be smaller and less frequent.', 'Mark Minervini'],
  ['Not losing big is the single most important factor for winning big.', 'Mark Minervini'],
  ['Long-term success in the stock market has nothing to do with hope or luck.', 'Mark Minervini'],
  ["That's what trading is all about, small losses, big wins.", 'Qullamaggie'],
  ['This is what 99% of trading is, waiting and stalking.', 'Qullamaggie'],
  ["I can't trade them all, I need to wait for my specific setups.", 'Qullamaggie'],
  ['Day one is where accounts are broken, I learned it the hard way.', 'Qullamaggie'],
  ["The successful ones don't give up. They stick with it.", 'Qullamaggie'],
  ['Just follow the price action.', 'Qullamaggie'],
  ["Holding is so hard. Just holding a stock and trailing your stop, it's so hard.", 'Qullamaggie'],
  ["Don't buy breakouts in corrective markets; remember that mantra.", 'Qullamaggie'],
  ['You should build a database of perfect setups.', 'Qullamaggie'],
  ["Always use market stops, otherwise, you'll get into trouble.", 'Qullamaggie'],
  ["I didn't really deviate from my plan or methodology in any way, that's the most important thing.", 'Qullamaggie'],
  ['Usually, the biggest pullbacks always come after my biggest runs.', 'Qullamaggie'],
  ['Just focus on price action, focus on what the market is doing.', 'Qullamaggie'],
  ['Every trade teaches something.', ''],
  ['Study your trades, trade a better future.', ''],
];
let lastRoute = null, idx = -1;
// Same quote while you stay on a page (the page redraws often); a different one when you open another page.
export function quoteFor(route, rnd = Math.random) {
  if (route !== lastRoute || idx < 0) { let n; do { n = Math.floor(rnd() * QUOTES.length); } while (QUOTES.length > 1 && n === idx); idx = n; lastRoute = route; }
  return QUOTES[idx];
}
