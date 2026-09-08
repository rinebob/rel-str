/**
 * Poll a specific order by ID and log state transitions over time.
 * Captures the full order object each poll and writes a transition log.
 *
 * Usage:
 *   npx tsx scripts/verify/poll-order-state.ts <accountNumber> <orderId> [intervalMs] [durationMs]
 *
 * Defaults: intervalMs=5000 (5s), durationMs=300000 (5min)
 *
 * Output:
 *   scripts/verify/samples/order-state-transitions.json
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'samples');
const OUTPUT_FILE = join(OUTPUT_DIR, 'order-state-transitions.json');

const API_BASE = 'http://127.0.0.1:3456/api/rh/tools';

interface PollEntry {
  timestamp: string;
  pollNumber: number;
  elapsedMs: number;
  state: string | null;
  order: unknown;
  error?: string;
}

async function fetchOrder(accountNumber: string, orderId: string): Promise<{ success: boolean; order?: any; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}/get_equity_orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: { account_number: accountNumber, order_id: orderId } }),
    });
    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${text.slice(0, 300)}` };
    }
    const data = await response.json();
    const parsed = data?.parsed ?? data;
    const orders = parsed?.data?.orders ?? [];
    if (orders.length === 0) {
      return { success: false, error: 'No orders returned' };
    }
    // Find our order by ID
    const order = orders.find((o: any) => o.id === orderId) ?? orders[0];
    return { success: true, order };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main(): Promise<void> {
  const accountNumber = process.argv[2];
  const orderId = process.argv[3];
  const intervalMs = parseInt(process.argv[4] ?? '5000', 10);
  const durationMs = parseInt(process.argv[5] ?? '300000', 10);

  if (!accountNumber || !orderId) {
    console.error('Usage: npx tsx scripts/verify/poll-order-state.ts <accountNumber> <orderId> [intervalMs] [durationMs]');
    process.exit(1);
  }

  console.log(`Polling order ${orderId.slice(0, 8)}...`);
  console.log(`Account: ${accountNumber}`);
  console.log(`Interval: ${intervalMs}ms, Duration: ${durationMs}ms (${Math.round(durationMs / 1000)}s)`);
  console.log('');

  const entries: PollEntry[] = [];
  const startTime = Date.now();
  let lastState: string | null = null;
  let pollNumber = 0;

  while (Date.now() - startTime < durationMs) {
    pollNumber++;
    const elapsedMs = Date.now() - startTime;
    const timestamp = new Date().toISOString();

    const result = await fetchOrder(accountNumber, orderId);

    if (result.success && result.order) {
      const state = result.order.state ?? null;
      const stateChanged = state !== lastState;

      entries.push({
        timestamp,
        pollNumber,
        elapsedMs,
        state,
        order: result.order,
      });

      const marker = stateChanged ? ' *** STATE CHANGE ***' : '';
      console.log(`[${pollNumber}] ${timestamp} (+${(elapsedMs / 1000).toFixed(1)}s) state=${state}${marker}`);

      if (stateChanged) {
        console.log(`  Previous: ${lastState}`);
        console.log(`  Current:  ${state}`);
        console.log(`  last_transaction_at: ${result.order.last_transaction_at}`);
        lastState = state;
      }

      // Stop if we hit a terminal state
      const terminalStates = ['filled', 'cancelled', 'rejected', 'failed', 'voided'];
      if (state && terminalStates.includes(state)) {
        console.log(`\nTerminal state reached: ${state}. Stopping.`);
        break;
      }
    } else {
      entries.push({
        timestamp,
        pollNumber,
        elapsedMs,
        state: null,
        order: null,
        error: result.error,
      });
      console.log(`[${pollNumber}] ${timestamp} (+${(elapsedMs / 1000).toFixed(1)}s) ERROR: ${result.error?.slice(0, 100)}`);
    }

    // Wait for next interval
    const remaining = durationMs - (Date.now() - startTime);
    if (remaining <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }

  // Write results
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(entries, null, 2));

  const totalElapsed = Date.now() - startTime;
  console.log(`\n=== Polling complete: ${entries.length} polls over ${(totalElapsed / 1000).toFixed(1)}s ===`);
  console.log(`Final state: ${lastState}`);
  console.log(`Results written to: ${OUTPUT_FILE}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Polling failed:', err);
  process.exit(1);
});
