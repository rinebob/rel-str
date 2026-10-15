/**
 * @topic #984 — ST Firestore Reorg (task #998)
 *
 * Canonical `st-order-tickets` shape — the universal order ticket connecting
 * signals, programs, and manual actions to live or paper execution
 * (`{liv|pap}_{id}` doc ids). Single source for BE (functions) and FE
 * (Angular) via the `@st/order-tickets` path alias.
 *
 * `side`/`instrument` reuse the same value sets as the legacy OrderSide /
 * InstrumentType enums — these are the canonical spellings per #984.
 */
import type { StMode } from './st-types';
import type { SignalExpressionTemplate } from './paper-trading-contracts';
import type { OrderIntentTrackingFields } from './screenshot-capture-contracts';
export type { StMode } from './st-types';

/** What originated the ticket. */
export type StTicketOriginType = 'signal' | 'program' | 'manual' | 'management';
export const ST_TICKET_ORIGIN_TYPES: readonly StTicketOriginType[] = [
  'signal', 'program', 'manual', 'management',
];

/**
 * Ticket lifecycle. 'failed' is the terminal state for a rejected/errored
 * submit (reason in `lastError`); 'expired' is reached by time-in-force
 * orders the broker expired without a fill. Paper tickets never leave
 * BE state transitions — they don't touch the broker.
 */
export type StTicketState =
  | 'staged' | 'submitted' | 'cancel_pending' | 'filled' | 'cancelled'
  | 'expired' | 'failed';
export const ST_TICKET_STATES: readonly StTicketState[] = [
  'staged', 'submitted', 'cancel_pending', 'filled', 'cancelled', 'expired', 'failed',
];

/** Broker-facing direction (orders buy/sell; positions are long/short). */
export type StTicketSide = 'buy' | 'sell';
export const ST_TICKET_SIDES: readonly StTicketSide[] = ['buy', 'sell'];

export type StTicketInstrument = 'equity' | 'etf' | 'option';
export const ST_TICKET_INSTRUMENTS: readonly StTicketInstrument[] = [
  'equity', 'etf', 'option',
];

export type StTicketOrderType = 'market' | 'limit' | 'stop_market' | 'stop_limit' | 'stop_loss';
export type StTicketTimeInForce = 'gfd' | 'gtc';
export type StTicketMarketHours = 'regular_hours' | 'extended_hours' | 'all_day_hours';

export interface StTicketOrigin {
  type: StTicketOriginType;
  /** st-signals doc id — set when type='signal'. */
  signalId?: string;
  /** st-strategy-instances doc id — set when type='program'. */
  instanceId?: string;
  /** st-runs doc id — provenance for signal/program tickets. */
  runId?: string;
  /** st-position-groups doc id — set when type='management'. */
  positionGroupId?: string;
}

export interface StTicketLimits {
  limitPrice?: number;
  stopPrice?: number;
}

/**
 * One option leg on an option ticket (v1 single-leg). Mirrors the legacy
 * OptionLeg — `occSymbol` is display only; `optionId` is the RH ordering
 * identity.
 */
export interface StTicketLeg {
  side: StTicketSide;
  /** OCC contract symbol — display only. */
  occSymbol: string;
  /** RH instrument UUID — ordering identity. */
  optionId: string;
  positionEffect: 'open' | 'close';
  /** Multi-leg ratio — reserved; v1 single-leg omits it. */
  ratioQuantity?: number;
}

/** Tax lot selection for sell orders specifying lots. */
export interface StTicketTaxLot {
  lotId: string;
  quantity: string;
}

