/**
 * Verification script for Task #876 - ST Trigger Bands engine.
 *
 * Runs computeStTriggerBands on real daily bars from Firestore and checks the
 * output against an independent, deliberately naive re-implementation of the
 * Pine definitions (PRD #863), plus structural invariants. Prints the last N
 * bars so the result can be compared by eye with the TradingView chart.
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/verify/indicator-lib-876-engine.ts [SYMBOL] [LAST_N]
 *
 * Requires Application Default Credentials with access to the rel-str
 * Firestore symbol-data collection.
 */

import { loadAllDailyBars } from '../../src/st-cloud-function/backtest/backtest-data-loader';
import { computeStTriggerBands } from '../../src/indicators/st-trigger-bands';
import type { OHLCV } from '../../src/indicators/st-trend-bands';

let checks = 0;
let passed = 0;

function check(label: string, condition: boolean): void {
  checks++;
  if (condition) passed++;
  console.log(`  ${condition ? 'PASS' : 'FAIL'} ${label}`);
}

/** Naive reference: recomputes every flag straight from the PRD definitions. */
function reference(bars: OHLCV[]) {
  const n = bars.length;
  const bh = bars.map((b) => Math.max(b.open, b.close));
  const bl = bars.map((b) => Math.min(b.open, b.close));
  const up = (t: number) => (t >= 2 ? Math.max(bh[t], bh[t - 1], bh[t - 2]) : undefined);
  const lo = (t: number) => (t >= 2 ? Math.min(bl[t], bl[t - 1], bl[t - 2]) : undefined);
  const lPull: boolean[] = [], lState: boolean[] = [], lBrk: boolean[] = [];
  const sPull: boolean[] = [], sState: boolean[] = [], sBrk: boolean[] = [];
  for (let t = 0; t < n; t++) {
    const [u, u1, u2] = [up(t), up(t - 1), up(t - 2)];
    const [l, l1, l2] = [lo(t), lo(t - 1), lo(t - 2)];
    lPull[t] = u !== undefined && u1 !== undefined && u <= u1;
    lBrk[t] =
      u1 !== undefined && u2 !== undefined && u2 >= u1 &&
      bh[t] > u1 && bh[t - 1] <= u2 && !!lState[t - 1];
    lState[t] = lPull[t] ? true : lBrk[t] ? false : !!lState[t - 1];
    sPull[t] = l !== undefined && l1 !== undefined && l >= l1;
    sBrk[t] =
      l1 !== undefined && l2 !== undefined && l2 <= l1 &&
      bl[t] < l1 && bl[t - 1] >= l2 && !!sState[t - 1];
    sState[t] = sPull[t] ? true : sBrk[t] ? false : !!sState[t - 1];
  }
  return { lPull, lState, lBrk, sPull, sState, sBrk };
}

const same = (a: boolean[], b: boolean[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const count = (a: boolean[]): number => a.filter(Boolean).length;

async function main(): Promise<void> {
  const symbol = (process.argv[2] ?? 'SPY').toUpperCase();
  const lastN = Number(process.argv[3] ?? 15);
  console.log(`=== Task #876 Verification: ST Trigger Bands engine (${symbol}) ===\n`);

  const raw = await loadAllDailyBars(symbol);
  const bars: OHLCV[] = raw.map((b) => ({ open: b.open ?? 0, high: b.high ?? 0, low: b.low ?? 0, close: b.close ?? 0, volume: b.volume }));
  console.log(`Loaded ${bars.length} ${symbol} daily bars`);
  check('bars loaded', bars.length > 50);

  const r = computeStTriggerBands(bars);
  const ref = reference(bars);
  const n = bars.length;

  console.log('\nStructure');
  check('all arrays have one entry per bar', Object.values(r).every((a) => a.length === n));
  check('first two bands are null', r.upper[0] === null && r.upper[1] === null && r.lower[0] === null && r.lower[1] === null);
  check('bands are finite from bar 3 on', r.upper.slice(2).every((v) => Number.isFinite(v)) && r.lower.slice(2).every((v) => Number.isFinite(v)));
  check('upper >= lower everywhere', r.upper.every((u, i) => u === null || u >= (r.lower[i] as number)));
  check(
    'upper >= current body high, lower <= current body low',
    bars.every((b, i) => r.upper[i] === null || (r.upper[i]! >= Math.max(b.open, b.close) && r.lower[i]! <= Math.min(b.open, b.close))),
  );

  console.log('\nAgreement with independent reference');
  check('longPullback', same(r.longPullback, ref.lPull));
  check('longPullbackState', same(r.longPullbackState, ref.lState));
  check('longBreakout', same(r.longBreakout, ref.lBrk));
  check('shortPullback', same(r.shortPullback, ref.sPull));
  check('shortPullbackState', same(r.shortPullbackState, ref.sState));
  check('shortBreakout', same(r.shortBreakout, ref.sBrk));

  console.log('\nInvariants');
  check('a breakout never coincides with a pullback (long)', r.longBreakout.every((b, i) => !b || !r.longPullback[i]));
  check('a breakout never coincides with a pullback (short)', r.shortBreakout.every((b, i) => !b || !r.shortPullback[i]));
  check('every breakout follows an armed state (long)', r.longBreakout.every((b, i) => !b || (i > 0 && r.longPullbackState[i - 1])));
  check('every breakout follows an armed state (short)', r.shortBreakout.every((b, i) => !b || (i > 0 && r.shortPullbackState[i - 1])));
  check('state is off on a breakout bar', r.longBreakout.every((b, i) => !b || !r.longPullbackState[i]) && r.shortBreakout.every((b, i) => !b || !r.shortPullbackState[i]));

  console.log('\nCounts');
  console.log(`  bars ${n} | long pullback ${count(r.longPullback)} breakout ${count(r.longBreakout)} | short pullback ${count(r.shortPullback)} breakout ${count(r.shortBreakout)}`);
  check('some breakouts occur on each side', count(r.longBreakout) > 0 && count(r.shortBreakout) > 0);

  console.log(`\nLast ${lastN} bars (compare with TradingView):`);
  console.log('  idx  open     close    upper    lower    LPB LPS LBK | SPB SPS SBK');
  for (let i = Math.max(0, n - lastN); i < n; i++) {
    const f = (v: number | null) => (v === null ? '   -    ' : v.toFixed(2).padStart(8));
    const flag = (v: boolean) => (v ? ' x ' : ' . ');
    console.log(
      `  ${String(i).padStart(4)} ${bars[i].open.toFixed(2).padStart(8)} ${bars[i].close.toFixed(2).padStart(8)} ${f(r.upper[i])} ${f(r.lower[i])} ${flag(r.longPullback[i])}${flag(r.longPullbackState[i])}${flag(r.longBreakout[i])}|${flag(r.shortPullback[i])}${flag(r.shortPullbackState[i])}${flag(r.shortBreakout[i])}`,
    );
  }

  console.log(`\n${passed}/${checks} checks passed`);
  process.exit(passed === checks ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
