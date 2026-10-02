/**
 * Savant Trader OrderTicket type model.
 *
 * Discriminated union on InstrumentType for equity, ETF, and option order tickets.
 * Equity and ETF tickets are implemented; OptionOrderTicket is defined but not wired
 * — extension point for future option order work.
 *
 * Ref: PRD-savant-trader-order-placement-refactor.md §Order ticket data model
 * Ref: IMPL-savant-trader-order-placement-shared.md §4 (OrderTicket type model)
 */

// =============================
// Enums
// =============================

/** Instrument type discriminant for the OrderTicket union. */
export enum InstrumentType {
  EQUITY = 'equity',
  ETF = 'etf',
  OPTION = 'option',
}

/** Lifecycle status of an order ticket. */
export enum OrderTicketStatus {
  STAGED = 'staged',
  SUBMITTING = 'submitting',
  SUBMITTED = 'submitted',
  QUEUED = 'queued',
  RESTING = 'resting',
  FILLED = 'filled',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  /** Accepted as paper via the paperSignalOrder callable — tracked in the
   *  paper ledger, never sent to the broker (no RH-order polling). */
  PAPER = 'paper',
}

/** Origin of the order ticket. */
export enum OrderSource {
  SIGNAL_PIPELINE = 'signal_pipeline',
  MANUAL = 'manual',
  POSITION_MANAGEMENT = 'position_management',
}

// =============================
// Shared sub-types
// =============================

/** Link to the originating entity (e.g., an occurrence decision id). */
export interface OrderTicketSourceRef {
  type: string;
  id: string;
}

/** Signal context present when source = SIGNAL_PIPELINE. */
export interface OrderTicketSignalContext {
  signalType: string;
  barDate: string;
  timeframe: string;
  direction: string;
  /** Canonical doc id of the primary occurrence decision this ticket was
   *  staged from. */
  decisionId: string;
  /** Every occurrence-decision doc id written by the accept that staged
   *  this ticket — one decision is persisted per signal, but tickets are
   *  deduped by symbol+side, so a single ticket can own several decisions.
   *  Removal clears them all (#719). Absent on tickets staged before this
   *  field existed; `decisionId` remains the fallback. */
  decisionIds?: string[];
  /** Closing price of the bar that fired the signal — the price at signal
   *  generation. Captured at staging from the signal's `closePrice`; absent
   *  on tickets staged before this field existed or when the run omitted it. */
  signalPrice?: number;
}

/** Error details when submission fails. */
export interface OrderTicketError {
  message: string;
  code?: string;
  retryable: boolean;
}

/** Broker-authoritative order snapshot returned after submission. */
export interface BrokerOrderSnapshot {
  id: string;
  instrumentId?: string;
  symbol: string;
  side: string;
  type: string;
  state: string;
  quantity?: string;
  cumulativeQuantity?: string;
  price?: string | null;
  stopPrice?: string | null;
  fees?: string;
  dollarBasedAmount?: string | null;
  timeInForce?: string;
  marketHours?: string;
  trigger?: string;
  placedAgent?: string;
  createdAt?: string;
  lastTransactionAt?: string;
  executions?: unknown[];
}

/** Result details after submission. */
export interface OrderTicketResult {
  orderId?: string;
  state?: string;
  fillPrice?: string;
  filledQuantity?: string;
  brokerOrder?: BrokerOrderSnapshot;
}

/** Tax lot selection for sell orders specifying lots. */
export interface TaxLotSelection {
  lotId: string;
  quantity: string;
}

// =============================
// Base + variant interfaces
// =============================

export interface BaseOrderTicket {
  id: string;                    // UUID
  refId: string;                 // Robinhood idempotency key — generated at staging, reused on retry; regenerated on requeue of a terminal (cancelled) order — RH burns the old ref_id (#717)
  source: OrderSource;
  sourceRef?: OrderTicketSourceRef;
  status: OrderTicketStatus;
  accountNumber: string;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit' | 'stop_market' | 'stop_limit' | 'stop_loss';
  timeInForce: 'gfd' | 'gtc';
  marketHours: 'regular_hours' | 'extended_hours' | 'all_day_hours';
  signalContext?: OrderTicketSignalContext;
  /** Optional allocation-bucket doc id — set by the ticket's bucket
   *  picker; seeds the resulting position's attribution at fill
   *  (portfolio allocation, task #592). Never required: unset → the
   *  position lands in Unassigned. */
  bucketId?: string;
  createdAt: string;
  updatedAt: string;
  /** RH-derived timestamp when the broker order reached a terminal state.
   *  Set by reconciliation, used for the 24-hour cancelled recency filter. */
  terminalAt?: string;
  error?: OrderTicketError;
  result?: OrderTicketResult;
}

export interface EquityOrderTicket extends BaseOrderTicket {
  instrumentType: InstrumentType.EQUITY;
  symbol: string;
  quantity?: string;             // shares (decimal string)
  dollarAmount?: string;         // notional (market only)
  limitPrice?: string;
  stopPrice?: string;
  taxLots?: TaxLotSelection[];
}

export interface EtfOrderTicket extends BaseOrderTicket {
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

export interface OptionOrderTicket extends BaseOrderTicket {
  instrumentType: InstrumentType.OPTION;
  legs: OptionLeg[];
  quantity: string;              // contracts (positive integer string)
  price?: string;                // limit price per contract
  stopPrice?: string;
}

// =============================
// Discriminated union
// =============================

export type OrderTicket = EquityOrderTicket | EtfOrderTicket | OptionOrderTicket;

// =============================
// Trading config
// =============================

/** User's trading configuration stored at savant-trader/data/trading-config. */
export interface TradingConfig {
  accountNumber: string;
  /** Target dollar value per trade. Default 100. */
  defaultDollarAmount?: number;
  /** Guardrail on total open exposure in units. Default 200. */
  maxUnits?: number;
  /** Max percentage of account value allocatable to positions. Default 80. */
  maxAllocationPercent?: number;
  updatedAt: string;
}

/** Account info returned by get_accounts MCP tool, filtered to agentic-allowed. */
export interface AccountInfo {
  accountNumber: string;
  accountType: string;
  agenticAllowed: boolean;
}
