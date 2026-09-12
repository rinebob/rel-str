/**
 * Pure portfolio utilities for PnL computation and stop-loss protection detection.
 *
 * These functions have no dependencies and are tested directly. They are used
 * by `PortfolioDashboardStore` computed selectors.
 */

import { BrokerOrder, EquityPosition, OrderType } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PnLResult {
  pnl: number | null;
  pnlPercent: number | null;
}

// ---------------------------------------------------------------------------
// Shared predicates
// ---------------------------------------------------------------------------

const STOP_ORDER_TYPES: ReadonlySet<OrderType> = new Set<OrderType>(['stop_market', 'stop_limit']);

/** Terminal states that indicate an order is no longer active. */
const TERMINAL_STATES: ReadonlySet<string> = new Set([
  'filled', 'cancelled', 'canceled', 'failed', 'rejected', 'voided',
]);

/**
 * Check whether an order is an active (non-terminal) protective stop-loss
 * sell order. Used by both `isStopLossProtecting` and `computeProtectedSymbols`
 * to keep the predicate in one place.
 */
function isProtectiveStopOrder(order: BrokerOrder): boolean {
  if (!STOP_ORDER_TYPES.has(order.type)) return false;
  if (order.side !== 'sell') return false;
  if (order.symbol === null) return false;
  if (TERMINAL_STATES.has(order.state)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// computePnL
// ---------------------------------------------------------------------------

/**
 * Compute unrealized PnL for a position.
 *
 * For longs: pnl = (currentPrice - costBasis) * quantity
 * For shorts: pnl = (costBasis - currentPrice) * quantity
 *
 * Returns `{ pnl: null, pnlPercent: null }` when any input is null, not finite,
 * or when costBasis or quantity is zero.
 *
 * `quantity` is treated as a magnitude (always positive). The `isShort` flag
 * determines the direction of the PnL formula.
 */
export function computePnL(
  costBasis: number | null,
  currentPrice: number | null,
  quantity: number | null,
  isShort: boolean,
): PnLResult {
  if (costBasis === null || !Number.isFinite(costBasis) || costBasis === 0) {
    return { pnl: null, pnlPercent: null };
  }
  if (currentPrice === null || !Number.isFinite(currentPrice)) {
    return { pnl: null, pnlPercent: null };
  }
  if (quantity === null || !Number.isFinite(quantity) || quantity === 0) {
    return { pnl: null, pnlPercent: null };
  }

  const diff = isShort ? costBasis - currentPrice : currentPrice - costBasis;
  const pnl = diff * quantity;
  const pnlPercent = (diff / costBasis) * 100;

  return { pnl, pnlPercent };
}

// ---------------------------------------------------------------------------
// isStopLossProtecting
// ---------------------------------------------------------------------------

/**
 * Check whether an open stop-loss order protects a long position.
 *
 * Returns true when:
 * - Order type is `stop_market` or `stop_limit`
 * - Order side is `sell` (closing direction for a long)
 * - Order is not in a terminal state (filled, cancelled, rejected, etc.)
 * - Order symbol matches a position with non-zero quantity
 *
 * Note: This function is long-only. Short position protection (buy-stop)
 * is deferred to future work.
 */
export function isStopLossProtecting(order: BrokerOrder, positions: EquityPosition[]): boolean {
  if (!isProtectiveStopOrder(order)) return false;

  return positions.some(
    (p) => p.symbol === order.symbol && p.quantity !== null && p.quantity !== 0,
  );
}

// ---------------------------------------------------------------------------
// computeProtectedSymbols
// ---------------------------------------------------------------------------

/**
 * Compute the set of symbols that have active stop-loss protection.
 *
 * Single-pass O(n + m): build a Set of position symbols with non-zero quantity,
 * then iterate orders and collect symbols where an active stop-loss sell order
 * matches an open position.
 */
export function computeProtectedSymbols(
  orders: BrokerOrder[],
  positions: EquityPosition[],
): Set<string> {
  // Build a Set of symbols with non-zero open positions.
  const openSymbols = new Set<string>();
  for (const p of positions) {
    if (p.quantity !== null && p.quantity !== 0) {
      openSymbols.add(p.symbol);
    }
  }

  // Collect symbols from active stop-loss sell orders that match an open position.
  const protectedSymbols = new Set<string>();
  for (const o of orders) {
    if (!isProtectiveStopOrder(o)) continue;
    if (openSymbols.has(o.symbol!)) {
      protectedSymbols.add(o.symbol!);
    }
  }

  return protectedSymbols;
}
