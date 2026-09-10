/**
 * Verification script for Task #268 — Std Dev Lines computation engine.
 *
 * Two-part verification:
 *   Part A: Deterministic golden-value checks with a synthetic fixture
 *   Part B: Real Firestore SPY data — structure, NaN handling, formula,
 *           symmetry, ordering, EMA mode
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/verify/indicator-lib-268-engine.ts
 *
 * Requires Application Default Credentials with access to the rel-str
 * Firestore symbol-data collection.
 */

import { loadAllDailyBars } from '../../src/st-cloud-function/backtest/backtest-data-loader';
import { computeStdDevLines } from '../../src/indicators/std-dev-lines';
import type { OHLCV } from '../../src/indicators/st-trend-bands';

let checks = 0;
let passed = 0;

function check(label: string, condition: boolean): void {
  checks++;
  if (condition) {
    passed++;
    console.log(`  ✔ ${label}`);
  } else {
    console.log(`  ✖ ${label}`);
  }
}

function approxEqual(actual: number, expected: number, tol: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) < tol;
}

// ─── Synthetic fixture for golden-value checks ──────────────────────────────
// 5 bars with closes [100, 101, 102, 103, 104], period=5
// SMA at bar 4 = 102
// Population std dev = sqrt( (4+1+0+1+4)/5 ) = sqrt(2) ≈ 1.41421356
const SYNTH_BARS: OHLCV[] = [
  { open: 100, high: 100, low: 100, close: 100 },
  { open: 101, high: 101, low: 101, close: 101 },
  { open: 102, high: 102, low: 102, close: 102 },
  { open: 103, high: 103, low: 103, close: 103 },
  { open: 104, high: 104, low: 104, close: 104 },
];
const SYNTH_PERIOD = 5;
const SYNTH_MEAN = 102.0;
const SYNTH_STDDEV = Math.sqrt(2.0); // ≈ 1.41421356
const TOL = 1e-6;

