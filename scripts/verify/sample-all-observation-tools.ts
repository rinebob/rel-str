/**
 * Exercise every safe observation tool in the Robinhood MCP toolbox
 * and capture the full response (including the guide text) to a JSON file.
 *
 * This does NOT call any mutation tools (place_order, cancel_order, etc.)
 * or financial mutation tools. Simulation tools (review_equity_order,
 * review_option_order) are included since they don't place real orders.
 *
 * Usage:
 *   npx tsx scripts/verify/sample-all-observation-tools.ts [accountNumber]
 *
 * If accountNumber is omitted, the first account from get_accounts is used.
 *
 * Output:
 *   scripts/verify/samples/rh-observation-tools-samples.json
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'samples');
const OUTPUT_FILE = join(OUTPUT_DIR, 'rh-observation-tools-samples.json');

const API_BASE = 'http://127.0.0.1:3456/api/rh/tools';

interface SampleResult {
  tool: string;
  args: Record<string, unknown>;
  success: boolean;
  response?: unknown;
  error?: string;
  timestamp: string;
  durationMs: number;
}

async function callTool(toolName: string, args: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}/${toolName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args }),
    });
    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${text.slice(0, 500)}` };
    }
    const data = await response.json();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  let accountNumber = process.argv[2];

  // Symbols we know exist in this account from prior data
  const symbols = ['SCHB', 'KMEM', 'QQQM', 'AAPL', 'SNDK', 'BTSG'];
  const sampleSymbol = 'AAPL';

  // If no account number, get one from get_accounts
  if (!accountNumber) {
    console.log('No account number provided. Fetching from get_accounts...');
    const result = await callTool('get_accounts', {});
    if (result.success && result.data) {
      const data = result.data as any;
      const parsed = data?.parsed ?? data;
      const accounts = parsed?.data?.accounts ?? parsed?.accounts ?? [];
      if (Array.isArray(accounts) && accounts.length > 0) {
        accountNumber = accounts[0].account_number ?? accounts[0].id;
        console.log(`Using account: ${accountNumber}`);
      }
    }
    if (!accountNumber) {
      console.error('Could not determine account number. Pass it as an argument.');
      console.error('Usage: npx tsx scripts/verify/sample-all-observation-tools.ts <accountNumber>');
      process.exit(1);
    }
  }

  // Define all safe observation tool calls
  const toolCalls: Array<[string, Record<string, unknown>, string]> = [
    // Account & Performance
    ['get_accounts', {}, 'All accounts'],
    ['get_portfolio', { account_number: accountNumber }, 'Portfolio summary'],
    ['get_equity_positions', { account_number: accountNumber }, 'Equity positions'],
    ['get_equity_orders', { account_number: accountNumber }, 'Equity order history'],
    ['get_equity_tax_lots', { account_number: accountNumber, symbol: sampleSymbol }, 'Tax lots for AAPL'],
    ['get_pnl_trade_history', { account_number: accountNumber }, 'PnL trade history'],
    ['get_realized_pnl', { account_number: accountNumber }, 'Realized PnL'],

    // Market Data & Research
    ['search', { query: 'AAPL', limit: 5 }, 'Search for AAPL'],
    ['get_equity_quotes', { symbols: ['SCHB', 'KMEM', 'QQQM'] }, 'Quotes for SCHB,KMEM,QQQM'],
    ['get_equity_fundamentals', { symbols: [sampleSymbol] }, 'Fundamentals for AAPL'],
    ['get_equity_historicals', { symbols: [sampleSymbol], start_time: '2026-08-01T00:00:00Z', interval: 'day' }, 'Historicals for AAPL'],
    ['get_equity_price_book', { symbols: [sampleSymbol] }, 'Price book for AAPL'],
    ['get_financials', { symbols: [sampleSymbol], period: 'quarter', limit: 4 }, 'Financials for AAPL'],
    ['get_earnings_calendar', { days: 30 }, 'Earnings calendar 30 days'],
    ['get_earnings_results', { symbol: sampleSymbol }, 'Earnings results for AAPL'],
    ['get_equity_technical_indicators', { symbol: sampleSymbol, type: 'rsi', interval: 'day', start_time: '2026-08-01T00:00:00Z', period: 14 }, 'RSI for AAPL'],
    ['get_equity_tradability', { account_number: accountNumber, symbols: ['SCHB', 'KMEM', 'QQQM'] }, 'Tradability for SCHB,KMEM,QQQM'],
    ['get_indexes', {}, 'All indexes'],

    // Options
    ['get_option_chains', { underlying_symbol: sampleSymbol }, 'Option chains for AAPL'],
    ['get_option_instruments', { chain_symbol: sampleSymbol }, 'Option instruments for AAPL'],
    ['get_option_positions', { account_number: accountNumber, nonzero: true }, 'Nonzero option positions'],
    ['get_option_level_upgrade_info', { account_number: accountNumber }, 'Option level upgrade info'],
    ['get_option_watchlist', {}, 'Option watchlist'],
    ['get_option_orders', { account_number: accountNumber }, 'Option order history'],

    // Scanners
    ['get_scanner_filter_specs', {}, 'Scanner filter specs'],
    ['get_scans', {}, 'All scans'],

    // Watchlists
    ['get_watchlists', {}, 'All watchlists'],
    ['get_popular_watchlists', {}, 'Popular watchlists'],

    // Simulation (safe — doesn't place real orders)
    ['review_equity_order', {
      account_number: accountNumber,
      symbol: sampleSymbol,
      side: 'buy',
      type: 'market',
      quantity: '1',
      time_in_force: 'gfd',
    }, 'Review equity order (simulation)'],
  ];

  console.log(`\nExercising ${toolCalls.length} observation tools...\n`);

  const results: SampleResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const [toolName, args, description] of toolCalls) {
    process.stdout.write(`  ${toolName}... `);
    const timestamp = new Date().toISOString();
    const start = Date.now();
    try {
      const result = await callTool(toolName, args);
      const durationMs = Date.now() - start;
      if (result.success) {
        succeeded++;
        results.push({
          tool: toolName,
          args,
          success: true,
          response: result.data,
          timestamp,
          durationMs,
        });
        console.log(`OK (${durationMs}ms) — ${description}`);
      } else {
        failed++;
        results.push({
          tool: toolName,
          args,
          success: false,
          error: result.error,
          timestamp,
          durationMs,
        });
        console.log(`FAIL (${durationMs}ms): ${result.error?.slice(0, 100)}`);
      }
    } catch (err) {
      const durationMs = Date.now() - start;
      failed++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({
        tool: toolName,
        args,
        success: false,
        error: errorMsg,
        timestamp,
        durationMs,
      });
      console.log(`ERROR (${durationMs}ms): ${errorMsg.slice(0, 100)}`);
    }
  }

  // Write results
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  console.log(`\n=== Summary: ${succeeded} succeeded, ${failed} failed ===`);
  console.log(`Results written to: ${OUTPUT_FILE}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Sampling failed:', err);
  process.exit(1);
});
