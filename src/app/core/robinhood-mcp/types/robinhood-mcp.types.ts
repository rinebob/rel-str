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
