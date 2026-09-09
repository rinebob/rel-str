/**
 * Verification script for the open-close-returns computation module.
 *
 * Exercises the module with realistic OHLCV bars (matching the normalized shape
 * from loadAllDailyBars) and confirms the output structure, return calculations,
 * P&L, equity, and metrics are correct.
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/verify/strat-lib-257-compute.ts
 *
 * Expected output: all checks pass, summary printed. No external dependencies
 * (no Firestore, no ADC required) — this is a pure computation verification.
 */

import assert from 'node:assert/strict';
import { computeOpenCloseReturns, computeDailyReturnMetrics } from '../../src/st-cloud-function/backtest/open-close-returns';
import type { OHLCV } from '../../src/st-cloud-function/strategies/base-strategy';

// Realistic bars matching the normalized OHLCV shape from loadAllDailyBars.
const bars: OHLCV[] = [
  { date: '2020-01-02', open: 320.0, high: 322.5, low: 319.5, close: 321.5, volume: 100_000_000 },
  { date: '2020-01-03', open: 322.0, high: 325.0, low: 321.0, close: 324.0, volume: 95_000_000 },
  { date: '2020-01-06', open: 323.5, high: 326.0, low: 322.0, close: 325.5, volume: 110_000_000 },
  { date: '2020-01-07', open: 325.0, high: 327.0, low: 323.0, close: 323.5, volume: 85_000_000 },
  { date: '2020-01-08', open: 324.0, high: 328.0, low: 323.5, close: 327.5, volume: 120_000_000 },
];

const FIXED_AMOUNT = 100_000;
const INITIAL_EQUITY = 100_000;

console.log('=== Open-Close Returns Verification ===\n');
console.log(`Bars: ${bars.length} | Fixed amount: $${FIXED_AMOUNT} | Initial equity: $${INITIAL_EQUITY}\n`);

// ─── Check 1: computeOpenCloseReturns produces correct structure ────────────

const result = computeOpenCloseReturns(bars, FIXED_AMOUNT, INITIAL_EQUITY, 'SPY');

assert.strictEqual(result.symbol, 'SPY', 'Symbol should match');
assert.strictEqual(result.barCount, bars.length, 'Bar count should match');
assert.strictEqual(result.dateRange.first, '2020-01-02', 'First date should match');
assert.strictEqual(result.dateRange.last, '2020-01-08', 'Last date should match');
assert.strictEqual(result.dailyRecords.length, bars.length, 'Should have one record per bar');
assert.strictEqual(result.skippedCount, 1, 'First day should be skipped (no prior close for overnight)');

console.log('✔ Structure: symbol, barCount, dateRange, dailyRecords, skippedCount all correct');

// ─── Check 2: intraday returns are correct ─────────────────────────────────

const day2 = result.dailyRecords[1];
const expectedIntradayReturn = (324.0 - 322.0) / 322.0;
assert.ok(
  Math.abs(day2.intradayReturn! - expectedIntradayReturn) < 1e-10,
  `Intraday return for day 2 should be ${expectedIntradayReturn}`,
);

console.log(`✔ Intraday return day 2: ${day2.intradayReturn!.toFixed(6)} (expected ${expectedIntradayReturn.toFixed(6)})`);

// ─── Check 3: overnight returns are correct ────────────────────────────────

const expectedOvernightReturn = (322.0 - 321.5) / 321.5;
assert.ok(
  Math.abs(day2.overnightReturn! - expectedOvernightReturn) < 1e-10,
  `Overnight return for day 2 should be ${expectedOvernightReturn}`,
);

console.log(`✔ Overnight return day 2: ${day2.overnightReturn!.toFixed(6)} (expected ${expectedOvernightReturn.toFixed(6)})`);

// ─── Check 4: first day has no overnight return ─────────────────────────────

const day1 = result.dailyRecords[0];
assert.strictEqual(day1.overnightReturn, null, 'First day overnight return should be null');
assert.strictEqual(day1.skipped, true, 'First day should be marked skipped');
assert.ok(day1.skipReason?.includes('no prior close'), 'Skip reason should mention no prior close');

console.log('✔ First day: no overnight return, skipped with reason');

// ─── Check 5: fixed-amount P&L is correct ──────────────────────────────────

const expectedFixedPnl = FIXED_AMOUNT * expectedIntradayReturn;
assert.ok(
  Math.abs(day2.intradayFixedPnl! - expectedFixedPnl) < 1e-6,
  `Fixed P&L for day 2 should be ${expectedFixedPnl}`,
);

console.log(`✔ Fixed P&L day 2: $${day2.intradayFixedPnl!.toFixed(2)} (expected $${expectedFixedPnl.toFixed(2)})`);

// ─── Check 6: compounded equity is correct ─────────────────────────────────

