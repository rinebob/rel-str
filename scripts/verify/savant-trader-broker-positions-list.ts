/**
 * Verification script: list equity positions via the broker-order adapter.
 *
 * Calls the real Robinhood MCP `get_equity_positions` tool through the adapter
 * and prints the normalized RawSymbolPositionPage. Verifies that:
 * - the adapter connects to the live MCP server;
 * - position responses normalize correctly;
 * - quantity, held-for-sells, and average-buy-price fields are preserved;
 * - pagination cursor is extracted.
 *
 * Usage:
 *   npx tsx scripts/verify/savant-trader-broker-positions-list.ts <accountNumber>
 */

import { listPositions } from '../functions/src/rh-agent-mcp/broker/broker-order-adapter';

async function main(): Promise<void> {
  const accountNumber = process.argv[2];
  if (!accountNumber) {
    console.error('Usage: npx tsx scripts/verify/savant-trader-broker-positions-list.ts <accountNumber>');
    process.exit(1);
  }

  console.log(`Listing equity positions for account ${accountNumber}...`);
  const page = await listPositions(accountNumber, { timeoutMs: 45_000 });

  console.log(`\nNormalized ${page.positions.length} position(s):`);
  for (const pos of page.positions) {
    console.log(`  ${pos.symbol} | qty=${pos.quantity} | avgBuy=${pos.averageBuyPrice ?? 'n/a'} | held=${pos.sharesHeldForSells ?? '0'} | available=${pos.sharesAvailableForSells ?? '?'} | type=${pos.positionType ?? '?'}`);
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
