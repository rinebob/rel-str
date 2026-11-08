/**
 * Peak-since-entry derivation (#1413) — the shared datum for the positions
 * table (#1414) and the Update Stop dialog (#1415).
 *
 * `currentHoldingPeriod` finds the entry fill of the CURRENT holding period
 * by walking fills newest→oldest: the period opens where the reconstructed
 * position (positionQty minus the cumulative signed fills seen so far)
 * crosses zero. Adds within a period don't reset the entry; a re-buy after
 * a full exit starts a NEW period. When fills are exhausted before the
 * crossing — the entry predates the fetched window or the position came in
 * via transfer — `entryDate` is null (UI renders '—', never a fabricated
 * number).
 */

import { EquityHistoricalBar } from '@robinhood-mcp/contracts';
import {
  BrokerOrder,
  OrderSide,
} from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

/** One fill with its parent order's side — the walk's unit. */
export interface FillEvent {
  side: OrderSide;
  quantity: number;
  timestamp: string;
}

/** The derivable dates of the current holding period. Either may be null
 *  when the fills don't reach far enough back (or don't exist at all). */
export interface HoldingPeriod {
  entryDate: string | null;
  lastFillDate: string | null;
}

/** A peak observation — price + the day bar it printed on. */
export interface PeakPoint {
  price: number;
  date: string;
}

/** Per-symbol peak record exposed to consumers. */
export interface PositionPeak {
  symbol: string;
  entryDate: string | null;
  lastFillDate: string | null;
  /** Highest day-bar high since the holding-period entry. */
  lifetime: PeakPoint | null;
  /** Highest day-bar high since the most recent fill — the add-on-ratchet
   *  view; equals `lifetime` when the last fill IS the entry. */
  sinceLastFill: PeakPoint | null;
}

const EPSILON = 1e-6;

/**
 * Flatten executions across orders into side-tagged fills, newest first.
 * Every execution is a real fill regardless of parent order state — a
 * partially-filled-then-cancelled order's fills still count.
 */
export function fillsFromOrders(orders: BrokerOrder[]): FillEvent[] {
  const fills: FillEvent[] = [];
  for (const o of orders) {
    if (!o.side) continue;
    for (const e of o.executions ?? []) {
      if (e.quantity === null || e.timestamp === null) continue;
      fills.push({ side: o.side, quantity: e.quantity, timestamp: e.timestamp });
    }
  }
  return fills.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

/**
 * Derive the current holding period from fills (newest first) and the
 * position's signed quantity (positive long, negative short).
 *
 * Walking backward, `cum` accumulates each fill's signed qty (buy +, sell −);
 * the period opens at the fill where the cumulative reaches positionQty —
 * i.e., where the position BEFORE that fill was zero. Returns null when
 * there are no fills; `entryDate` is null when the fills never reach the
 * crossing (callers may fetch deeper history before giving up).
 */
export function currentHoldingPeriod(
  positionQty: number,
  fills: FillEvent[],
): HoldingPeriod | null {
  if (fills.length === 0 || positionQty === 0) return null;

  let cum = 0;
  let entryDate: string | null = null;
  const target = positionQty;
  for (const f of fills) {
    cum += f.side === 'buy' ? f.quantity : -f.quantity;
    const crossed = target > 0 ? cum >= target - EPSILON : cum <= target + EPSILON;
    if (crossed) {
      entryDate = f.timestamp;
      break;
    }
  }
  return { entryDate, lastFillDate: fills[0]!.timestamp };
}

/**
 * Highest day-bar high at-or-after `since`, compared at day granularity —
 * day bars begin 00:00Z, so an intraday fill's own entry day counts (the
 * bar's high is the finest 'day' resolution available). Returns the first
 * bar that prints the max; null when no bar is in range.
 */
export function peakSince(
  bars: EquityHistoricalBar[],
  since: string,
): PeakPoint | null {
  const sinceDay = since.slice(0, 10);
  let peak: PeakPoint | null = null;
  for (const b of bars) {
    if (b.begins_at.slice(0, 10) < sinceDay) continue;
    const high = Number.parseFloat(b.high_price);
    if (!Number.isFinite(high)) continue;
    if (peak === null || high > peak.price) {
      peak = { price: high, date: b.begins_at };
    }
  }
  return peak;
}
