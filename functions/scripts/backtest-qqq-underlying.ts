/**
 * Local test runner for the leap-drop strategy.
 *
 * Defaults to buying the underlying (QQQ shares). Pass --options to backtest
 * the LEAP option leg instead. All numeric flags can be overridden via CLI.
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/backtest-qqq-underlying.ts [flags]
 *
 * Flags:
 *   --symbol <ticker>              Symbol to backtest (default: QQQ)
 *   --initial-cash <n>             Starting cash (default: 100000)
 *   --options                      Trade options instead of underlying shares
 *   --drop-pct <n>                 Drop % required to trigger entry (default: 0.01)
 *   --stop-loss-pct <n>            Stop-loss %, 0 disables (default: 0.0)
 *   --trailing-stop-pct <n>        Trailing stop %, 0 disables (default: 0.0)
 *   --target-gain-pct <n>          Target gain % (default: 0.2, 1.0 in options mode)
 *   --max-hold-days <n>            Max hold days, 0 disables (default: 0)
 *   --max-concurrent-positions <n> Max open positions, 0 disables (default: 0)
 *   --position-size <n>            $ size per underlying position (default: 1000)
 *   --help                         Show this help
 *
 * Requires Application Default Credentials with access to the rel-str Firestore
 * symbol-data collection.
 */

import { StrategyConfig } from '../src/rh-agent-cloud-function/strategies/base-strategy';

import { runBacktestSimulation } from '../src/rh-agent-cloud-function/backtest/backtest-simulator';
import { loadAllBars, OptionsChainCache } from '../src/rh-agent-cloud-function/backtest/backtest-data-loader';
import { adapter as leapDrop } from '../src/rh-agent-cloud-function/strategies/leap-drop/leap-drop.strategy';

function parseNumberFlag(name: string, defaultValue: number, min = Number.NEGATIVE_INFINITY): number {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    const n = Number(process.argv[idx + 1]);
    if (Number.isNaN(n)) return defaultValue;
    return Math.max(min, n);
  }
  return defaultValue;
}

function parseStringFlag(name: string, defaultValue: string): string {
  const idx = process.argv.indexOf(name);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : defaultValue;
}

function showHelp(): void {
  console.log(`
Usage: npx tsx scripts/backtest-qqq-underlying.ts [flags]

Flags:
  --symbol <ticker>              Symbol to backtest (default: QQQ)
  --initial-cash <n>             Starting cash (default: 100000)
  --options                      Trade options instead of underlying shares
  --drop-pct <n>                 Drop % required to trigger entry (default: 0.01)
  --stop-loss-pct <n>            Stop-loss %, 0 disables (default: 0.0)
  --trailing-stop-pct <n>        Trailing stop %, 0 disables (default: 0.0)
  --target-gain-pct <n>          Target gain % (default: 0.2, 1.0 in options mode)
  --max-hold-days <n>            Max hold days, 0 disables (default: 0)
  --max-concurrent-positions <n> Max open positions, 0 disables (default: 0)
  --position-size <n>            $ size per underlying position (default: 1000)
  --help                         Show this help
`);
}

if (process.argv.includes('--help')) {
  showHelp();
  process.exit(0);
}

const symbol = parseStringFlag('--symbol', 'QQQ');
const useUnderlying = !process.argv.includes('--options');

const initialCash = parseNumberFlag('--initial-cash', 100_000, 0);

const config: StrategyConfig = {
  useUnderlying,
  dropPct: parseNumberFlag('--drop-pct', 0.01, 1e-6),
  stopLossPct: parseNumberFlag('--stop-loss-pct', 0.0, 0),
  trailingStopPct: parseNumberFlag('--trailing-stop-pct', 0.0, 0),
  targetGainPct: parseNumberFlag('--target-gain-pct', useUnderlying ? 0.2 : 1.0, 0),
  maxHoldDays: parseNumberFlag('--max-hold-days', 0, 0),
  maxConcurrentPositions: parseNumberFlag('--max-concurrent-positions', 0, 0),
  positionSize: parseNumberFlag('--position-size', 1000, 1),
};

async function main() {
  const { dailyBars, weeklyBars, monthlyBars } = await loadAllBars(symbol);
  if (dailyBars.length === 0) {
    console.error('No daily bars found for', symbol);
    process.exit(1);
  }
  console.log(
    'Loaded bars:',
    dailyBars.length,
    '| first',
    dailyBars[0]?.date,
    '| last',
    dailyBars[dailyBars.length - 1]?.date,
  );
  console.log('Config:', JSON.stringify(config));

  const optionsCache = new OptionsChainCache(symbol);

  const result = await runBacktestSimulation(
    symbol,
    leapDrop,
    config,
    dailyBars,
    optionsCache,
    initialCash,
    weeklyBars,
    monthlyBars,
  );

  console.log('\n--- METRICS ---');
  console.log(JSON.stringify(result.metrics, null, 2));

  console.log('\n--- TRADES ---');
  for (const t of result.trades) {
    console.log(
      `${t.entryDate} -> ${t.exitDate} | ${t.side} ${t.quantity} ${t.symbol} | ` +
      `entry ${t.entryUnderlying.toFixed(2)} exit ${t.exitUnderlying.toFixed(2)} | ` +
      `pnl ${t.pnl.toFixed(2)} return ${(t.returnPct * 100).toFixed(2)}% | ${t.exitReason}`,
    );
  }

  console.log(
    `\nFinal equity: ${result.finalEquity.toFixed(2)} | ` +
    `Final cash: ${result.finalCash.toFixed(2)} | ` +
    `Trade count: ${result.trades.length}`,
  );

  if (result.notes.length > 0) {
    console.log('\n--- NOTES ---');
    for (const n of result.notes) console.log(n);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
