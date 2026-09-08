/**
 * Broker Order normalizer.
 *
 * Normalizes raw Robinhood MCP order responses into the shared
 * `RawBrokerOrder` contract. Handles:
 * - direct and nested response shapes (`parsed.data.order`);
 * - order-list containers (`results` / `orders`);
 * - cursor extraction from pagination URLs;
 * - redacted raw response retention (no PII leakage).
 *
 * This module does NOT decide local case ownership, derive lifecycle states,
 * or fabricate local fields (caseId, refId, local IDs). It returns broker facts.
 */

import type {
  RawBrokerOrder,
  BrokerOrderPage,
} from '../../../../shared/broker-types';
import { isPlainObject } from '@robinhood-mcp/utils';
import { BrokerAdapterError } from './broker-adapter-errors';
import {
  optionalString,
  optionalStringOrNull,
  extractCursor,
  inferInstrumentType,
} from './broker-adapter-helpers';

// ---------------------------------------------------------------------------
// Tool-level error detection
// ---------------------------------------------------------------------------

/**
 * Detect an embedded MCP tool-level error (`isError: true`) inside a
 * transport-success response. Returns the error message if found, otherwise
 * undefined. Handles both top-level and nested `parsed.data` shapes.
 */
export function getToolLevelErrorMessage(parsed: unknown): string | undefined {
  if (!isPlainObject(parsed)) return undefined;
  if (parsed.isError === true) {
    return typeof parsed.error === 'string' ? parsed.error : 'Unknown tool error';
  }
  const data = parsed.data;
  if (isPlainObject(data) && data.isError === true) {
    return typeof data.error === 'string' ? data.error : 'Unknown tool error';
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Order extraction (handles direct + nested shapes)
// ---------------------------------------------------------------------------

/**
 * Extract a single broker order object from various response shapes:
 * - direct: `{ id, state, ... }`
 * - nested: `{ data: { order: { id, state, ... } } }`
 *
 * Returns null if no recognizable order object is found.
 */
export function extractBrokerOrderFromParsed(parsed: unknown): Record<string, unknown> | null {
  if (!isPlainObject(parsed)) return null;

  // Direct order response
  if (typeof parsed.id === 'string' && (typeof parsed.state === 'string' || typeof parsed.side === 'string')) {
    return parsed;
  }

  // Nested: parsed.data.order
  const data = parsed.data;
  if (isPlainObject(data)) {
    const order = data.order;
    if (isPlainObject(order) && typeof order.id === 'string') {
      return order;
    }
    // Direct inside data
    if (typeof data.id === 'string' && (typeof data.state === 'string' || typeof data.side === 'string')) {
      return data;
    }
  }

  return null;
}

/**
 * Extract a list of order objects from various list-response shapes:
 * - `{ results: [...] }`
 * - `{ orders: [...] }`
 * - `{ data: { results: [...] } }`
 *
 * Returns null if no list container is found (useful for dispatch-by-shape).
 * Elements are NOT filtered — non-objects flow through to the normalizer
 * where they are caught and counted in `skipped`.
 */
export function extractOrderList(parsed: unknown): unknown[] | null {
  if (!isPlainObject(parsed)) return null;

  if (Array.isArray(parsed.results)) return parsed.results;
  if (Array.isArray(parsed.orders)) return parsed.orders;

  // Nested: parsed.data.results
  const data = parsed.data;
  if (isPlainObject(data)) {
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.orders)) return data.orders;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a raw Robinhood order response (direct or nested) into a
 * `RawBrokerOrder`. Throws `BrokerAdapterError` if the broker order ID is
 * missing, the side is unrecognized, or the response shape is unrecognized.
 *
 * @param raw - The parsed/redacted MCP tool response (direct or nested)
 * @param accountNumber - The account number used for the request (authoritative)
 */
export function normalizeBrokerOrder(raw: unknown, accountNumber: string): RawBrokerOrder {
  const extracted = extractBrokerOrderFromParsed(raw);
  if (!extracted) {
    throw new BrokerAdapterError('Could not extract broker order from response');
  }

  const brokerOrderId = extracted.id;
  if (typeof brokerOrderId !== 'string' || !brokerOrderId) {
    throw new BrokerAdapterError('Broker order response is missing required order ID');
  }

  // Validate side — do not coerce unknown values to 'buy'
  const rawSide = extracted.side;
  if (rawSide !== 'buy' && rawSide !== 'sell') {
    throw new BrokerAdapterError(
      `Broker order response has unrecognized side: ${String(rawSide)}`,
    );
  }

  const instrumentType = inferInstrumentType(extracted);

  return {
    brokerOrderId,
    refId: optionalString(extracted.ref_id),
    accountNumber: accountNumber || optionalString(extracted.account_number) || '',
    instrumentType,
    symbol: optionalString(extracted.symbol),
    instrumentId: optionalString(extracted.instrument_id),
    side: rawSide,
    type: optionalString(extracted.type) ?? 'unknown',
    rawState: optionalString(extracted.state) ?? 'unknown',
    requestedQuantity: optionalString(extracted.quantity),
    cumulativeQuantity: optionalString(extracted.cumulative_quantity),
    remainingQuantity: optionalString(extracted.remaining_quantity),
    price: optionalStringOrNull(extracted.price),
    stopPrice: optionalStringOrNull(extracted.stop_price),
    averageFillPrice: optionalString(extracted.average_price),
    fees: optionalString(extracted.fees),
    dollarBasedAmount: optionalStringOrNull(extracted.dollar_based_amount),
    timeInForce: optionalString(extracted.time_in_force),
    marketHours: optionalString(extracted.market_hours),
    trigger: optionalString(extracted.trigger),
    triggeredAt: optionalString(extracted.triggered_at),
    placedAgent: optionalString(extracted.placed_agent),
    executions: Array.isArray(extracted.executions) ? extracted.executions : undefined,
    lastTransactionAt: optionalString(extracted.last_transaction_at),
    createdAt: optionalString(extracted.created_at),
    rawResponse: raw,
  };
}

/**
 * Normalize an order-list response into a `BrokerOrderPage`.
 * Handles `results` and `orders` containers, and extracts the cursor
 * from the `next` pagination URL. Items that fail normalization are counted
 * in the `skipped` field rather than silently dropped.
 */
export function normalizeOrderListResponse(raw: unknown, accountNumber: string): BrokerOrderPage {
  const orders = extractOrderList(raw) ?? [];
  let skipped = 0;
  const normalized = orders.map((o) => {
    try {
      return normalizeBrokerOrder(o, accountNumber);
    } catch {
      skipped++;
      return null;
    }
  }).filter((o): o is RawBrokerOrder => o !== null);

  const nextCursor = isPlainObject(raw) ? extractCursor(raw.next) : undefined;

  return { orders: normalized, nextCursor, skipped: skipped || undefined };
}
