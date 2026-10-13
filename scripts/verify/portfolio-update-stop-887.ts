/**
 * Live probe for #887 — run the REAL OrderExecutionService.updateEquityStopOrder
 * against the local Robinhood observation API (port 3456, started by `npm start`).
 *
 * Exercises the production path end-to-end: real buildStopLossUpdateTicket →
 * real updateEquityStopOrder (cancel → order_id confirm poll → place with
 * bounded retry + refId idempotency) → real RobinhoodMcpClient normalization.
 * Angular DI is bypassed with Object.create — every method under test is the
 * shipped code; only the three injected fields are replaced (mcp transport →
 * local API fetch, real client with the same transport, no-op screenshots).
 *
 * Also resolves the wire behaviors the review flagged as unverified:
 *   - does get_equity_orders(order_id) return terminal orders?
 *   - does a re-placed stop carry the nudged price with a fresh resting state?
 *
 * Usage:
 *   npx tsx scripts/verify/portfolio-update-stop-887.ts <accountNumber> <orderId> <newStopPrice>
 *
 * Output:
 *   scripts/verify/samples/portfolio-update-stop-887-<timestamp>.json
 */

import '@angular/compiler';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { of } from 'rxjs';

import { OrderExecutionService } from '../../src/app/features/savant-trader/services/order-execution.service';
import { RobinhoodMcpClient } from '../../src/app/core/robinhood-mcp/robinhood-mcp-client.service';
import { buildStopLossUpdateTicket } from '../../src/app/features/savant-trader/utils/stop-loss-ticket.util';
import type { EquityOrderTicket } from '../../src/app/features/savant-trader/services/order-ticket.types';
import type { ToolExecutionResult } from '@robinhood-mcp/contracts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_BASE = 'http://127.0.0.1:3456/api/rh/tools';

async function executeTool(name: string, request: { args?: Record<string, unknown> } = {}): Promise<ToolExecutionResult> {
  try {
    const res = await fetch(`${API_BASE}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`, tool: name } as ToolExecutionResult;
    }
    return (await res.json()) as ToolExecutionResult;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err), tool: name } as ToolExecutionResult;
  }
}