export interface StTicketTerms {
  /** Ticker being ordered — e.g. 'ADPT' (always required, incl. options:
   *  the underlying symbol, not the OCC contract id). */
  symbol: string;
  side: StTicketSide;
  instrument?: StTicketInstrument;
  /** Option legs — required for live option orders (v1 single-leg). */
  legs?: StTicketLeg[];
  /** Contract-selection recipe carried by staged expression tickets until
   *  the fill pass resolves a real contract (was PaperTrade.expressionTemplate). */
  expressionTemplate?: SignalExpressionTemplate;
  /** Option-expression code resolved at fill time ('EQ' | 'CSP' | 'LC' | ...). */
  expression?: string;
  /** Shares/contracts — mutually exclusive with dollarAmount. */
  quantity?: number;
  /** Notional dollars — mutually exclusive with quantity. */
  dollarAmount?: number;
  limits?: StTicketLimits;
  orderType?: StTicketOrderType;
  timeInForce?: StTicketTimeInForce;
  marketHours?: StTicketMarketHours;
  /** Sell orders specifying lots. */
  taxLots?: StTicketTaxLot[];
}

/** Signal-lineage fields carried through the order-intents migration —
 *  the parts of legacy signalContext the st- model doesn't already cover
 *  via origin.signalId. */
export interface StTicketSignalContext {
  signalType?: string;
  barDate?: string;
  timeframe?: string;
  direction?: string;
  /** Occurrence-decision doc id(s) this ticket staged from (dedupe #719). */
  decisionId?: string;
  decisionIds?: string[];
  /** Close price at signal generation. */
  signalPrice?: number;
}

/** Broker/signal review snapshot captured at staging. */
export interface StTicketReviewSnapshot {
  orderChecks?: unknown;
  collateral?: unknown;
}

export interface StTicketFillSummary {
  averagePrice: number;
  filledQty: number;
  filledAt: string;               // ISO
}

export interface StTicketError {
  category: string;
  message: string;
}

/**
 * Universal order ticket (`st-order-tickets/{liv|pap}_{id}`).
 * Pending expression intent lives here — trade docs are created only after
 * contract resolution.
 */
export interface StOrderTicket {
  /** `{liv|pap}_{id}` — live/paper prefix mirrors `mode`. */
  id: string;
  origin: StTicketOrigin;
  /** True when staged by an automated flow (signal accept, program pass). */
  auto: boolean;
  mode: StMode;
  terms: StTicketTerms;
  state: StTicketState;
  /** Robinhood ref_id idempotency key — generated at staging. */
  refId: string;
  /** Broker order id — live mode only. */
  brokerOrderId?: string;
  reviewSnapshot?: StTicketReviewSnapshot;
  fillSummary?: StTicketFillSummary;
  lastError?: StTicketError;
  /** Live account number or paper account id the ticket targets. */
  accountTarget: string;
  userId: string;
  /** Allocation-bucket doc id — seeds position attribution at fill (#592). */
  bucketId?: string;
  /** Signal lineage migrated from legacy order-intents docs. */
  signalContext?: StTicketSignalContext;
  /** Screenshot-capture ledger fields read by functions/screenshot-capture
   *  tracking — preserved through the order-intents migration. */
  tracking?: OrderIntentTrackingFields;
  /** RH-derived terminal-state timestamp (reconciliation; recency filters). */
  terminalAt?: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  filledAt?: string;
  cancelledAt?: string;
}

/**
 * Terms validation — sizing is exactly one of quantity or dollarAmount,
 * and both must be positive finite numbers (quantity also integral).
 * Throws on violation (writer-side gate before staging).
 */
export function validateStTicketTerms(terms: StTicketTerms): void {
  const { quantity, dollarAmount } = terms;
  if (quantity != null && dollarAmount != null) {
    throw new Error('ticket terms: quantity and dollarAmount are mutually exclusive');
  }
  if (quantity == null && dollarAmount == null) {
    throw new Error('ticket terms: either quantity or dollarAmount is required');
  }
  if (quantity != null && (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity))) {
    throw new Error('ticket terms: quantity must be a positive integer');
  }
  if (dollarAmount != null && (!Number.isFinite(dollarAmount) || dollarAmount <= 0)) {
    throw new Error('ticket terms: dollarAmount must be positive and finite');
  }
}
