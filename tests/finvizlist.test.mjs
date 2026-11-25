// 1.8.14 (agreed 25-11-2026): "All in Finviz" and "Copy tickers" for the stocks a Scans list shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SC from '../js/scans.js';

test('tickers are written the Finviz way: upper case, BRK.B as BRK-B, each once, in list order', () => {
  assert.equal(SC.finvizTicker(' brk.b '), 'BRK-B');
  assert.deepEqual(SC.finvizTickers(['NVDA', 'adma', 'NVDA', 'BRK.B', '']), ['NVDA', 'ADMA', 'BRK-B']);
});

test('All in Finviz opens his Custom table (v=151) with only these tickers', () => {
  assert.equal(SC.finvizListUrl(['NVDA', 'ADMA', 'MSFT']), 'https://elite.finviz.com/screener/stocks?v=151&t=NVDA%2CADMA%2CMSFT');
  const big = Array.from({ length: 100 }, (_, i) => 'T' + i); const u = SC.finvizListUrl(big);
  assert.ok(u.length < 2000, 'a 100-stock list stays a short address'); assert.ok(!u.includes('auth='), 'no key in the address');
});