async function main(): Promise<void> {
  const [accountNumber, orderId, newStopArg] = process.argv.slice(2);
  if (!accountNumber || !orderId || !newStopArg) {
    console.error('Usage: npx tsx scripts/verify/portfolio-update-stop-887.ts <accountNumber> <orderId> <newStopPrice>');
    process.exit(1);
  }
  const newStop = parseFloat(newStopArg);
  if (!Number.isFinite(newStop) || newStop <= 0) {
    console.error(`Invalid stop price: ${newStopArg}`);
    process.exit(1);
  }

  // Real client over the local-API transport stub.
  const mcpStub = { executeTool };
  const client = Object.create(RobinhoodMcpClient.prototype) as RobinhoodMcpClient;
  (client as unknown as Record<string, unknown>)['mcp'] = mcpStub;

  const service = Object.create(OrderExecutionService.prototype) as OrderExecutionService;
  const svcFields = service as unknown as Record<string, unknown>;
  svcFields['mcpService'] = mcpStub;
  svcFields['rhClient'] = client;
  svcFields['screenshots'] = { captureChartSnapshot$: () => of({ artifacts: [], paths: [] }) };

  const evidence: Record<string, unknown> = { startedAt: new Date().toISOString(), accountNumber, orderId, newStop };

  // ── Pre-state ────────────────────────────────────────────────────────────
  console.log(`\n[1/4] Pre-state — order ${orderId}`);
  const preOrders = await client.getEquityOrders(accountNumber, { orderId });
  const pre = preOrders.find((o) => o.orderId === orderId);
  evidence['preState'] = pre ?? { miss: true, rawCount: preOrders.length };
  if (!pre) {
    console.error(`Order ${orderId} not found via order_id lookup (${preOrders.length} orders returned). Aborting — nothing cancelled.`);
    writeEvidence(evidence);
    process.exit(1);
  }
  console.log(`  ${pre.symbol} ${pre.type} ${pre.side} | state=${pre.state} stop=${pre.stopPrice} qty=${pre.quantity} tif=${pre.timeInForce} hrs=${pre.marketHours}`);

  if (pre.state !== 'confirmed' || pre.side !== 'sell' || !pre.stopPrice) {
    console.error(`Refusing to update: order is not a live confirmed sell-stop (state=${pre.state}, side=${pre.side}, stop=${pre.stopPrice}). Aborting.`);
    writeEvidence(evidence);
    process.exit(1);
  }

  // ── Build the real update ticket and run the real primitive ──────────────
  const ticket: EquityOrderTicket = buildStopLossUpdateTicket(
    pre.symbol,
    pre.quantity,
    newStop,
    accountNumber,
    orderId,
    { timeInForce: pre.timeInForce ?? 'gtc', marketHours: 'regular_hours' },
  );
  evidence['ticket'] = { refId: ticket.refId, symbol: ticket.symbol, quantity: ticket.quantity, stopPrice: ticket.stopPrice, orderType: ticket.orderType, timeInForce: ticket.timeInForce, marketHours: ticket.marketHours };
  console.log(`\n[2/4] updateEquityStopOrder(${accountNumber}, ${orderId.slice(0, 8)}…, ticket ${ticket.refId.slice(0, 8)}… @ ${ticket.stopPrice})`);

  const result = await service.updateEquityStopOrder(accountNumber, orderId, ticket);
  evidence['updateResult'] = result;
  console.log(`  result: ${JSON.stringify(result, null, 2)}`);

  // ── Post-state ───────────────────────────────────────────────────────────
  console.log(`\n[3/4] Post-state — old order by order_id (terminal-order lookup probe)`);
  const postOld = await client.getEquityOrders(accountNumber, { orderId });
  const old = postOld.find((o) => o.orderId === orderId);
  evidence['postOldOrder'] = old ?? { miss: true, rawCount: postOld.length };
  console.log(old ? `  state=${old.state} cum=${old.cumulativeQuantity}` : `  order_id lookup returned ${postOld.length} orders, target absent (miss)`);

  console.log(`\n[4/4] Post-state — open ${pre.symbol} orders`);
  const openOrders = await client.getEquityOrders(accountNumber, {});
  const open = openOrders.filter((o) => o.symbol === pre.symbol && o.side === 'sell' && o.stopPrice);
  evidence['postOpenStops'] = open;
  for (const o of open) {
    console.log(`  ${o.orderId.slice(0, 8)}… state=${o.state} stop=${o.stopPrice} qty=${o.quantity} ref=${o.refId ?? 'n/a'}`);
  }

  const replacement = open.find((o) => o.refId === ticket.refId);
  evidence['replacementFound'] = Boolean(replacement);
  evidence['terminalLookupReturnedOldOrder'] = Boolean(old);

  console.log(`\n── Summary ──`);
  console.log(`  update result:      success=${result.success} phase=${result.phase ?? 'none'} unprotected=${result.unprotected ?? 'n/a'}`);
  console.log(`  old order state:    ${old?.state ?? 'missed by order_id lookup'}`);
  console.log(`  replacement live:   ${replacement ? `${replacement.orderId.slice(0, 8)}… @ ${replacement.stopPrice} (${replacement.state})` : 'NOT FOUND — reconcile manually!'}`);
  console.log(`  wire facts learned: order_id terminal lookup=${old ? 'returns terminal orders' : 'does NOT return terminal orders'}`);

  writeEvidence(evidence);
}

function writeEvidence(evidence: Record<string, unknown>): void {
  mkdirSync(join(__dirname, 'samples'), { recursive: true });
  const file = join(__dirname, 'samples', `portfolio-update-stop-887-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(evidence, null, 2));
  console.log(`\nEvidence: ${file}`);
}

main().catch((err) => {
  console.error('Probe failed:', err);
  process.exit(1);
});
