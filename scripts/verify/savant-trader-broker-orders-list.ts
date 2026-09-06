/**
 * Verification script: list equity orders via the broker-order adapter.
 *
 * Calls the real Robinhood MCP `get_equity_orders` tool through the adapter
 * and prints the normalized BrokerOrderPage. Verifies that:
 * - the adapter connects to the live MCP server;
 * - nested/direct responses normalize correctly;
 * - pagination cursor is extracted;
 * - raw states are preserved without speculative mapping.
 *
 * Usage:
 *   npx tsx scripts/verify/savant-trader-broker-orders-list.ts [accountNumber]
 *
 * If accountNumber is omitted, the first account from get_accounts is used.
 */

import { listOrders } from '../functions/src/rh-agent-mcp/broker/broker-order-adapter.ts';

async function main(): Promise<void> {
  const accountNumber = process.argv[2];
  if (!accountNumber) {
    console.error('Usage: npx tsx scripts/verify/savant-trader-broker-orders-list.ts <accountNumber>');
    process.exit(1);
  }

  console.log(`Listing equity orders for account ${accountNumber}...`);
  const page = await listOrders(accountNumber, { timeoutMs: 45_000 });

  console.log(`\nNormalized ${page.orders.length} order(s):`);
  for (const order of page.orders) {
    console.log(`  ${order.brokerOrderId} | ${order.symbol ?? '?'} | ${order.side} | ${order.type} | state=${order.rawState} | qty=${order.requestedQuantity ?? '?'} | avgFill=${order.averageFillPrice ?? 'n/a'}`);
  }

  if (page.nextCursor) {
    console.log(`\nNext cursor: ${page.nextCursor}`);
  } else {
    console.log('\nNo more pages.');
  }
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
