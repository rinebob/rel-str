/**
 * Shared Trading Case domain types — instruments, order terms, lifecycle,
 * Trading Case, Order Ticket, and Case Summary.
 *
 * Framework-free so frontend and functions backend can share the domain seam.
 */

export enum TradingInstrumentType {
  EQUITY = 'equity',
  ETF = 'etf',
  OPTION = 'option',
}

export type TradingCaseSource = 'signal_pipeline' | 'manual' | 'position_management' | 'broker_adoption';
export type OrderSide = 'buy' | 'sell';
export type EquityOrderType = 'market' | 'limit' | 'stop_market' | 'stop_limit';

export interface TradingSignalContext {
  symbol: string;
  runId: string;
  signalType: string;
  barDate: string;
  marketDate?: string;
  timeframe: string;
  direction: string;
  decisionId?: string;
}

export interface TaxLotSelection {
  lotId: string;
  quantity: string;
}

/** Equity/ETF order terms. Either `quantity` or `dollarAmount` must be present. */
export interface EquityOrderTerms {
  instrumentType: TradingInstrumentType.EQUITY | TradingInstrumentType.ETF;
  symbol: string;
  side: OrderSide;
  orderType: EquityOrderType;
  quantity?: string;
  dollarAmount?: string;
  limitPrice?: string;
  stopPrice?: string;
  taxLots?: TaxLotSelection[];
  timeInForce: 'gfd' | 'gtc';
  marketHours: 'regular_hours' | 'extended_hours' | 'all_day_hours';
}

// options-out-of-scope stub — not exercised in this milestone; typed loosely for forward extension.
export type OptionOrderType = 'market' | 'limit' | 'stop_market' | 'stop_limit';
export type OptionOrderTimeInForce = 'gfd' | 'gtc';

export interface OptionOrderLeg {
  side: OrderSide;
  contractId: string;
  quantity: string;
}

/**
 * Option order terms (out-of-scope stub for future extension).
 * `quantity` is the total number of contracts; per-leg `quantity` is the
 * number of contracts for that leg. For single-leg orders, leg quantity
 * equals the top-level quantity. For multi-leg spreads, leg quantities
 * should sum to the top-level quantity (to be validated when options
 * are implemented).
 */
export interface OptionOrderTerms {
  instrumentType: TradingInstrumentType.OPTION;
  underlyingSymbol: string;
  legs: OptionOrderLeg[];
  orderType: OptionOrderType;
  quantity: string;
  price?: string;
  stopPrice?: string;
  timeInForce: OptionOrderTimeInForce;
}

export type ProposedOrderTerms = EquityOrderTerms | OptionOrderTerms;

export interface OrderAuthorization {
  authorizedAt: string;
  authorizedBy: string;
  preflightFingerprint: string;
}

// ---------------------------------------------------------------------------
// Instrument-neutral broker order details
// ---------------------------------------------------------------------------

export interface EquityBrokerOrderDetails {
  kind: 'equity';
  symbol: string;
}

export interface OptionBrokerOrderDetails {
  kind: 'option';
  underlyingSymbol: string;
  legs: OptionOrderLeg[];
}

export type InstrumentSpecificDetails = EquityBrokerOrderDetails | OptionBrokerOrderDetails;

// ---------------------------------------------------------------------------
// Trading Case and lifecycle
// ---------------------------------------------------------------------------

export const TRADING_CASES_COLLECTION = 'savant-trader/data/trading-cases';

export enum TradingCaseStatus {
  ACTIVE = 'active',
  CLOSED = 'closed',
  ABANDONED = 'abandoned',
}

export enum BrokerOrderRole {
  ENTRY = 'entry',
  PROTECTIVE_STOP = 'protective_stop',
  FRACTIONAL_CLOSE = 'fractional_close',
  REPLACEMENT = 'replacement',
  FUTURE_TARGET_EXIT = 'future_target_exit',
  UNMATCHED = 'unmatched',
}

/**
 * Broker Order lifecycle states. `LOCAL_ONLY`, `SUBMITTING`, and `PENDING`
 * are local-only states valid on `CaseSummary` before a broker order exists
 * or during pending reconciliation; they are not valid on
 * `BrokerOrder.derivedState` (which requires a `brokerOrderId`).
 * Use `BrokerOrderDerivedState` for the `derivedState` field type.
 */
export enum BrokerOrderLifecycleState {
  LOCAL_ONLY = 'local_only',
  SUBMITTING = 'submitting',
  SUBMITTED = 'submitted',
  PENDING = 'pending',
  UNCLASSIFIED = 'unclassified',
  QUEUED = 'queued',
  RESTING = 'resting',
  PARTIALLY_FILLED = 'partially_filled',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  REJECTED = 'rejected',
  FAILED = 'failed',
}

/**
 * Derived states valid on a `BrokerOrder.derivedState` field.
 * Excludes `LOCAL_ONLY`, `SUBMITTING`, and `PENDING` which are local-only
 * `CaseSummary` states that require no broker order to exist.
 */
export type BrokerOrderDerivedState = Exclude<
  BrokerOrderLifecycleState,
  | BrokerOrderLifecycleState.LOCAL_ONLY
  | BrokerOrderLifecycleState.SUBMITTING
  | BrokerOrderLifecycleState.PENDING
>;

export interface CaseSummary {
  currentStatus: TradingCaseStatus;
  currentOutcome?: string;
  activeBrokerOrderIds: string[];
  latestObservedAt?: string;
  entryState: BrokerOrderLifecycleState;
  protectiveStopState?: BrokerOrderLifecycleState;
  targetExitState?: BrokerOrderLifecycleState;
  targetExitBrokerOrderId?: string;
  filledQuantity?: string;
  remainingQuantity?: string;
  caseProgress?: string;
}

export interface OrderTicket {
  id: string;
  caseId: string;
  accountNumber: string;
  refId: string;
  /** Immutable external Robinhood broker order ID for the entry order, once known. */
  entryBrokerOrderId?: string;
  source: TradingCaseSource;
  sourceRef?: { type: string; id: string };
  signalContext?: TradingSignalContext;
  proposedTerms: ProposedOrderTerms;
  authorization?: OrderAuthorization;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface TradingCase {
  id: string;
  accountNumber: string;
  rootOrderTicket: OrderTicket;
  summary: CaseSummary;
  createdAt: string;
  updatedAt: string;
}