async function main(): Promise<void> {
  console.log('=== Task #268 Verification: Std Dev Lines Engine ===\n');

  // ═══════════════════════════════════════════════════════════════════════════
  // Part A: Deterministic golden-value checks (no Firestore)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('Part A: Golden-value checks (synthetic fixture)\n');

  const synthResult = computeStdDevLines(SYNTH_BARS, {
    centerLineType: 'sma',
    period: SYNTH_PERIOD,
  });

  // A.1: SMA center line golden value
  check('SMA center line at bar 4 = 102',
    approxEqual(synthResult.centerLine[4], SYNTH_MEAN, TOL));

  // A.2: Population std dev golden value
  check('std dev at bar 4 = sqrt(2)',
    approxEqual(synthResult.stdDev[4], SYNTH_STDDEV, TOL));

  // A.3: NaN for first period-1 bars
  let synthNanCount = 0;
  for (let i = 0; i < SYNTH_PERIOD - 1; i++) {
    if (Number.isNaN(synthResult.centerLine[i])) synthNanCount++;
  }
  check(`centerLine NaN for first ${SYNTH_PERIOD - 1} bars`,
    synthNanCount === SYNTH_PERIOD - 1);

  // A.4: Band formula verification — upper = center + level × stdDev
  for (const band of synthResult.regularBands) {
    const expectedUpper = SYNTH_MEAN + band.level * SYNTH_STDDEV;
    const expectedLower = SYNTH_MEAN - band.level * SYNTH_STDDEV;
    check(`regular ${band.level} upper = ${expectedUpper.toFixed(4)}`,
      approxEqual(band.upper[4], expectedUpper, TOL));
    check(`regular ${band.level} lower = ${expectedLower.toFixed(4)}`,
      approxEqual(band.lower[4], expectedLower, TOL));
  }

  for (const band of synthResult.fibBands) {
    const expectedUpper = SYNTH_MEAN + band.level * SYNTH_STDDEV;
    const expectedLower = SYNTH_MEAN - band.level * SYNTH_STDDEV;
    check(`fib ${band.level} upper = ${expectedUpper.toFixed(4)}`,
      approxEqual(band.upper[4], expectedUpper, TOL));
    check(`fib ${band.level} lower = ${expectedLower.toFixed(4)}`,
      approxEqual(band.lower[4], expectedLower, TOL));
  }

  // A.5: EMA golden values (period=3 on same fixture)
  // EMA seed at bar 2 = SMA(100,101,102) = 101
  // k = 0.5; bar 3: 0.5*103+0.5*101 = 102; bar 4: 0.5*104+0.5*102 = 103
  const emaSynth = computeStdDevLines(SYNTH_BARS, {
    centerLineType: 'ema',
    period: 3,
  });
  check('EMA seed at bar 2 = 101', approxEqual(emaSynth.centerLine[2], 101.0, TOL));
  check('EMA at bar 3 = 102', approxEqual(emaSynth.centerLine[3], 102.0, TOL));
  check('EMA at bar 4 = 103', approxEqual(emaSynth.centerLine[4], 103.0, TOL));

  // EMA std dev golden values:
  // Seed var = ((100-101)^2 + (101-101)^2 + (102-101)^2) / 3 = 2/3
  // bar 3: diff=1, var = 0.5*1 + 0.5*(2/3) = 5/6
  // bar 4: diff=1, var = 0.5*1 + 0.5*(5/6) = 11/12
  check('EMA std dev at bar 2 = sqrt(2/3)',
    approxEqual(emaSynth.stdDev[2], Math.sqrt(2 / 3), TOL));
  check('EMA std dev at bar 3 = sqrt(5/6)',
    approxEqual(emaSynth.stdDev[3], Math.sqrt(5 / 6), TOL));
  check('EMA std dev at bar 4 = sqrt(11/12)',
    approxEqual(emaSynth.stdDev[4], Math.sqrt(11 / 12), TOL));

  // A.6: Edge cases
  const emptyResult = computeStdDevLines([], { centerLineType: 'sma', period: 5 });
  check('empty input returns empty arrays', emptyResult.centerLine.length === 0);

  const shortResult = computeStdDevLines(SYNTH_BARS.slice(0, 3), {
    centerLineType: 'sma',
    period: 5,
  });
  check('short input: all centerLine NaN', shortResult.centerLine.every(v => Number.isNaN(v)));
  check('short input: all stdDev NaN', shortResult.stdDev.every(v => Number.isNaN(v)));
  check('short input: all regular band upper NaN',
    shortResult.regularBands.every(b => b.upper.every(v => Number.isNaN(v))));

  const invalidPeriod = computeStdDevLines(SYNTH_BARS, { centerLineType: 'sma', period: 0 });
  check('period=0: all centerLine NaN', invalidPeriod.centerLine.every(v => Number.isNaN(v)));

  const nonIntegerPeriod = computeStdDevLines(SYNTH_BARS, { centerLineType: 'sma', period: 2.5 });
  check('period=2.5: all centerLine NaN', nonIntegerPeriod.centerLine.every(v => Number.isNaN(v)));

  // ═══════════════════════════════════════════════════════════════════════════
  // Part B: Real Firestore SPY data
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nPart B: Real Firestore SPY data verification\n');

  // ── B.1: Load and validate data ──
  console.log('B.1: Load SPY daily bars from Firestore');
  const rawBars = await loadAllDailyBars('SPY');
  if (rawBars.length === 0) {
    console.error('  ✖ No bars loaded from Firestore — aborting');
    process.exit(1);
  }
  check('loaded bars from Firestore', rawBars.length > 0);
  console.log(`  Loaded ${rawBars.length} SPY daily bars`);

  const PERIOD = 50;
  if (rawBars.length < PERIOD) {
    console.error(`  ✖ Only ${rawBars.length} bars loaded — need at least ${PERIOD} — aborting`);
    process.exit(1);
  }
  check(`loaded at least ${PERIOD} bars`, rawBars.length >= PERIOD);
  console.log(`  Date range: ${rawBars[0].date ?? 'N/A'} to ${rawBars[rawBars.length - 1].date ?? 'N/A'}`);

  // Map bars — reject malformed bars instead of defaulting to 0
  const bars: OHLCV[] = [];
  const barDates: (string | undefined)[] = [];
  let malformedCount = 0;
  for (const b of rawBars) {
    if (b.close === undefined || b.close === null || Number.isNaN(b.close)) {
      malformedCount++;
      continue;
    }
    bars.push({
      open: b.open ?? b.close,
      high: b.high ?? b.close,
      low: b.low ?? b.close,
      close: b.close,
      volume: b.volume,
    });
    barDates.push(b.date);
  }
  check('no malformed bars (close is defined)', malformedCount === 0);
  if (malformedCount > 0) {
    console.log(`  Warning: skipped ${malformedCount} bars with missing close`);
  }

  // ── B.2: Run computeStdDevLines (SMA, period=50) ──
  console.log('\nB.2: Run computeStdDevLines (SMA, period=50, default levels)');
  const result = computeStdDevLines(bars, { centerLineType: 'sma', period: PERIOD });

  // ── B.3: Validate structure ──
  console.log('\nB.3: Validate structure');
  check('centerLine length matches input', result.centerLine.length === bars.length);
  check('stdDev length matches input', result.stdDev.length === bars.length);
  check('regularBands has 5 levels', result.regularBands.length === 5);
  check('fibBands has 3 levels', result.fibBands.length === 3);

  const expectedRegLevels = [0.5, 1.0, 1.5, 2.0, 2.5];
  const expectedFibLevels = [0.618, 1.618, 2.618];
  check('regular band levels match defaults',
    result.regularBands.every((b, i) => b.level === expectedRegLevels[i]));
  check('fib band levels match defaults',
    result.fibBands.every((b, i) => b.level === expectedFibLevels[i]));

  // ── B.4: Validate NaN handling ──
  console.log('\nB.4: Validate NaN handling (first 49 bars + band arrays)');
  let nanCount = 0;
  for (let i = 0; i < PERIOD - 1; i++) {
    if (Number.isNaN(result.centerLine[i])) nanCount++;
  }
  check(`centerLine is NaN for first ${PERIOD - 1} bars`, nanCount === PERIOD - 1);

  let stdDevNanCount = 0;
  for (let i = 0; i < PERIOD - 1; i++) {
    if (Number.isNaN(result.stdDev[i])) stdDevNanCount++;
  }
  check(`stdDev is NaN for first ${PERIOD - 1} bars`, stdDevNanCount === PERIOD - 1);

  // Band arrays should also be NaN for first period-1 bars
  let bandNanCount = 0;
  for (const band of result.regularBands) {
    for (let i = 0; i < PERIOD - 1; i++) {
      if (Number.isNaN(band.upper[i]) && Number.isNaN(band.lower[i])) bandNanCount++;
    }
  }
  check(`regular band upper/lower NaN for first ${PERIOD - 1} bars`,
    bandNanCount === result.regularBands.length * (PERIOD - 1));

  // First non-NaN bar (guard against undefined false positive)
  check(`centerLine[${PERIOD - 1}] is finite`,
    bars.length > PERIOD - 1 && Number.isFinite(result.centerLine[PERIOD - 1]));
  check(`stdDev[${PERIOD - 1}] is finite`,
    bars.length > PERIOD - 1 && Number.isFinite(result.stdDev[PERIOD - 1]));

  // ── B.5: Validate band formula at multiple bars ──
  console.log('\nB.5: Validate band formula (center ± level × stdDev)');
  const sampleIndices = [
    PERIOD - 1,           // first non-NaN bar
    Math.floor(bars.length / 2),  // middle
    bars.length - 1,      // last bar
  ];
  for (const idx of sampleIndices) {
    const c = result.centerLine[idx];
    const sd = result.stdDev[idx];
    for (const band of result.regularBands) {
      const expectedUpper = c + band.level * sd;
      const expectedLower = c - band.level * sd;
      check(`bar ${idx} regular ${band.level} upper = center + level×stdDev`,
        approxEqual(band.upper[idx], expectedUpper, 1e-6));
      check(`bar ${idx} regular ${band.level} lower = center - level×stdDev`,
        approxEqual(band.lower[idx], expectedLower, 1e-6));
    }
  }

  // ── B.6: Validate band symmetry at multiple bars ──
  console.log('\nB.6: Validate band symmetry (first, middle, last bar)');
  for (const idx of sampleIndices) {
    const c = result.centerLine[idx];
    for (const band of [...result.regularBands, ...result.fibBands]) {
      const upperDist = band.upper[idx] - c;
      const lowerDist = c - band.lower[idx];
      check(`bar ${idx} ${band.level} symmetric`,
        Math.abs(upperDist - lowerDist) < 1e-10);
    }
  }

  // ── B.7: Validate band ordering (upper widens, lower narrows) ──
  console.log('\nB.7: Validate band ordering (upper + lower)');
  const lastIdx = bars.length - 1;
  for (let i = 1; i < result.regularBands.length; i++) {
    const prev = result.regularBands[i - 1];
    const curr = result.regularBands[i];
    check(`regular ${curr.level} upper > ${prev.level} upper`,
      curr.upper[lastIdx] > prev.upper[lastIdx]);
    check(`regular ${curr.level} lower < ${prev.level} lower`,
      curr.lower[lastIdx] < prev.lower[lastIdx]);
  }
  for (let i = 1; i < result.fibBands.length; i++) {
    const prev = result.fibBands[i - 1];
    const curr = result.fibBands[i];
    check(`fib ${curr.level} upper > ${prev.level} upper`,
      curr.upper[lastIdx] > prev.upper[lastIdx]);
    check(`fib ${curr.level} lower < ${prev.level} lower`,
      curr.lower[lastIdx] < prev.lower[lastIdx]);
  }

  // ── B.8: Print sample values for last 5 bars ──
  console.log('\nB.8: Sample values (last 5 bars)');
  const reg1 = result.regularBands.find(b => b.level === 1.0);
  const fib1618 = result.fibBands.find(b => b.level === 1.618);
  console.log('  date         | close     | center    | stdDev    | reg 1.0 upper | reg 1.0 lower | fib 1.618 upper | fib 1.618 lower');
  console.log('  -------------|-----------|-----------|-----------|---------------|---------------|-----------------|------------------');
  const startIdx = Math.max(bars.length - 5, 0);
  for (let i = startIdx; i < bars.length; i++) {
    const date = barDates[i] ?? `bar ${i}`;
    const close = bars[i].close;
    const c = result.centerLine[i];
    const sd = result.stdDev[i];
    const fmt = (v: number) => Number.isFinite(v) ? v.toFixed(2) : 'NaN';
    console.log(
      `  ${date} | ${fmt(close)} | ${fmt(c)} | ${Number.isFinite(sd) ? sd.toFixed(4) : 'NaN'} | ${reg1 ? fmt(reg1.upper[i]) : 'N/A'} | ${reg1 ? fmt(reg1.lower[i]) : 'N/A'} | ${fib1618 ? fmt(fib1618.upper[i]) : 'N/A'} | ${fib1618 ? fmt(fib1618.lower[i]) : 'N/A'}`,
    );
  }

  // ── B.9: Validate EMA mode ──
  console.log('\nB.9: Validate EMA mode (complete checks)');
  const emaResult = computeStdDevLines(bars, { centerLineType: 'ema', period: PERIOD });
  check('EMA centerLine length matches', emaResult.centerLine.length === bars.length);
  check('EMA stdDev length matches', emaResult.stdDev.length === bars.length);
  check(`EMA centerLine[${PERIOD - 1}] is finite`,
    bars.length > PERIOD - 1 && Number.isFinite(emaResult.centerLine[PERIOD - 1]));
  check(`EMA stdDev[${PERIOD - 1}] is finite`,
    bars.length > PERIOD - 1 && Number.isFinite(emaResult.stdDev[PERIOD - 1]));
  check('EMA centerLine at last bar is finite',
    Number.isFinite(emaResult.centerLine[lastIdx]));
  check('EMA stdDev at last bar is finite',
    Number.isFinite(emaResult.stdDev[lastIdx]));

  // EMA and SMA should produce different center lines. With a long series
  // they may converge very close, so we check they're not exactly equal
  // (which would indicate EMA is accidentally using SMA calculation).
  const smaLast = result.centerLine[lastIdx];
  const emaLast = emaResult.centerLine[lastIdx];
  check('EMA and SMA center lines are not identical', smaLast !== emaLast);

  // EMA band formula verification
  for (const idx of sampleIndices) {
    const c = emaResult.centerLine[idx];
    const sd = emaResult.stdDev[idx];
    for (const band of emaResult.regularBands) {
      const expectedUpper = c + band.level * sd;
      const expectedLower = c - band.level * sd;
      check(`EMA bar ${idx} regular ${band.level} upper = center + level×stdDev`,
        approxEqual(band.upper[idx], expectedUpper, 1e-6));
      check(`EMA bar ${idx} regular ${band.level} lower = center - level×stdDev`,
        approxEqual(band.lower[idx], expectedLower, 1e-6));
    }
  }

  // EMA band symmetry (regular + fib)
  for (const idx of sampleIndices) {
    const c = emaResult.centerLine[idx];
    for (const band of [...emaResult.regularBands, ...emaResult.fibBands]) {
      const upperDist = band.upper[idx] - c;
      const lowerDist = c - band.lower[idx];
      check(`EMA bar ${idx} ${band.level} symmetric`,
        Math.abs(upperDist - lowerDist) < 1e-10);
    }
  }

  // EMA band ordering (regular + fib, upper + lower)
  for (let i = 1; i < emaResult.regularBands.length; i++) {
    const prev = emaResult.regularBands[i - 1];
    const curr = emaResult.regularBands[i];
    check(`EMA regular ${curr.level} upper > ${prev.level} upper`,
      curr.upper[lastIdx] > prev.upper[lastIdx]);
    check(`EMA regular ${curr.level} lower < ${prev.level} lower`,
      curr.lower[lastIdx] < prev.lower[lastIdx]);
  }
  for (let i = 1; i < emaResult.fibBands.length; i++) {
    const prev = emaResult.fibBands[i - 1];
    const curr = emaResult.fibBands[i];
    check(`EMA fib ${curr.level} upper > ${prev.level} upper`,
      curr.upper[lastIdx] > prev.upper[lastIdx]);
    check(`EMA fib ${curr.level} lower < ${prev.level} lower`,
      curr.lower[lastIdx] < prev.lower[lastIdx]);
  }

  // ── Summary ──
  console.log(`\n=== ${passed}/${checks} checks passed ===`);
  if (passed !== checks) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Verification failed:', error);
  process.exit(1);
});
