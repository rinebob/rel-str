/**
 * Exercise the mutation tools (place_equity_order, cancel_equity_order)
 * and capture full responses including the guide text.
 *
 * Places small test orders on DRAM (memory ETF) using fractional/dollar-based
 * amounts. Outside market hours, fractional market orders will queue.
 * Limit and stop orders with prices far from current will rest as confirmed.
 * All orders are cancelled after the response is captured.
 *
 * Usage:
 *   npx tsx scripts/verify/sample-mutation-tools.ts <accountNumber>
 *
 * Output:
 *   scripts/verify/samples/rh-mutation-tools-samples.json
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'samples');
const OUTPUT_FILE = join(OUTPUT_DIR, 'rh-mutation-tools-samples.json');

const API_BASE = 'http://127.0.0.1:3456/api/rh/tools';

interface SampleResult {
  tool: string;
  args: Record<string, unknown>;
  success: boolean;
  response?: unknown;
  error?: string;
  timestamp: string;
  durationMs: number;
  orderId?: string;
}

async function callTool(toolName: string, args: Record<string, unknown>): Promise<{ success: boolean; data?: any; error?: string }> {
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

function extractOrderId(response: any): string | undefined {
  const parsed = response?.parsed ?? response;
  const order = parsed?.data?.order ?? parsed?.order;
  return order?.id;
}

async function main(): Promise<void> {
  const accountNumber = process.argv[2];
  if (!accountNumber) {
    console.error('Usage: npx tsx scripts/verify/sample-mutation-tools.ts <accountNumber>');
    process.exit(1);
  }

  const symbol = 'DRAM';

  // First get a quote to know the current price
  console.log(`\nFetching quote for ${symbol}...`);
  const quoteResult = await callTool('get_equity_quotes', { symbols: [symbol] });
  let currentPrice = 50; // fallback
  if (quoteResult.success && quoteResult.data?.parsed?.data?.results) {
    const results = quoteResult.data.parsed.data.results;
    if (results.length > 0) {
      const q = results[0].quote;
      currentPrice = parseFloat(q.last_trade_price || q.previous_close || '50');
      console.log(`  Current price: $${currentPrice}`);
    }
  } else {
    console.log(`  Quote failed, using fallback price: $${currentPrice}`);
  }

  // Define test orders:
  // 1. Fractional market buy ($1) — will queue outside market hours
  // 2. Limit buy at $1 (far below current) — will rest as confirmed
  // 3. Stop-market buy with stop at $1000 (far above current) — will rest as confirmed
  // 4. Market buy 2 shares — LEAVE ON THE BOOKS (not cancelled)

  const ordersToPlace: Array<[string, Record<string, unknown>, string, boolean]> = [
    ['place_equity_order', {
      account_number: accountNumber,
      symbol,
      side: 'buy',
      type: 'market',
      dollar_amount: '1.00',
      time_in_force: 'gfd',
      market_hours: 'regular_hours',
      ref_id: `sample-frac-market-${Date.now()}`,
    }, 'Fractional market buy ($1)', true],

    ['place_equity_order', {
      account_number: accountNumber,
      symbol,
      side: 'buy',
      type: 'limit',
      quantity: '1',
      limit_price: '1.00',
      time_in_force: 'gtc',
      market_hours: 'regular_hours',
      ref_id: `sample-limit-buy-${Date.now()}`,
    }, 'Limit buy at $1 (far below current, will rest)', true],

    ['place_equity_order', {
      account_number: accountNumber,
      symbol,
      side: 'buy',
      type: 'stop_market',
      quantity: '1',
      stop_price: '1000.00',
      time_in_force: 'gtc',
      market_hours: 'regular_hours',
      ref_id: `sample-stop-buy-${Date.now()}`,
    }, 'Stop-market buy at $1000 (far above current, will rest)', true],

    ['place_equity_order', {
      account_number: accountNumber,
      symbol,
      side: 'buy',
      type: 'market',
      quantity: '2',
      time_in_force: 'gfd',
      market_hours: 'regular_hours',
      ref_id: `sample-market-2shares-${Date.now()}`,
    }, 'Market buy 2 shares (LEAVE ON BOOKS)', false],
  ];

  console.log(`\nPlacing ${ordersToPlace.length} test orders on ${symbol}...\n`);

  const results: SampleResult[] = [];
  const placedOrderIds: string[] = [];
  const keepOrderIds: string[] = [];
  let succeeded = 0;
  let failed = 0;

  // Place orders
  for (const [toolName, args, description, shouldCancel] of ordersToPlace) {
    process.stdout.write(`  ${toolName} (${description})... `);
    const timestamp = new Date().toISOString();
    const start = Date.now();
    try {
      const result = await callTool(toolName, args);
      const durationMs = Date.now() - start;
      if (result.success) {
        succeeded++;
        const orderId = extractOrderId(result.data);
        if (orderId) {
          placedOrderIds.push(orderId);
          if (!shouldCancel) keepOrderIds.push(orderId);
        }
        results.push({
          tool: toolName,
          args,
          success: true,
          response: result.data,
          timestamp,
          durationMs,
          orderId,
        });
        console.log(`OK (${durationMs}ms) orderId=${orderId ?? 'n/a'} — ${description}`);
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
        console.log(`FAIL (${durationMs}ms): ${result.error?.slice(0, 150)}`);
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
      console.log(`ERROR (${durationMs}ms): ${errorMsg.slice(0, 150)}`);
    }
  }

  // Cancel orders that should be cancelled (not in keepOrderIds)
  const cancelIds = placedOrderIds.filter(id => !keepOrderIds.includes(id));
  console.log(`\nCancelling ${cancelIds.length} orders (keeping ${keepOrderIds.length} on the books)...\n`);
  for (const orderId of cancelIds) {
    const shortId = orderId.slice(0, 8);
    process.stdout.write(`  cancel_equity_order (${shortId})... `);
    const timestamp = new Date().toISOString();
    const start = Date.now();
    try {
      const result = await callTool('cancel_equity_order', {
        account_number: accountNumber,
        order_id: orderId,
      });
      const durationMs = Date.now() - start;
      if (result.success) {
        succeeded++;
        results.push({
          tool: 'cancel_equity_order',
          args: { account_number: accountNumber, order_id: orderId },
          success: true,
          response: result.data,
          timestamp,
          durationMs,
          orderId,
        });
        console.log(`OK (${durationMs}ms)`);
      } else {
        failed++;
        results.push({
          tool: 'cancel_equity_order',
          args: { account_number: accountNumber, order_id: orderId },
          success: false,
          error: result.error,
          timestamp,
          durationMs,
          orderId,
        });
        console.log(`FAIL (${durationMs}ms): ${result.error?.slice(0, 150)}`);
      }
    } catch (err) {
      const durationMs = Date.now() - start;
      failed++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({
        tool: 'cancel_equity_order',
        args: { account_number: accountNumber, order_id: orderId },
        success: false,
        error: errorMsg,
        timestamp,
        durationMs,
        orderId,
      });
      console.log(`ERROR (${durationMs}ms): ${errorMsg.slice(0, 150)}`);
    }
  }

  // Write results
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Merge with existing observation samples if present
  const obsFile = join(OUTPUT_DIR, 'rh-observation-tools-samples.json');
  let allResults: SampleResult[] = results;
  try {
    const obsData = JSON.parse(readFileSync(obsFile, 'utf8'));
    allResults = [...obsData, ...results];
  } catch {
    // observation file doesn't exist, just write mutation results
  }
  writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  console.log(`\n=== Summary: ${succeeded} succeeded, ${failed} failed ===`);
  console.log(`Results written to: ${OUTPUT_FILE}`);
  if (keepOrderIds.length > 0) {
    console.log(`\nOrders LEFT ON THE BOOKS (not cancelled):`);
    keepOrderIds.forEach(id => console.log(`  ${id}`));
  }
  if (cancelIds.length > 0) {
    console.log(`\nCancelled order IDs:`);
    cancelIds.forEach(id => console.log(`  ${id}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Sampling failed:', err);
  process.exit(1);
});
