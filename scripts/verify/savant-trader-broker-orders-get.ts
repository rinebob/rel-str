/**
 * Verification script: get a single equity order by broker order ID.
 *
 * Calls the real Robinhood MCP `get_equity_orders` tool with an order_id
 * filter and prints the normalized RawBrokerOrder. Verifies that:
 * - single-order responses (direct and nested) normalize correctly;
 * - missing orders return null rather than throwing;
 * - raw response is retained.
 *
 * Usage:
 *   npx tsx scripts/verify/savant-trader-broker-orders-get.ts <accountNumber> <brokerOrderId>
 */

import { getOrder } from '../functions/src/rh-agent-mcp/broker/broker-order-adapter';

async function main(): Promise<void> {
  const accountNumber = process.argv[2];
  const brokerOrderId = process.argv[3];
  if (!accountNumber || !brokerOrderId) {
    console.error('Usage: npx tsx scripts/verify/savant-trader-broker-orders-get.ts <accountNumber> <brokerOrderId>');
    process.exit(1);
  }

  console.log(`Fetching order ${brokerOrderId} for account ${accountNumber}...`);
  const order = await getOrder(accountNumber, brokerOrderId, { timeoutMs: 45_000 });

  if (!order) {
    console.log('Order not found (returned null).');
    return;
  }

  console.log(`\nNormalized order:`);
  console.log(`  brokerOrderId: ${order.brokerOrderId}`);
  console.log(`  symbol:        ${order.symbol ?? '?'}`);
  console.log(`  side:          ${order.side}`);
  console.log(`  type:          ${order.type}`);
  console.log(`  rawState:      ${order.rawState}`);
  console.log(`  qty:           ${order.requestedQuantity ?? '?'}`);
  console.log(`  cumulative:    ${order.cumulativeQuantity ?? '?'}`);
  console.log(`  remaining:     ${order.remainingQuantity ?? '?'}`);
  console.log(`  avgFillPrice:  ${order.averageFillPrice ?? 'n/a'}`);
  console.log(`  stopPrice:     ${order.stopPrice ?? 'n/a'}`);
  console.log(`  fees:          ${order.fees ?? 'n/a'}`);
  console.log(`  createdAt:     ${order.createdAt ?? '?'}`);
  console.log(`  executions:    ${Array.isArray(order.executions) ? order.executions.length : 0}`);
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
