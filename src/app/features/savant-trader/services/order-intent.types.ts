/**
 * Savant Trader OrderIntent type model.
 *
 * Discriminated union on InstrumentType for equity, ETF, and option order intents.
 * Equity and ETF intents are implemented; OptionOrderIntent is defined but not wired
 * — extension point for future option order work.
 *
 * Ref: PRD-savant-trader-order-placement-refactor.md §Order intent data model
 * Ref: IMPL-savant-trader-order-placement-shared.md §4 (OrderIntent type model)
 */

// =============================
// Enums
// =============================

/** Instrument type discriminant for the OrderIntent union. */
export enum InstrumentType {
  EQUITY = 'equity',
  ETF = 'etf',
  OPTION = 'option',
}

/** Lifecycle status of an order intent. */
export enum OrderIntentStatus {
  STAGED = 'staged',
  READY = 'ready',
  SUBMITTING = 'submitting',
  SUBMITTED = 'submitted',
  FILLED = 'filled',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/** Origin of the order intent. */
export enum OrderSource {
  SIGNAL_PIPELINE = 'signal_pipeline',
  MANUAL = 'manual',
  POSITION_MANAGEMENT = 'position_management',
}

// =============================
// Shared sub-types
// =============================

/** Link to the originating entity (e.g., an occurrence decision id). */
export interface OrderIntentSourceRef {
  type: string;
  id: string;
}

/** Signal context present when source = SIGNAL_PIPELINE. */
export interface OrderIntentSignalContext {
  signalType: string;
  barDate: string;
  timeframe: string;
  direction: string;
  decisionId: string;
}

/** Error details when submission fails. */
export interface OrderIntentError {
  message: string;
  code?: string;
  retryable: boolean;
}

/** Result details after submission. */
export interface OrderIntentResult {
  orderId?: string;
  state?: string;
  fillPrice?: string;
  filledQuantity?: string;
}

/** Tax lot selection for sell orders specifying lots. */
export interface TaxLotSelection {
  lotId: string;
  quantity: string;
}

// =============================
// Base + variant interfaces
// =============================

export interface BaseOrderIntent {
  id: string;                    // UUID
  refId: string;                 // Robinhood idempotency key — generated at staging, reused on retry
  source: OrderSource;
  sourceRef?: OrderIntentSourceRef;
  status: OrderIntentStatus;
  accountNumber: string;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit' | 'stop_market' | 'stop_limit';
  timeInForce: 'gfd' | 'gtc';
  marketHours: 'regular_hours' | 'extended_hours' | 'all_day_hours';
  signalContext?: OrderIntentSignalContext;
  createdAt: string;
  updatedAt: string;
  error?: OrderIntentError;
  result?: OrderIntentResult;
}

export interface EquityOrderIntent extends BaseOrderIntent {
  instrumentType: InstrumentType.EQUITY;
  symbol: string;
  quantity?: string;             // shares (decimal string)
  dollarAmount?: string;         // notional (market only)
  limitPrice?: string;
  stopPrice?: string;
  taxLots?: TaxLotSelection[];
}

export interface EtfOrderIntent extends BaseOrderIntent {
  instrumentType: InstrumentType.ETF;
  symbol: string;
  quantity?: string;
  dollarAmount?: string;
  limitPrice?: string;
  stopPrice?: string;
  taxLots?: TaxLotSelection[];
}

export interface OptionLeg {
  type: 'buy' | 'sell';
  symbol: string;                // OCC contract symbol
  quantity: string;              // contracts (positive integer string)
}

export interface OptionOrderIntent extends BaseOrderIntent {
  instrumentType: InstrumentType.OPTION;
  legs: OptionLeg[];
  quantity: string;              // contracts (positive integer string)
  price?: string;                // limit price per contract
  stopPrice?: string;
}

// =============================
// Discriminated union
// =============================

export type OrderIntent = EquityOrderIntent | EtfOrderIntent | OptionOrderIntent;

// =============================
// Trading config
// =============================

/** User's trading configuration stored at savant-trader/data/trading-config. */
export interface TradingConfig {
  accountNumber: string;
  updatedAt: string;
}

/** Account info returned by get_accounts MCP tool, filtered to agentic-allowed. */
export interface AccountInfo {
  accountNumber: string;
  accountType: string;
  agenticAllowed: boolean;
}
