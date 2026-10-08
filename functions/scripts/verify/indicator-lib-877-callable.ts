/**
 * Verification script for Task #877 - Trigger Bands in the indicator-series pipeline.
 *
 * Loads real cached bars for a symbol exactly as the callable does, runs
 * computeSymbolIndicatorSeries + filterResponse, and checks that:
 *   - indicators.triggerBands exists for D/W/M with one point per bar, aligned
 *     to the bar dates and equal to the engine output,
 *   - dotMarkers.triggerBands carries one dot per armed pullback bar and per breakout flag,
 *   - the response filter returns Trigger Bands only when requested and leaves
 *     the default response untouched,
 *   - the payload cost of opting in is reported.
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/verify/indicator-lib-877-callable.ts [SYMBOL]
 *
 * Requires Application Default Credentials with access to the rel-str
 * Firestore symbol-data collection.
 */

import { getCachedBarsFromSymbolData } from '../../src/st-cloud-function/data-loader';
import {
  ChartInterval,
  IndicatorFamily,
  computeSymbolIndicatorSeries,
  barsToOhlcv,
} from '../../src/st-cloud-function/indicator-computation';
import {
  DEFAULT_INDICATORS,
  DEFAULT_INTERVALS,
  DEFAULT_STRATEGIES,
  filterResponse,
} from '../../src/st-cloud-function/indicator-series-filter';
import { computeStTriggerBands } from '../../src/indicators/st-trigger-bands';

let checks = 0;
let passed = 0;

function check(label: string, condition: boolean): void {
  checks++;
  if (condition) passed++;
  console.log(`  ${condition ? 'PASS' : 'FAIL'} ${label}`);
}

const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v));

async function main(): Promise<void> {
  const symbol = (process.argv[2] ?? 'AAPL').toUpperCase();
  console.log(`=== Task #877 Verification: Trigger Bands in the indicator series (${symbol}) ===\n`);

  const today = new Date().toISOString().slice(0, 10);
  const { dailyBars, weeklyBars, monthlyBars } = await getCachedBarsFromSymbolData(symbol, today);
  console.log(`Loaded ${dailyBars.length} daily / ${weeklyBars.length} weekly / ${monthlyBars.length} monthly bars`);
  check('bars loaded for all three intervals', dailyBars.length > 50 && weeklyBars.length > 50 && monthlyBars.length > 10);

  const full = computeSymbolIndicatorSeries(symbol, dailyBars, weeklyBars, monthlyBars);
  const byInterval = {
    [ChartInterval.DAILY]: dailyBars,
    [ChartInterval.WEEKLY]: weeklyBars,
    [ChartInterval.MONTHLY]: monthlyBars,
  } as const;

  for (const interval of [ChartInterval.DAILY, ChartInterval.WEEKLY, ChartInterval.MONTHLY]) {
    const bars = byInterval[interval];
    const data = full.intervals[interval]!;
    const pts = data.indicators.triggerBands ?? [];
    const dots = data.dotMarkers?.triggerBands ?? [];
    const eng = computeStTriggerBands(barsToOhlcv(bars));
    console.log(`\n${interval}`);
    check('one point per bar, dates aligned', pts.length === bars.length && pts.every((p, i) => p.d === bars[i].d));
    check(
      'bands and six flags equal the engine output',
      pts.every((p, i) =>
        p.upper === eng.upper[i] && p.lower === eng.lower[i] &&
        p.longPullback === eng.longPullback[i] && p.longPullbackState === eng.longPullbackState[i] &&
        p.longBreakout === eng.longBreakout[i] && p.shortPullback === eng.shortPullback[i] &&
        p.shortPullbackState === eng.shortPullbackState[i] && p.shortBreakout === eng.shortBreakout[i]),
    );
    // Pullback dots fire on every armed-state bar (the warning stays lit
    // until the breakout clears it); breakouts fire per bar.
    const expectedDots =
      eng.longPullbackState.filter(Boolean).length + eng.shortPullbackState.filter(Boolean).length +
      eng.longBreakout.filter(Boolean).length + eng.shortBreakout.filter(Boolean).length;
    check(`dot count equals armed-pullback + breakout count (${dots.length})`, dots.length === expectedDots);
    check(
      'long dots below the bar low, short dots above the bar high',
      dots.every((m) => (m.direction === 'long' ? m.y < bars[m.index].l : m.y > bars[m.index].h)),
    );
    check('every dot is tagged TB and indexed in range', dots.every((m) => m.version === 'TB' && m.index >= 0 && m.index < bars.length));
    check('last point is the last bar', pts[pts.length - 1]?.d === bars[bars.length - 1].d);
  }

  console.log('\nFiltering and payload');
  const def = filterResponse(full, DEFAULT_INTERVALS, DEFAULT_INDICATORS, DEFAULT_STRATEGIES);
  const opt = filterResponse(full, DEFAULT_INTERVALS, [...DEFAULT_INDICATORS, IndicatorFamily.TRIGGER_BANDS], DEFAULT_STRATEGIES);
  check(
    'default request returns no trigger bands',
    DEFAULT_INTERVALS.every((i) => def.intervals[i]!.indicators.triggerBands === undefined && def.intervals[i]!.dotMarkers?.triggerBands === undefined),
  );
  check(
    'opt-in request returns trigger bands for every interval',
    DEFAULT_INTERVALS.every((i) => (opt.intervals[i]!.indicators.triggerBands?.length ?? 0) > 0 && opt.intervals[i]!.dotMarkers?.triggerBands !== undefined),
  );
  const [bd, bo] = [bytes(def), bytes(opt)];
  console.log(`  payload: default ${(bd / 1024).toFixed(0)} KiB, with Trigger Bands ${(bo / 1024).toFixed(0)} KiB (+${(((bo - bd) / bd) * 100).toFixed(0)}%)`);

  console.log(`\n${passed}/${checks} checks passed`);
  process.exit(passed === checks ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
