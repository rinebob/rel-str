/**
 * Broker Order record types — raw adapter output, local mirror, unmatched,
 * and Symbol Position.
 *
 * Framework-free so frontend and functions backend can share the domain seam.
 */

import type {
  BrokerOrderDerivedState,
  BrokerOrderLifecycleState,
  BrokerOrderRole,
  InstrumentSpecificDetails,
  OrderTicket,
  TradingCase,
  TradingInstrumentType,
} from './types.ts';

/**
 * Raw normalized broker facts before local case enrichment.
 * `brokerOrderId` is the immutable external Robinhood identity.
 * Adapter methods must not fabricate local fields (caseId, refId, local IDs).
 */
export interface RawBrokerOrder {
  /** Immutable external Robinhood broker order ID — the upsert authority. */
  brokerOrderId: string;
  refId?: string;
  accountNumber: string;
  instrumentType: TradingInstrumentType;
  symbol?: string;
  instrumentId?: string;
  side: 'buy' | 'sell';
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
  /** Instrument-specific details for non-equity instruments (options legs, etc.). */
  instrumentSpecific?: InstrumentSpecificDetails;
}

/** Local enriched Broker Order mirror; `id` is the human-readable local document ID. */
export interface BrokerOrder extends RawBrokerOrder {
  id: string;
  caseId: string;
  role: BrokerOrderRole;
  derivedState: BrokerOrderDerivedState;
  updatedAt: string;
  lastObservedAt: string;
  parentBrokerOrderId?: string;
  replacesBrokerOrderId?: string;
}

/**
 * Unmatched broker order discovered without a local ticket.
 * Local metadata is intentionally absent; adoption assigns a caseId later.
 */
export interface UnmatchedBrokerOrder extends RawBrokerOrder {
  role: BrokerOrderRole.UNMATCHED;
}

/** Durable Firestore mirror of a Broker Order. */
export interface BrokerOrderMirror extends BrokerOrder {
  kind: 'broker-order-mirror';
  mirrorVersion: number;
}

// ---------------------------------------------------------------------------
// Symbol Position
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

/**
 * Local aggregate Symbol Position. This is a local projection, not a broker
 * mirror — it extends raw position facts with local-only case linkage and
 * protection state. No `mirrorVersion` because positions are recomputed, not
 * versioned snapshots.
 */
export interface SymbolPosition extends RawSymbolPosition {
  caseIds: string[];
  protectionState?: 'protected' | 'drifted' | 'unprotected';
}

// ---------------------------------------------------------------------------
// Reconciliation snapshot and pagination
// ---------------------------------------------------------------------------

export interface ReconciliationOptions {
  forceRefresh?: boolean;
  since?: string;
  cursor?: string;
  limit?: number;
  timeoutMs?: number;
  staleAfter?: string;
  brokerOrderId?: string;
  state?: BrokerOrderLifecycleState | string;
  symbol?: string;
  agent?: string;
}

export interface ReconciliationSnapshot {
  orderRows: BrokerOrderMirror[];
  positionRows: SymbolPosition[];
  unmatchedBrokerOrders: UnmatchedBrokerOrder[];
  ambiguousLocalTickets: OrderTicket[];
  syncMetadata: {
    tickets: 'available' | 'stale' | 'unavailable';
    brokerOrders: 'available' | 'stale' | 'unavailable';
    positions: 'available' | 'stale' | 'unavailable';
    observedAt: string;
  };
}

export interface BrokerOrderPage {
  orders: RawBrokerOrder[];
  nextCursor?: string;
}

export interface RawSymbolPositionPage {
  positions: RawSymbolPosition[];
  nextCursor?: string;
}

// ---------------------------------------------------------------------------
// Shared interfaces
// ---------------------------------------------------------------------------

export interface BrokerOrderAdapter {
  listOrders(accountNumber: string, options?: ReconciliationOptions): Promise<BrokerOrderPage>;
  getOrder(accountNumber: string, brokerOrderId: string): Promise<RawBrokerOrder | null>;
  listPositions(accountNumber: string, options?: ReconciliationOptions): Promise<RawSymbolPositionPage>;
}

/**
 * Order Ticket repository. `saveTicket` is an upsert (create or replace).
 * Archiving is handled by setting `archivedAt` on the ticket before saving.
 */
export interface OrderTicketRepository {
  loadTickets(accountNumber: string): Promise<OrderTicket[]>;
  saveTicket(ticket: OrderTicket): Promise<void>;
}

export interface TradingCaseRepository {
  loadCases(accountNumber: string): Promise<TradingCase[]>;
  saveCase(tradingCase: TradingCase): Promise<void>;
}

/**
 * Broker Order mirror repository.
 * `upsert` is idempotent by `accountNumber` + `brokerOrderId` — the immutable
 * external Robinhood identity. The human-readable `id` field is for Firestore
 * document keying and UI traceability only, not the upsert authority.
 */
export interface BrokerOrderMirrorRepository {
  upsert(order: BrokerOrderMirror): Promise<void>;
  load(accountNumber: string): Promise<BrokerOrderMirror[]>;
}

export interface ReconciliationModule {
  reconcile(accountNumber: string, options?: ReconciliationOptions): Promise<ReconciliationSnapshot>;
}
