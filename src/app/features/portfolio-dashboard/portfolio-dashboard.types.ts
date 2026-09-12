/**
 * Public types for the PortfolioDashboardStore.
 *
 * State shape, computed selector return types, and section identifiers.
 */

import {
  PortfolioSnapshot,
  EquityPosition,
  OptionPosition,
  EquityQuote,
  OptionQuote,
  BrokerOrder,
} from '../../core/robinhood-mcp/types/robinhood-mcp.types';

/** Generic per-section wrapper with independent loading/error state. */
export interface SectionData<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Per-account state — one SectionData per data source. */
export interface AccountState {
  accountNumber: string;
  accountName: string;
  accountType: string;
  portfolio: SectionData<PortfolioSnapshot>;
  equityPositions: SectionData<EquityPosition[]>;
  optionPositions: SectionData<OptionPosition[]>;
  equityQuotes: SectionData<Map<string, EquityQuote>>;
  optionQuotes: SectionData<Map<string, OptionQuote>>;
  equityOrders: SectionData<BrokerOrder[]>;
  optionOrders: SectionData<BrokerOrder[]>;
}

/** Top-level dashboard state. */
export interface DashboardState {
  accounts: AccountState[];
  selectedAccountIndex: number;
  showClosedPositions: boolean;
  showOrderHistory: boolean;
  globalLoading: boolean;
  loadError: string | null;
}

/** Equity position enriched with current price and PnL. */
export interface EquityPositionWithPnL extends EquityPosition {
  currentPrice: number | null;
  pnl: number | null;
  pnlPercent: number | null;
  /** True when position is closed (quantity === 0). */
  closed: boolean;
}

/** Option position enriched with current price and PnL. */
export interface OptionPositionWithPnL extends OptionPosition {
  currentPrice: number | null;
  pnl: number | null;
  pnlPercent: number | null;
}

/** Cross-account aggregate summary. */
export interface AggregateSummary {
  totalValue: number | null;
  totalExposure: number | null;
  totalCash: number | null;
  totalBuyingPower: number | null;
  totalPnL: number | null;
}

/** Section identifiers for `retrySection`. */
export type SectionName =
  | 'portfolio'
  | 'equityPositions'
  | 'optionPositions'
  | 'equityQuotes'
  | 'optionQuotes'
  | 'equityOrders'
  | 'optionOrders';
