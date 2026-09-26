/**
 * Universal primitives shared across frontend and backend.
 *
 * This file holds domain-agnostic trading/types concepts that are not specific
 * to options, spreads, or any single subsystem. Keep it small and stable.
 */

export enum TradeSide {
  LONG = 'long',
  SHORT = 'short',
}

/**
 * One point on a cumulative-P&L equity curve — canonical shape for
 * `{date, cumulativePnl}` curves (`date` is a market date, YYYY-MM-DD).
 * Adopters: paper-trading contracts (re-export), portfolio allocation.
 * Known same-name copies left intentionally untouched (structurally
 * compatible, out of scope for #583): functions paper-trading engine
 * types, options-strategy.types. The backtest chart's EquityCurvePoint is
 * a DIFFERENT shape ({date: Date, value}) — unrelated.
 */
export interface EquityCurvePoint {
  date: string;
  cumulativePnl: number;
}
