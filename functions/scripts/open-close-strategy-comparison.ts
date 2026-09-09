/**
 * Open-Close Strategy Comparison Runner
 *
 * Loads SPY and QQQ daily bars from Firestore, runs the open-close return
 * computation module for each symbol, writes JSON output, and prints a
 * console summary table comparing Strat 1 (intraday) vs Strat 2 (overnight)
 * with the P&L ratio.
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/open-close-strategy-comparison.ts [flags]
 *
 * Flags:
 *   --symbol <ticker>   Override default symbols with a single symbol
 *   --help              Show this help
 *
 * Requires Application Default Credentials with access to the rel-str
 * Firestore symbol-data collection.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAllDailyBars } from '../src/st-cloud-function/backtest/backtest-data-loader';
import { computeOpenCloseReturns, type OpenCloseSymbolResult } from '../src/st-cloud-function/backtest/open-close-returns';

const DEFAULT_SYMBOLS = ['SPY', 'QQQ'];
const FIXED_AMOUNT = 100_000;
const INITIAL_EQUITY = 100_000;

const OUTPUT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'output', 'open-close-comparison.json');

function parseStringFlag(name: string, defaultValue: string): string {
  const idx = process.argv.indexOf(name);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : defaultValue;
}

function showHelp(): void {
  console.log(`
Usage: npx tsx scripts/open-close-strategy-comparison.ts [flags]

Flags:
  --symbol <ticker>   Override default symbols (SPY, QQQ) with a single symbol
  --help              Show this help

Default parameters:
  fixedAmount    = ${FIXED_AMOUNT}
  initialEquity  = ${INITIAL_EQUITY}
  output         = ${OUTPUT_PATH}
`);
}

if (process.argv.includes('--help')) {
  showHelp();
  process.exit(0);
}

const symbols = process.argv.includes('--symbol')
  ? [parseStringFlag('--symbol', 'SPY').toUpperCase()]
  : DEFAULT_SYMBOLS;

async function main(): Promise<void> {
  const results: OpenCloseSymbolResult[] = [];

  for (const symbol of symbols) {
    console.log(`\n=== ${symbol} ===`);

    try {
      const bars = await loadAllDailyBars(symbol);
      if (bars.length === 0) {
        console.error(`No daily bars found for ${symbol}`);
        continue;
      }

      console.log(
        `Loaded ${bars.length} bars | first ${bars[0]?.date} | last ${bars[bars.length - 1]?.date}`,
      );

      const result = computeOpenCloseReturns(bars, FIXED_AMOUNT, INITIAL_EQUITY, symbol);
      results.push(result);

      console.log(`Skipped days: ${result.skippedCount}`);

      // Collect skip reasons summary.
      const reasonCounts = new Map<string, number>();
      for (const rec of result.dailyRecords) {
        if (rec.skipReason) {
          reasonCounts.set(rec.skipReason, (reasonCounts.get(rec.skipReason) ?? 0) + 1);
        }
      }
      if (reasonCounts.size > 0) {
        console.log('Skip reasons:');
        for (const [reason, count] of reasonCounts) {
          console.log(`  ${reason}: ${count}`);
        }
      }
    } catch (error) {
      console.error(`Failed to process ${symbol}:`, error instanceof Error ? error.message : error);
    }
  }

  if (results.length === 0) {
    console.error('\nNo results — no symbols had data. Exiting.');
    process.exit(1);
  }

  // Write JSON output with run metadata.
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const output = {
    generatedAt: new Date().toISOString(),
    fixedAmount: FIXED_AMOUNT,
    initialEquity: INITIAL_EQUITY,
    symbols: results,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`\nJSON output written to ${OUTPUT_PATH}`);

  // Print summary table.
  console.log('\n=== SUMMARY ===');
  console.log(
    'Symbol  | Strategy  | Total Net P&L  | Profit Factor | Max DD       | Sharpe   | Calmar   | Win%   | Trades',
  );
  console.log('-'.repeat(105));

  for (const r of results) {
    printRow(r.symbol, 'Intraday  ', r.intradayMetrics);
    printRow(r.symbol, 'Overnight ', r.overnightMetrics);
  }

  // Print P&L ratios.
  console.log('\n=== P&L RATIO (Overnight / Intraday) ===');
  for (const r of results) {
    const intradayPnl = r.intradayMetrics.totalNetProfit;
    const overnightPnl = r.overnightMetrics.totalNetProfit;
    const ratio = intradayPnl !== 0 ? overnightPnl / intradayPnl : NaN;
    console.log(
      `${r.symbol}  | Intraday P&L: ${formatMoney(intradayPnl)} | ` +
      `Overnight P&L: ${formatMoney(overnightPnl)} | ` +
      `Ratio: ${Number.isFinite(ratio) ? ratio.toFixed(2) + 'x' : 'N/A'}`,
    );
  }

  // Print fixed-amount totals.
  console.log('\n=== FIXED-AMOUNT TOTALS ===');
  for (const r of results) {
    console.log(
      `${r.symbol}  | Intraday: ${formatMoney(r.intradayFixedTotalPnl)} | ` +
      `Overnight: ${formatMoney(r.overnightFixedTotalPnl)}`,
    );
  }

  // Print compounded final equity.
  console.log('\n=== COMPOUNDED FINAL EQUITY ===');
  for (const r of results) {
    console.log(
      `${r.symbol}  | Intraday: ${formatMoney(r.intradayCompoundedFinalEquity)} | ` +
      `Overnight: ${formatMoney(r.overnightCompoundedFinalEquity)}`,
    );
  }
}

function printRow(symbol: string, strategy: string, m: OpenCloseSymbolResult['intradayMetrics']): void {
  console.log(
    `${symbol.padEnd(7)} | ${strategy} | ` +
    `${formatMoney(m.totalNetProfit).padStart(14)} | ` +
    `${m.profitFactor.toFixed(2).padStart(13)} | ` +
    `${formatMoney(m.maxDrawdown).padStart(12)} | ` +
    `${m.sharpeRatio.toFixed(2).padStart(8)} | ` +
    `${m.calmarRatio.toFixed(2).padStart(8)} | ` +
    `${m.percentProfitable.toFixed(1).padStart(5)}% | ` +
    `${m.tradeCount}`,
  );
}

function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

main().catch((error) => {
  console.error('Open-close comparison failed:', error);
  process.exit(1);
});
