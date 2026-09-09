/**
 * Verification script for Task #258 — Script runner for open-close strategy comparison.
 *
 * Verifies the full pipeline by running the actual script runner against real
 * Firestore data, then validating the JSON output and console behavior.
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/verify/strat-lib-258-comparison.ts
 *
 * Requires Application Default Credentials with access to the rel-str
 * Firestore symbol-data collection.
 */

import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { loadAllDailyBars } from '../../src/st-cloud-function/backtest/backtest-data-loader';
import { computeOpenCloseReturns } from '../../src/st-cloud-function/backtest/open-close-returns';

const SCRIPT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER_PATH = join(SCRIPT_DIR, 'open-close-strategy-comparison.ts');
const OUTPUT_PATH = join(SCRIPT_DIR, 'output', 'open-close-comparison.json');

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

async function main(): Promise<void> {
  console.log('=== Task #258 Verification: Script Runner Pipeline ===\n');

  // ── Part 1: Run the actual script runner ──
  console.log('Part 1: Run the script runner (--symbol SPY)');
  try {
    execFileSync('npx', ['tsx', RUNNER_PATH, '--symbol', 'SPY'], {
      stdio: 'pipe',
      shell: true,
      cwd: join(SCRIPT_DIR, '..'),
    });
    check('script runner exits successfully', true);
  } catch (error) {
    check('script runner exits successfully', false);
    console.error('  Runner failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  // ── Part 2: Validate JSON output file exists ──
  console.log('\nPart 2: Validate JSON output file');
  check('JSON output file exists', existsSync(OUTPUT_PATH));

  const raw = readFileSync(OUTPUT_PATH, 'utf8');
  const output = JSON.parse(raw);
  check('JSON is valid', typeof output === 'object' && output !== null);
  check('JSON has generatedAt', typeof output.generatedAt === 'string');
  check('JSON has fixedAmount', output.fixedAmount === 100_000);
  check('JSON has initialEquity', output.initialEquity === 100_000);
  check('JSON has symbols array', Array.isArray(output.symbols));
  check('JSON has 1 symbol (SPY only)', output.symbols.length === 1);
  check('JSON symbol is SPY', output.symbols[0].symbol === 'SPY');

  // ── Part 3: Validate result structure ──
  console.log('\nPart 3: Validate result structure');
  const r = output.symbols[0];
  check('has dateRange', typeof r.dateRange?.first === 'string' && typeof r.dateRange?.last === 'string');
  check('has barCount', typeof r.barCount === 'number' && r.barCount > 0);
  check('has skippedCount', typeof r.skippedCount === 'number');
  check('has dailyRecords array', Array.isArray(r.dailyRecords) && r.dailyRecords.length > 0);
  check('has intradayMetrics', typeof r.intradayMetrics === 'object');
  check('has overnightMetrics', typeof r.overnightMetrics === 'object');
  check('has intradayFixedTotalPnl', typeof r.intradayFixedTotalPnl === 'number');
  check('has overnightFixedTotalPnl', typeof r.overnightFixedTotalPnl === 'number');
  check('has intradayCompoundedFinalEquity', typeof r.intradayCompoundedFinalEquity === 'number');
  check('has overnightCompoundedFinalEquity', typeof r.overnightCompoundedFinalEquity === 'number');

  // ── Part 4: Validate daily records ──
  console.log('\nPart 4: Validate daily records');
  const firstRecord = r.dailyRecords[0];
  check('first record has date', typeof firstRecord.date === 'string');
  check('first record has open', typeof firstRecord.open === 'number' || firstRecord.open === null);
  check('first record has close', typeof firstRecord.close === 'number' || firstRecord.close === null);
  check('first record has intradayReturn', 'intradayReturn' in firstRecord);
  check('first record has overnightReturn', 'overnightReturn' in firstRecord);
  check('first record skipped (no prior close)', firstRecord.skipped === true);
  check('first record has skipReason', typeof firstRecord.skipReason === 'string');

  // Find a non-skipped record (should be the second one if data is clean).
  const nonSkipped = r.dailyRecords.find((rec: { skipped: boolean }) => !rec.skipped);
  check('has at least one non-skipped record', nonSkipped !== undefined);
  if (nonSkipped) {
    check('non-skipped record has intradayReturn (number)', typeof nonSkipped.intradayReturn === 'number');
    check('non-skipped record has overnightReturn (number)', typeof nonSkipped.overnightReturn === 'number');
  }

  // ── Part 5: Validate metrics coherence ──
  console.log('\nPart 5: Validate metrics coherence');
  const intradayNetProfit = r.intradayMetrics.totalNetProfit;
  const overnightNetProfit = r.overnightMetrics.totalNetProfit;
  const initialEquity = output.initialEquity;
  const intradayEquityChange = r.intradayCompoundedFinalEquity - initialEquity;
  const overnightEquityChange = r.overnightCompoundedFinalEquity - initialEquity;
  check(
    'intraday totalNetProfit ≈ compounded equity change',
    Math.abs(intradayNetProfit - intradayEquityChange) < 1,
  );
  check(
    'overnight totalNetProfit ≈ compounded equity change',
    Math.abs(overnightNetProfit - overnightEquityChange) < 1,
  );

  // Derive expected counts from the data rather than hard-coding.
  const skippedCount = r.dailyRecords.filter((rec: { skipped: boolean }) => rec.skipped).length;
  check('skippedCount matches dailyRecords count', r.skippedCount === skippedCount);
  check('intraday tradeCount = non-skipped records with intradayReturn', r.intradayMetrics.tradeCount === r.dailyRecords.filter((rec: { intradayReturn: number | null }) => rec.intradayReturn !== null).length);
  check('overnight tradeCount = records with overnightReturn', r.overnightMetrics.tradeCount === r.dailyRecords.filter((rec: { overnightReturn: number | null }) => rec.overnightReturn !== null).length);

  // ── Part 6: P&L ratio sanity check ──
  console.log('\nPart 6: P&L ratio sanity check');
  const ratio = intradayNetProfit !== 0 ? overnightNetProfit / intradayNetProfit : NaN;
  check('P&L ratio is finite', Number.isFinite(ratio));
  check('P&L ratio > 0 (same sign)', ratio > 0);
  console.log(`  P&L ratio (overnight/intraday): ${ratio.toFixed(2)}x`);

  // ── Part 7: Cross-check with independent computation ──
  console.log('\nPart 7: Cross-check with independent computation');
  const bars = await loadAllDailyBars('SPY');
  const independentResult = computeOpenCloseReturns(bars, 100_000, 100_000, 'SPY');
  check('barCount matches', r.barCount === independentResult.barCount);
  check('skippedCount matches', r.skippedCount === independentResult.skippedCount);
  check('intraday totalNetProfit matches', Math.abs(r.intradayMetrics.totalNetProfit - independentResult.intradayMetrics.totalNetProfit) < 0.01);
  check('overnight totalNetProfit matches', Math.abs(r.overnightMetrics.totalNetProfit - independentResult.overnightMetrics.totalNetProfit) < 0.01);
  check('intradayCompoundedFinalEquity matches', Math.abs(r.intradayCompoundedFinalEquity - independentResult.intradayCompoundedFinalEquity) < 0.01);
  check('overnightCompoundedFinalEquity matches', Math.abs(r.overnightCompoundedFinalEquity - independentResult.overnightCompoundedFinalEquity) < 0.01);

  // Cleanup: remove the output file so verification doesn't leave artifacts.
  rmSync(OUTPUT_PATH, { force: true });

  console.log(`\n=== ${passed}/${checks} checks passed ===`);
  if (passed !== checks) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Verification failed:', error);
  process.exit(1);
});
