/**
 * Place a limit order near market price and immediately poll to capture
 * the unconfirmed → confirmed/queued/rejected transition.
 *
 * Usage:
 *   npx tsx scripts/verify/sample-limit-transition.ts <accountNumber> [symbol]
 *
 * Output:
 *   scripts/verify/samples/limit-transition.json
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'samples');
const OUTPUT_FILE = join(OUTPUT_DIR, 'limit-transition.json');

const API_BASE = 'http://127.0.0.1:3456/api/rh/tools';

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

async function main(): Promise<void> {
  const accountNumber = process.argv[2];
  const symbol = process.argv[3] ?? 'DRAM';

  if (!accountNumber) {
    console.error('Usage: npx tsx scripts/verify/sample-limit-transition.ts <accountNumber> [symbol]');
    process.exit(1);
  }

  // Get current price
  console.log(`Fetching quote for ${symbol}...`);
  const quoteResult = await callTool('get_equity_quotes', { symbols: [symbol] });
  let currentPrice = 50;
  if (quoteResult.success && quoteResult.data?.parsed?.data?.results) {
    const results = quoteResult.data.parsed.data.results;
    if (results.length > 0) {
      const q = results[0].quote;
      currentPrice = parseFloat(q.last_trade_price || q.previous_close || '50');
      console.log(`  Current price: $${currentPrice}`);
    }
  }

  // Place a limit buy at 90% of current price (reasonable, will rest)
  const limitPrice = (currentPrice * 0.9).toFixed(2);
  console.log(`\nPlacing limit buy: ${symbol} @ $${limitPrice} (90% of current)...`);

  const placeResult = await callTool('place_equity_order', {
    account_number: accountNumber,
    symbol,
    side: 'buy',
    type: 'limit',
    quantity: '1',
    limit_price: limitPrice,
    time_in_force: 'gtc',
    market_hours: 'regular_hours',
    ref_id: `sample-limit-transition-${Date.now()}`,
  });

  const placeTimestamp = new Date().toISOString();
  const placeMs = Date.now();

  if (!placeResult.success) {
    console.error(`Place failed: ${placeResult.error}`);
    process.exit(1);
  }

  const orderId = placeResult.data?.parsed?.data?.order?.id;
  const placeState = placeResult.data?.parsed?.data?.order?.state;
  console.log(`  Placed! orderId=${orderId?.slice(0, 8)} initial state=${placeState}`);

  const results: any[] = [{
    phase: 'place',
    timestamp: placeTimestamp,
    elapsedMs: 0,
    state: placeState,
    order: placeResult.data?.parsed?.data?.order,
  }];

  // Poll every 500ms for 30 seconds
  console.log(`\nPolling every 500ms for 30s...`);
  let lastState = placeState;

  for (let i = 1; i <= 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const elapsedMs = Date.now() - placeMs;
    const timestamp = new Date().toISOString();

    const fetchResult = await callTool('get_equity_orders', {
      account_number: accountNumber,
      order_id: orderId,
    });

    if (fetchResult.success) {
      const orders = fetchResult.data?.parsed?.data?.orders ?? [];
      const order = orders.find((o: any) => o.id === orderId);
      if (order) {
        const state = order.state;
        const changed = state !== lastState;
        results.push({
          phase: 'poll',
          timestamp,
          elapsedMs,
          state,
          order,
        });
        const marker = changed ? ' *** STATE CHANGE ***' : '';
        console.log(`  [${i}] +${(elapsedMs / 1000).toFixed(2)}s state=${state}${marker}`);
        if (changed) {
          console.log(`    ${lastState} → ${state} (last_transaction_at: ${order.last_transaction_at})`);
          lastState = state;
        }

        // Stop on terminal states
        const terminal = ['filled', 'cancelled', 'rejected', 'failed', 'voided'];
        if (terminal.includes(state)) {
          console.log(`\nTerminal state: ${state}. Stopping.`);
          break;
        }
      } else {
        console.log(`  [${i}] +${(elapsedMs / 1000).toFixed(2)}s order not found in response`);
      }
    } else {
      console.log(`  [${i}] +${(elapsedMs / 1000).toFixed(2)}s ERROR: ${fetchResult.error?.slice(0, 80)}`);
    }
  }

  // Write results
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  console.log(`\nFinal state: ${lastState}`);
  console.log(`Results written to: ${OUTPUT_FILE}`);

  // Try to cancel if it's still resting
  if (lastState && !['filled', 'cancelled', 'rejected', 'failed', 'voided'].includes(lastState)) {
    console.log(`\nCancelling order ${orderId?.slice(0, 8)}...`);
    const cancelResult = await callTool('cancel_equity_order', {
      account_number: accountNumber,
      order_id: orderId,
    });
    console.log(`  Cancel: ${cancelResult.success ? 'OK' : 'FAIL: ' + cancelResult.error?.slice(0, 100)}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
