/**
 * Shared broker types — raw adapter output for RH order and position normalization.
 *
 * Used by the BE broker adapter (functions/src/rh-agent-mcp/broker/) and BE tests.
 * The FE does not import these types; it works with the MCP ToolExecutionResult
 * shape directly.
 *
 * Framework-free so frontend and functions backend can share the domain seam.
 */

// ---------------------------------------------------------------------------
// Instrument types
// ---------------------------------------------------------------------------

export enum TradingInstrumentType {
  EQUITY = 'equity',
  ETF = 'etf',
  OPTION = 'option',
}

export type OrderSide = 'buy' | 'sell';

// ---------------------------------------------------------------------------
// Instrument-specific details
// ---------------------------------------------------------------------------

export interface EquityBrokerOrderDetails {
  kind: 'equity';
  symbol: string;
}

export interface OptionBrokerOrderDetails {
  kind: 'option';
  underlyingSymbol: string;
  legs: { side: OrderSide; contractId: string; quantity: string }[];
}

export type InstrumentSpecificDetails = EquityBrokerOrderDetails | OptionBrokerOrderDetails;

// ---------------------------------------------------------------------------
// Raw broker order (BE normalization output)
// ---------------------------------------------------------------------------

/**
 * Raw normalized broker order facts. `brokerOrderId` is the immutable external
 * Robinhood identity. Adapter methods must not fabricate local fields.
 */
export interface RawBrokerOrder {
  brokerOrderId: string;
  refId?: string;
  accountNumber: string;
  instrumentType: TradingInstrumentType;
  symbol?: string;
  instrumentId?: string;
  side: OrderSide;
  type: string;
  rawState: string;
  requestedQuantity?: string;
  cumulativeQuantity?: string;
  remainingQuantity?: string;
  price?: string | null;
  stopPrice?: string | null;
  averageFillPrice?: string;
  fees?: string;
  dollarBasedAmount?: string | null;
  timeInForce?: string;
  marketHours?: string;
  trigger?: string;
  triggeredAt?: string;
  placedAgent?: string;
  executions?: unknown[];
  lastTransactionAt?: string;
  createdAt?: string;
  rawResponse?: unknown;
  instrumentSpecific?: InstrumentSpecificDetails;
}

// ---------------------------------------------------------------------------
// Raw broker position (BE normalization output)
// ---------------------------------------------------------------------------

/**
 * Raw broker position facts. `observedAt` is the broker observation timestamp.
 */
export interface RawSymbolPosition {
  accountNumber: string;
  symbol: string;
  instrumentType: TradingInstrumentType;
  quantity: string;
  intradayQuantity?: string;
  averageBuyPrice?: string;
  sharesAvailableForSells?: string;
  sharesHeldForSells?: string;
  positionType?: string;
  observedAt: string;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface BrokerOrderPage {
  orders: RawBrokerOrder[];
  nextCursor?: string;
  skipped?: number;
}

export interface RawSymbolPositionPage {
  positions: RawSymbolPosition[];
  nextCursor?: string;
  skipped?: number;
}

// ---------------------------------------------------------------------------
// Adapter options and interface
// ---------------------------------------------------------------------------

export interface BrokerOrderAdapterOptions {
  cursor?: string;
  timeoutMs?: number;
}

export interface BrokerOrderAdapter {
  listOrders(accountNumber: string, options?: BrokerOrderAdapterOptions & { since?: string; state?: string; symbol?: string }): Promise<BrokerOrderPage>;
  getOrder(accountNumber: string, brokerOrderId: string): Promise<RawBrokerOrder | null>;
  listPositions(accountNumber: string, options?: BrokerOrderAdapterOptions): Promise<RawSymbolPositionPage>;
}
