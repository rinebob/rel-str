/**
 * Robinhood broker-order adapter.
 *
 * Wraps the MCP tool executor and normalizers to provide the shared
 * `BrokerOrderAdapter` interface:
 *
 *   listOrders(accountNumber, options) → BrokerOrderPage
 *   getOrder(accountNumber, brokerOrderId) → RawBrokerOrder | null
 *   listPositions(accountNumber, options) → RawSymbolPositionPage
 *
 * Responsibilities:
 * - call MCP tools via `executeObservationTool`;
 * - detect embedded tool-level errors (`isError` inside transport success);
 * - normalize responses via the order/position normalizers;
 * - use the redacted response for normalization and raw retention (no PII leakage);
 * - enforce bounded request timeouts;
 * - propagate error categories from the executor.
 *
 * The adapter does NOT decide local case ownership, derive lifecycle states,
 * or write to Firestore. It returns broker facts only.
 */

import type {
  RawBrokerOrder,
  BrokerOrderPage,
  RawSymbolPositionPage,
  ReconciliationOptions,
} from '@trading-case/contracts';
import {
  executeObservationTool,
  type ExecuteObservationToolOptions,
} from '../tools/robinhood-tool-executor';
import {
  normalizeBrokerOrder,
  normalizeOrderListResponse,
  extractBrokerOrderFromParsed,
  extractOrderList,
  getToolLevelErrorMessage,
} from './broker-order-normalizer';
import {
  normalizePositionListResponse,
} from './broker-position-normalizer';
import {
  BrokerAdapterError,
} from './broker-adapter-errors';

/** Default per-call timeout for adapter operations (30 seconds). */
const DEFAULT_ADAPTER_TIMEOUT_MS = 30_000;

export interface BrokerOrderAdapterOptions {
  /** Timeout per MCP tool call in milliseconds. */
  timeoutMs?: number;
  /** Pass-through options for the underlying MCP tool executor. */
  executorOptions?: ExecuteObservationToolOptions;
}

type ListPositionsOptions = Pick<ReconciliationOptions, 'cursor'> & BrokerOrderAdapterOptions;

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BrokerAdapterError(message, 'TIMEOUT')), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// ---------------------------------------------------------------------------
// Shared tool execution helper — eliminates boilerplate duplication
// ---------------------------------------------------------------------------

interface AdapterToolResult {
  redacted: unknown;
}

async function executeAdapterTool(
  toolName: string,
  args: Record<string, unknown>,
  options: BrokerOrderAdapterOptions | undefined,
): Promise<AdapterToolResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_ADAPTER_TIMEOUT_MS;
  const result = await withTimeout(
    executeObservationTool(toolName, args, {}, options?.executorOptions),
    timeoutMs,
    `${toolName} timed out after ${timeoutMs}ms`,
  );

  if (!result.success) {
    throw new BrokerAdapterError(
      `${toolName} failed: ${result.error}`,
      result.category,
    );
  }

  const errorMessage = getToolLevelErrorMessage(result.parsed);
  if (errorMessage) {
    throw new BrokerAdapterError(`${toolName} tool error: ${errorMessage}`);
  }

  return { redacted: result.redacted };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * List equity orders for an account with optional filters and pagination.
 * Returns a single page; the caller is responsible for passing `nextCursor`
 * back as `options.cursor` to fetch subsequent pages.
 *
 * Uses the redacted response for normalization so `rawResponse` does not
 * contain unredacted PII (account numbers, names, etc.).
 */
export async function listOrders(
  accountNumber: string,
  options?: ReconciliationOptions & BrokerOrderAdapterOptions,
): Promise<BrokerOrderPage> {
  const args: Record<string, unknown> = { account_number: accountNumber };

  if (options?.cursor) args.cursor = options.cursor;
  if (options?.brokerOrderId) args.order_id = options.brokerOrderId;
  if (options?.state) args.state = options.state;
  if (options?.symbol) args.symbol = options.symbol;
  if (options?.agent) args.placed_agent = options.agent;
  if (options?.since) args.created_at_gte = options.since;

  const { redacted } = await executeAdapterTool('get_equity_orders', args, options);

  // Dispatch by shape: if the response has a list container, return the list
  // page (even if empty). Only try single-order normalization if there is no
  // list container.
  if (extractOrderList(redacted) !== null) {
    return normalizeOrderListResponse(redacted, accountNumber);
  }

  // Single-order response (direct or nested)
  if (extractBrokerOrderFromParsed(redacted) !== null) {
    try {
      const singleOrder = normalizeBrokerOrder(redacted, accountNumber);
      return { orders: [singleOrder], nextCursor: undefined };
    } catch {
      return { orders: [], nextCursor: undefined };
    }
  }

  // Unrecognized shape — return empty page
  return { orders: [], nextCursor: undefined };
}

/**
 * Get a single equity order by broker order ID.
 * Returns null if the order is not found (not an error).
 */
export async function getOrder(
  accountNumber: string,
  brokerOrderId: string,
  options?: BrokerOrderAdapterOptions,
): Promise<RawBrokerOrder | null> {
  const args = { account_number: accountNumber, order_id: brokerOrderId };

  const { redacted } = await executeAdapterTool('get_equity_orders', args, options);

  // The response may be a single order or a list with one result
  if (extractOrderList(redacted) !== null) {
    const page = normalizeOrderListResponse(redacted, accountNumber);
    return page.orders[0] ?? null;
  }

  try {
    return normalizeBrokerOrder(redacted, accountNumber);
  } catch {
    return null;
  }
}

/**
 * List equity positions for an account with cursor pagination.
 */
export async function listPositions(
  accountNumber: string,
  options?: ListPositionsOptions,
): Promise<RawSymbolPositionPage> {
  const args: Record<string, unknown> = { account_number: accountNumber };

  if (options?.cursor) args.cursor = options.cursor;

  const { redacted } = await executeAdapterTool('get_equity_positions', args, options);

  return normalizePositionListResponse(redacted, accountNumber);
}
