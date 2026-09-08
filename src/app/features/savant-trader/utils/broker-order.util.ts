/**
 * Shared utilities for parsing Robinhood MCP order responses and detecting
 * protective stop-loss orders.
 *
 * These helpers are used by both the signal-order page and the order-ticket
 * component so they don't duplicate the same response-shape traversal and
 * stop-loss predicate logic.
 */
import { BrokerOrderSnapshot } from '../services/order-ticket.types';

/**
 * Extract the orders array from an MCP `get_equity_orders` response.
 *
 * Handles the common nesting patterns:
 * - `{ results: [...] }`
 * - `{ data: { results: [...] } }`
 * - `{ data: { orders: [...] } }`
 *
 * Returns an empty array if no list container is found.
 */
export function extractOrdersFromResponse(parsed: unknown): Array<Record<string, unknown>> {
  if (!parsed || typeof parsed !== 'object') return [];
  const root = parsed as Record<string, unknown>;
  const data = root['data'];
  const dataRecord = data && typeof data === 'object' ? data as Record<string, unknown> : undefined;

  if (Array.isArray(root['results'])) return root['results'] as Array<Record<string, unknown>>;
  if (Array.isArray(root['orders'])) return root['orders'] as Array<Record<string, unknown>>;
  if (dataRecord) {
    if (Array.isArray(dataRecord['results'])) return dataRecord['results'] as Array<Record<string, unknown>>;
    if (Array.isArray(dataRecord['orders'])) return dataRecord['orders'] as Array<Record<string, unknown>>;
  }
  return [];
}

/**
 * Normalize a raw Robinhood order object into a `BrokerOrderSnapshot`.
 * Returns null if the object is missing a string `id`.
 */
export function normalizeToBrokerOrderSnapshot(raw: Record<string, unknown>): BrokerOrderSnapshot | null {
  if (typeof raw['id'] !== 'string') return null;
  return {
    id: raw['id'],
    instrumentId: raw['instrument_id'] as string | undefined,
    symbol: raw['symbol'] as string | undefined ?? '',
    side: String(raw['side'] ?? ''),
    type: String(raw['type'] ?? ''),
    state: String(raw['state'] ?? ''),
    quantity: raw['quantity'] as string | undefined,
    cumulativeQuantity: raw['cumulative_quantity'] as string | undefined,
    price: raw['price'] as string | null | undefined,
    stopPrice: raw['stop_price'] as string | null | undefined,
    fees: raw['fees'] as string | undefined,
    dollarBasedAmount: raw['dollar_based_amount'] as string | null | undefined,
    timeInForce: raw['time_in_force'] as string | undefined,
    marketHours: raw['market_hours'] as string | undefined,
    trigger: raw['trigger'] as string | undefined,
    placedAgent: raw['placed_agent'] as string | undefined,
    createdAt: raw['created_at'] as string | undefined,
    lastTransactionAt: raw['last_transaction_at'] as string | undefined,
    executions: Array.isArray(raw['executions']) ? raw['executions'] : undefined,
  };
}

/**
 * Parse an MCP `get_equity_orders` response into a map of broker order
 * snapshots keyed by order ID.
 */
export function parseEquityOrdersResponse(parsed: unknown): Record<string, BrokerOrderSnapshot> {
  const orders = extractOrdersFromResponse(parsed);
  const map: Record<string, BrokerOrderSnapshot> = {};
  for (const o of orders) {
    const snapshot = normalizeToBrokerOrderSnapshot(o);
    if (snapshot) map[snapshot.id] = snapshot;
  }
  return map;
}

/** Terminal states that indicate an order is no longer active. */
const TERMINAL_STATES = new Set(['cancelled', 'canceled', 'failed', 'rejected', 'voided']);

/** Stop order types recognized by Robinhood. */
const STOP_ORDER_TYPES = new Set(['stop', 'stop_market', 'stop_limit']);

/**
 * Check if a broker order is an active (non-terminal) protective stop-loss
 * sell order for the given symbol.
 */
export function isActiveStopLoss(order: BrokerOrderSnapshot, symbol: string): boolean {
  return order.symbol === symbol &&
    order.side === 'sell' &&
    STOP_ORDER_TYPES.has(order.type) &&
    !TERMINAL_STATES.has(order.state);
}

/**
 * Find the active stop-loss order for a symbol from a map of RH orders.
 * Returns the first matching active stop-loss, or null if none found.
 */
export function findActiveStopLoss(
  rhOrders: Record<string, BrokerOrderSnapshot>,
  symbol: string,
): BrokerOrderSnapshot | null {
  for (const order of Object.values(rhOrders)) {
    if (isActiveStopLoss(order, symbol)) return order;
  }
  return null;
}
