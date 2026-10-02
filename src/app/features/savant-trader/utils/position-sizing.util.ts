/**
 * Position Sizing Utility
 *
 * Computes whole-share counts and unit costs from a target dollar amount
 * and the current share price. See DESIGN-position-sizing-units.md.
 */

/** Result of a position sizing calculation. */
export interface PositionSize {
  shares: number;
  actualCost: number;
  units: number;
}

/**
 * Compute the suggested share count for a given price and default dollar amount.
 *
 * shares = max(1, round(defaultDollarAmount / price))
 * units = round((shares * price) / defaultDollarAmount, 2)
 */
export function computePositionSize(
  price: number,
  defaultDollarAmount: number,
): PositionSize {
  if (price <= 0 || defaultDollarAmount <= 0) {
    return { shares: 0, actualCost: 0, units: 0 };
  }
  const shares = Math.max(1, Math.round(defaultDollarAmount / price));
  const actualCost = shares * price;
  const units = Math.round((actualCost / defaultDollarAmount) * 100) / 100;
  return { shares, actualCost, units };
}

/**
 * Compute units for an arbitrary share count (user override).
 * units = round((shares * price) / defaultDollarAmount, 2)
 */
export function computeUnits(
  shares: number,
  price: number,
  defaultDollarAmount: number,
): number {
  if (shares <= 0 || price <= 0 || defaultDollarAmount <= 0) return 0;
  return Math.round(((shares * price) / defaultDollarAmount) * 100) / 100;
}

/**
 * Compute the stop loss price from an entry price and stop percent.
 * stopPrice = entryPrice * (1 - stopPercent / 100)
 */
export function stopPriceFromPercent(
  entryPrice: number,
  stopPercent: number,
): number {
  return Math.round(entryPrice * (1 - stopPercent / 100) * 100) / 100;
}

/**
 * Compute the stop loss percent from an entry price and stop price.
 * stopPercent = ((entryPrice - stopPrice) / entryPrice) * 100
 */
export function stopPercentFromPrice(
  entryPrice: number,
  stopPrice: number,
): number {
  if (entryPrice <= 0) return 0;
  return Math.round(((entryPrice - stopPrice) / entryPrice) * 1000) / 10;
}

/** Default stop loss percent. */
export const DEFAULT_STOP_PERCENT = 8;

/** The price an order's cost is committed at — the editable limit price
 *  for limit/stop-limit tickets (the worst case), else the live quote
 *  (#723). Shared by the queue-row sizing, the ticket detail cost
 *  display, and the paper-send quantity derivation so all three stay on
 *  the same basis. */
export function ticketCostBasisPrice(
  ticket: { orderType: string; limitPrice?: string },
  livePrice: number | null | undefined,
): number | null {
  if (ticket.orderType === 'limit' || ticket.orderType === 'stop_limit') {
    const lp = parseFloat(ticket.limitPrice ?? '');
    if (Number.isFinite(lp) && lp > 0) return lp;
  }
  return livePrice ?? null;
}