// Day 1 intraday: (321.5 - 320) / 320 = 0.0046875
// Equity after day 1: 100000 * 1.0046875 = 100468.75
const expectedEquityDay1 = INITIAL_EQUITY * (1 + (321.5 - 320.0) / 320.0);
assert.ok(
  Math.abs(result.dailyRecords[0].intradayCompoundedEquity! - expectedEquityDay1) < 1e-6,
  `Compounded equity after day 1 should be ${expectedEquityDay1}`,
);

console.log(`✔ Compounded equity day 1: $${result.dailyRecords[0].intradayCompoundedEquity!.toFixed(2)} (expected $${expectedEquityDay1.toFixed(2)})`);

// ─── Check 7: metrics are populated ────────────────────────────────────────

assert.ok(result.intradayMetrics.tradeCount > 0, 'Intraday metrics should have trades');
assert.ok(result.overnightMetrics.tradeCount > 0, 'Overnight metrics should have trades');
assert.ok(Number.isFinite(result.intradayMetrics.sharpeRatio), 'Intraday Sharpe should be finite');
assert.ok(Number.isFinite(result.overnightMetrics.sharpeRatio), 'Overnight Sharpe should be finite');
assert.ok(result.intradayMetrics.maxDrawdown >= 0, 'Intraday max drawdown should be non-negative');
assert.ok(result.overnightMetrics.maxDrawdown >= 0, 'Overnight max drawdown should be non-negative');

console.log(`✔ Metrics: intraday trades=${result.intradayMetrics.tradeCount}, overnight trades=${result.overnightMetrics.tradeCount}`);
console.log(`  Intraday: netPnl=$${result.intradayMetrics.totalNetProfit.toFixed(2)}, Sharpe=${result.intradayMetrics.sharpeRatio.toFixed(4)}, maxDD=$${result.intradayMetrics.maxDrawdown.toFixed(2)}`);
console.log(`  Overnight: netPnl=$${result.overnightMetrics.totalNetProfit.toFixed(2)}, Sharpe=${result.overnightMetrics.sharpeRatio.toFixed(4)}, maxDD=$${result.overnightMetrics.maxDrawdown.toFixed(2)}`);

// ─── Check 8: totals are correct ───────────────────────────────────────────

// Metrics totalNetProfit describes the compounded pass, so it should equal
// the compounded final equity minus initial equity.
assert.ok(
  Math.abs(result.intradayMetrics.totalNetProfit - (result.intradayCompoundedFinalEquity - 100_000)) < 1e-6,
  'Intraday metrics totalNetProfit should match compounded equity change',
);
assert.ok(
  Math.abs(result.overnightMetrics.totalNetProfit - (result.overnightCompoundedFinalEquity - 100_000)) < 1e-6,
  'Overnight metrics totalNetProfit should match compounded equity change',
);

console.log(`✔ Totals: intraday fixed P&L=$${result.intradayFixedTotalPnl.toFixed(2)}, compounded final=$${result.intradayCompoundedFinalEquity.toFixed(2)}`);
console.log(`  Overnight fixed P&L=$${result.overnightFixedTotalPnl.toFixed(2)}, compounded final=$${result.overnightCompoundedFinalEquity.toFixed(2)}`);

// ─── Check 9: computeDailyReturnMetrics standalone ─────────────────────────

const standaloneMetrics = computeDailyReturnMetrics(
  [1000, -500, 2000, -300],
  [
    { date: '2020-01-00', equity: 100_000 },  // initial seed
    { date: '2020-01-01', equity: 101_000 },
    { date: '2020-01-02', equity: 100_500 },
    { date: '2020-01-03', equity: 102_500 },
    { date: '2020-01-04', equity: 102_200 },
  ],
  100_000,
);

assert.strictEqual(standaloneMetrics.tradeCount, 4, 'Standalone metrics trade count');
assert.strictEqual(standaloneMetrics.winCount, 2, 'Standalone metrics win count');
assert.strictEqual(standaloneMetrics.lossCount, 2, 'Standalone metrics loss count');
assert.strictEqual(standaloneMetrics.grossProfit, 3000, 'Standalone metrics gross profit');
assert.strictEqual(standaloneMetrics.grossLoss, 800, 'Standalone metrics gross loss');

console.log(`✔ Standalone metrics: trades=${standaloneMetrics.tradeCount}, profit factor=${standaloneMetrics.profitFactor.toFixed(4)}`);

// ─── Summary ───────────────────────────────────────────────────────────────

console.log('\n=== All verification checks passed ===');
console.log(`\nPer-day records:`);
for (const r of result.dailyRecords) {
  const skip = r.skipped ? ` [SKIPPED: ${r.skipReason}]` : '';
  console.log(
    `  ${r.date} | intraday: ${r.intradayReturn?.toFixed(6) ?? 'N/A'} | overnight: ${r.overnightReturn?.toFixed(6) ?? 'N/A'}${skip}`,
  );
}
