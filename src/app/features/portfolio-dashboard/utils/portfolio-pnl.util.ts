/**
 * Pure portfolio utilities for PnL computation and stop-loss protection detection.
 *
 * These functions have no dependencies and are tested directly. They are used
 * by `PortfolioDashboardStore` computed selectors.
 */

import { BrokerOrder, EquityPosition, OrderState, OrderType } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';
import { TERMINAL_ORDER_STATES } from './order-states.util';
import type { PositionPeak } from './position-peak.util';

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

/**
 * Check whether an order is an active (non-terminal) protective stop-loss
 * sell order. Used by both `isStopLossProtecting` and `computeProtectedSymbols`
 * to keep the predicate in one place.
 *
 * Robinhood may return stop orders with `type: 'market'` or `type: 'limit'`
 * alongside a non-null `stopPrice`. Such orders are treated as protective
 * stops in addition to the explicit `stop_market`/`stop_limit` types.
 */
function isProtectiveStopOrder(order: BrokerOrder): boolean {
  // Option orders resolve symbol to the underlying chain — a stop-priced
  // option sell is not protection for the equity position (#1411 review).
  if (order.instrumentType !== 'equity') return false;
  if (order.side !== 'sell') return false;
  if (order.symbol === null) return false;
  if (TERMINAL_ORDER_STATES.has(order.state)) return false;
  // Explicit stop order types, or any sell order with a stop price set.
  if (STOP_ORDER_TYPES.has(order.type)) return true;
  if (order.stopPrice != null) return true;
  return false;
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
 * - Order type is `stop_market` or `stop_limit`, OR the order has a non-null
 *   `stopPrice` (Robinhood may return stop orders as `type: 'market'` with a
 *   stop price set)
 * - Order side is `sell` (closing direction for a long)
 * - Order is not in a terminal state (filled, cancelled, rejected, etc.)
 * - Order symbol matches a position with positive quantity — a sell stop
 *   resting on a shorted symbol is not protection
 *
 * Note: This function is long-only. Short position protection (buy-stop)
 * is deferred to future work.
 */
export function isStopLossProtecting(
  order: BrokerOrder,
  positions: Pick<EquityPosition, 'symbol' | 'quantity'>[],
): boolean {
  if (!isProtectiveStopOrder(order)) return false;

  return positions.some(
    (p) => p.symbol === order.symbol && p.quantity !== null && p.quantity > 0,
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
 * (explicit `stop_market`/`stop_limit` type, or any sell order with a non-null
 * `stopPrice`) matches an open position.
 */
export function computeProtectedSymbols(
  orders: BrokerOrder[],
  positions: EquityPosition[],
): Set<string> {
  // Build a Set of symbols with open LONG positions — a sell stop resting
  // on a shorted symbol is not protection (same rule isStopLossProtecting
  // enforces); marking shorts protected would disable Add Stop on a row the
  // #1414 Stop column rightly flags UNPROTECTED.
  const openSymbols = new Set<string>();
  for (const p of positions) {
    if (p.quantity !== null && p.quantity > 0) {
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

// ---------------------------------------------------------------------------
// isUpdatableStopOrder / updatableStopsBySymbol (#888)
// ---------------------------------------------------------------------------

/**
 * Whether an order can be replaced by `updateEquityStopOrder` — a live
 * protective equity stop that is NOT stop-limit (the replacement ticket is
 * always stop-market; updating a stop-limit would silently downgrade it) and
 * not an option order (the primitive is equity-only). Stop-limits arrive as
 * explicit `stop_limit` OR as `type: 'limit'` carrying a `stopPrice` — a
 * limit-typed order with a stop trigger is the stop-limit shape regardless
 * of whether the limit `price` field happens to be populated.
 */
export function isUpdatableStopOrder(order: BrokerOrder): boolean {
  if (order.instrumentType !== 'equity') return false;
  if (order.type === 'stop_limit') return false;
  if (order.type === 'limit' && order.stopPrice != null) return false;
  return isProtectiveStopOrder(order);
}

/**
 * Group updatable stops by symbol for the Update Stop picker and the batch
 * ratchet — only symbols with a held long position (sell stops don't protect
 * shorts; same long-only rule as `isStopLossProtecting`).
 */
export function updatableStopsBySymbol(
  orders: BrokerOrder[],
  positions: Pick<EquityPosition, 'symbol' | 'quantity'>[],
): Map<string, BrokerOrder[]> {
  const grouped = new Map<string, BrokerOrder[]>();
  for (const order of orders) {
    if (!isUpdatableStopOrder(order) || !isStopLossProtecting(order, positions)) continue;
    const list = grouped.get(order.symbol!);
    if (list) list.push(order);
    else grouped.set(order.symbol!, [order]);
  }
  return grouped;
}

/**
 * The display stop order per symbol (#1414) — every live protective stop on
 * a held long (stop-limit included; updatability is a separate question the
 * `updatableStops` sibling answers). When a symbol has a stop ladder, the
 * highest stopPrice wins — it triggers first, so it IS the effective
 * protection level the table should quote.
 */
export function protectiveStopsBySymbol(
  orders: BrokerOrder[],
  positions: Pick<EquityPosition, 'symbol' | 'quantity'>[],
): Map<string, BrokerOrder> {
  const grouped = new Map<string, BrokerOrder>();
  for (const order of orders) {
    if (!isStopLossProtecting(order, positions)) continue;
    const prev = grouped.get(order.symbol!);
    if (!prev || (order.stopPrice ?? -Infinity) > (prev.stopPrice ?? -Infinity)) {
      grouped.set(order.symbol!, order);
    }
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// computeStopUpdateCandidates (#890) — Stop Audit batch ratchet
// ---------------------------------------------------------------------------

/** One updatable stop's audit row: how much of the position's peak the
 *  stop currently gives back, the proposed floor, and whether it moves. */
export interface StopUpdateCandidate {
  order: BrokerOrder;
  symbol: string;
  /** The resting stop's price — null when the order carries no stopPrice. */
  currentStopPrice: number | null;
  /** The audit anchor — `PositionPeak.lifetime.price`, the highest
   *  day-bar high since entry; null when no peak is derivable (e.g. a
   *  transferred position with no observed entry). */
  peakPrice: number | null;
  /** `(peak − stop) / peak × 100` to a tenth — the giveback the stop
   *  leaves exposed; null without both legs. Negative means the stop
   *  sits above the recorded peak (set after a new high, or a peak the
   *  derive couldn't see). */
  exposurePct: number | null;
  /** `peak × (1 − givebackPct/100)` rounded to cents — the audit's
   *  proposed floor; null when no peak. */
  computedStopPrice: number | null;
  /** 'update' when the stop is exposed beyond the giveback (the floor
   *  tightens it); 'within-policy' otherwise; 'skip-no-peak' /
   *  'skip-no-price' when the audit has no basis; 'skip-above-market'
   *  when the proposed floor sits at/above the current mark — the
   *  position already blew through the giveback and a sell-stop there
   *  triggers immediately on placement, so the batch leaves it for a
   *  manual decision. 'update' requires computed > current — the batch
   *  never loosens a stop. */
  disposition:
    | 'update'
    | 'within-policy'
    | 'skip-no-peak'
    | 'skip-no-price'
    | 'skip-above-market';
}

/**
 * Preview rows for the Stop Audit ratchet — one per updatable stop
 * (the `updatableStopsBySymbol` gate: equity, live, protective, not
 * stop-limit, held long position). Each row is audited against the
 * position's peak since entry (`PositionPeak.lifetime`): exposure =
 * `(peak − stop) / peak`; a stop exposed by more than `givebackPct`
 * gets proposed at `peak × (1 − givebackPct/100)`. Compared at cent
 * precision — the ticket's `toFixed(2)` makes cents the effective
 * unit, so a sub-cent edge is a no-op churn, not an update.
 */
export function computeStopUpdateCandidates(
  positions: (Pick<EquityPosition, 'symbol' | 'quantity'> & {
    currentPrice: number | null;
  })[],
  orders: BrokerOrder[],
  peaks: Record<string, PositionPeak | undefined>,
  givebackPct: number,
): StopUpdateCandidate[] {
  const candidates: StopUpdateCandidate[] = [];
  // Contract-level clamp: a negative giveback would floor ABOVE the peak
  // (a guaranteed immediate-trigger update). NaN still propagates into
  // `computed` and settles 'within-policy' — never a harmful order.
  const giveback = Math.max(0, givebackPct);
  const markBySymbol = new Map(positions.map((p) => [p.symbol, p.currentPrice]));
  // updatableStopsBySymbol is the eligibility gate — iterating its output
  // guarantees the batch set can never drift from the per-row Update Stop set.
  for (const [symbol, ordersForSymbol] of updatableStopsBySymbol(orders, positions)) {
    const mark = markBySymbol.get(symbol) ?? null;
    for (const order of ordersForSymbol) {
      const currentStopPrice = order.stopPrice ?? null;
      const peak = peaks[symbol]?.lifetime?.price ?? null;
      const peakPrice = peak !== null && Number.isFinite(peak) ? peak : null;
      const exposurePct =
        peakPrice !== null && currentStopPrice !== null
          ? Math.round(((peakPrice - currentStopPrice) / peakPrice) * 1000) / 10
          : null;
      const computed =
        peakPrice !== null
          ? Math.round(peakPrice * (1 - giveback / 100) * 100) / 100
          : null;
      const disposition: StopUpdateCandidate['disposition'] =
        peakPrice === null
          ? 'skip-no-peak'
          : currentStopPrice === null || computed === null
            ? 'skip-no-price'
            : computed <= currentStopPrice
              ? 'within-policy'
              : mark !== null && computed >= mark
                ? 'skip-above-market'
                : 'update';
      candidates.push({
        order,
        symbol,
        currentStopPrice,
        peakPrice,
        exposurePct,
        computedStopPrice: computed,
        disposition,
      });
    }
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// computeEntryDates
// ---------------------------------------------------------------------------

/** Order states that represent actual executions. */
const EXECUTED_ORDER_STATES: ReadonlySet<OrderState> = new Set([
  'filled',
  'partially_filled',
  'partially_filled_rest_cancelled',
]);

/**
 * Compute the earliest entry timestamp per symbol from order history.
 *
 * The broker's positions endpoint carries no date fields, so entry date is
 * derived as the earliest execution timestamp (falling back to the order's
 * `createdAt`) among executed orders for each symbol. Keys are
 * `${side}:${symbol}` so shorts derive from sell-side fills.
 *
 * Positions entered before the order-history window (transfers, very old
 * lots) have no matching order and resolve to `null`.
 */
export function computeEntryDates(orders: BrokerOrder[]): Map<string, string> {
  const earliest = new Map<string, string>();
  for (const o of orders) {
    if (!EXECUTED_ORDER_STATES.has(o.state)) continue;
    if (!o.symbol || !o.side) continue;

    let ts: string | null = null;
    for (const ex of o.executions ?? []) {
      if (ex.timestamp && (ts === null || ex.timestamp < ts)) ts = ex.timestamp;
    }
    ts ??= o.createdAt;
    if (ts === null) continue;

    const key = `${o.side}:${o.symbol}`;
    const prev = earliest.get(key);
    if (prev === undefined || ts < prev) earliest.set(key, ts);
  }
  return earliest;
}
