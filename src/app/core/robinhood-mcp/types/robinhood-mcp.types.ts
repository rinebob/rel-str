/**
 * Typed return shapes for RobinhoodMcpClient.
 *
 * These are frontend-only types — they represent the parsed, typed view of
 * raw MCP tool responses. They do not duplicate shared/broker-types.ts
 * (which are BE normalization output shapes). `OrderSide` is defined here
 * because the FE does not import from shared/broker-types.ts; the literal
 * values ('buy' | 'sell') are the same domain concept.
 */

import type { ToolExecutionErrorCategory } from '@robinhood-mcp/contracts';

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export interface AccountInfo {
  accountNumber: string;
  accountName: string;
  accountType: string;
  agenticAllowed: boolean;
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

export interface PortfolioSnapshot {
  totalValue: number | null;
  equityValue: number | null;
  cash: number | null;
  buyingPower: number | null;
  /** Margin exposure if the MCP response provides it. Null when unavailable. */
  marginExposure: number | null;
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

export interface EquityPosition {
  symbol: string;
  quantity: number | null;
  averageBuyPrice: number | null;
  sharesHeldForSells: number | null;
}

export interface OptionPosition {
  instrumentId: string;
  chainSymbol: string;
  optionType: string;
  strikePrice: number | null;
  expirationDate: string;
  quantity: number | null;
  averageCost: number | null;
}

// ---------------------------------------------------------------------------
// Option contract discovery (get_option_chains / get_option_instruments)
// ---------------------------------------------------------------------------

/** An option chain for one underlying — the set of expiration dates plus
 *  the chain UUID needed to enumerate instruments. Field names verified
 *  against captures/ro-opt-chains-01.json. */
export interface OptionChain {
  /** Chain UUID — the `chain_id` arg on get_option_instruments. */
  chainId: string;
  /** Underlying ticker (e.g. 'AAPL', 'SPX'). */
  symbol: string;
  /** YYYY-MM-DD expiration dates offered by this chain, sorted ascending. */
  expirationDates: string[];
  /** AM-settled chain when true — pick matching chains when the settlement
   *  session matters (get_option_instruments guide). */
  settleOnOpen?: boolean;
}

/** One tradable option contract. The instrument UUID is the ordering and
 *  quote identity (OptionLeg.optionId / get_option_quotes instrument_ids);
 *  the payload carries no OCC symbol — chain_symbol + expiration_date +
 *  type + strike_price is the contract identity (verified against
 *  captures/ro-opt-instr-02.json). */
export interface OptionInstrument {
  /** Instrument UUID — ordering/quote identity. */
  instrumentId: string;
  chainId: string;
  /** Underlying ticker. */
  chainSymbol: string;
  /** YYYY-MM-DD. */
  expirationDate: string;
  strikePrice: number | null;
  /** 'call' | 'put' verbatim — raw string, consumers narrow. */
  type: string;
}

/** Filters for get_option_instruments — the tool requires one of
 *  chain_symbol/chain_id/ids; the v1 discovery flow always resolves by
 *  chain_symbol. */
export interface OptionInstrumentFilters {
  chainSymbol: string;
  /** YYYY-MM-DD dates — sent as a comma-separated list. */
  expirationDates?: string[];
  strikePrice?: number;
  type?: 'call' | 'put';
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export interface EquityQuote {
  symbol: string;
  lastTradePrice: number | null;
  previousClose: number | null;
}

export interface OptionQuote {
  instrumentId: string;
  lastTradePrice: number | null;
  previousClose: number | null;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type OrderSide = 'buy' | 'sell';
export type OrderState =
  | 'new'
  | 'queued'
  | 'confirmed'
  | 'unconfirmed'
  | 'partially_filled'
  | 'filled'
  | 'cancelled'
  | 'rejected'
  | 'failed'
  | 'voided'
  | 'pending_cancelled'
  | 'unknown';

export type OrderType = 'market' | 'limit' | 'stop_market' | 'stop_limit' | 'unknown';

/** One leg of an option order (single-leg orders carry one leg). */
export interface BrokerOrderLeg {
  side: OrderSide | null;
  /** Option contract instrument UUID — the OptionPosition.instrumentId key. */
  optionId: string | null;
  quantity: number | null;
  /** RH position_effect: open or close — may be absent on some payloads. */
  positionEffect: 'open' | 'close' | null;
}

/** One execution (partial fill) on an order. */
export interface BrokerOrderExecution {
  price: number | null;
  quantity: number | null;
  timestamp: string | null;
}

export interface BrokerOrder {
  orderId: string;
  accountNumber: string;
  instrumentType: 'equity' | 'option';
  symbol: string | null;
  side: OrderSide;
  type: OrderType;
  state: OrderState;
  quantity: number | null;
  cumulativeQuantity: number | null;
  price: number | null;
  stopPrice: number | null;
  averageFillPrice: number | null;
  createdAt: string | null;
  /** RH `time_in_force` verbatim (e.g. 'gtc', 'gfd') — present only when the
   *  raw order carried it. Untyped on purpose: RH may return values outside
   *  the ticket's canonical EquityTimeInForce union. */
  timeInForce?: string;
  /** RH `market_hours` verbatim (e.g. 'regular_hours') — present only when
   *  the raw order carried it. */
  marketHours?: string;
  /** Present only when the raw order carried a `legs` array (option orders).
   *  Per-leg identity is required for per-instrument attribution — a spread
   *  is one order touching several instruments. */
  legs?: BrokerOrderLeg[];
  /** Present only when the raw order carried an `executions` array —
   *  per-fill price/quantity/timestamp for FIFO matching. */
  executions?: BrokerOrderExecution[];
}

// ---------------------------------------------------------------------------
// PnL Trade History
// ---------------------------------------------------------------------------

/** Time window for trade history queries. */
export type PnlTradeSpan = 'week' | 'month' | '3month' | 'ytd' | 'all';

/** A single closed/realizing trade from `get_pnl_trade_history`. */
export interface PnlTrade {
  /** ISO 8601 UTC timestamp of the trade. */
  timestamp: string;
  /** Ticker symbol (e.g. 'AAPL'). May be empty for options assignments. */
  symbol: string;
  /** Trade side: 'sell' (closing a long), 'buy' (closing a short), or '' (assignment). */
  side: string;
  /** Quantity traded. */
  quantity: number | null;
  /** Execution (close) price. */
  price: number | null;
  /** Realized gain/loss for this trade. */
  realizedGain: number | null;
}

/** Response from `get_pnl_trade_history`. */
export interface PnlTradeHistory {
  accountNumber: string;
  span: PnlTradeSpan;
  trades: PnlTrade[];
  /** Pagination cursor — empty string means no more pages. */
  nextCursor: string;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class RobinhoodMcpError extends Error {
  constructor(
    message: string,
    readonly tool: string,
    readonly category?: ToolExecutionErrorCategory,
  ) {
    super(message);
    this.name = 'RobinhoodMcpError';
  }
}
