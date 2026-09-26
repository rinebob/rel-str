/**
 *
 * Shared TypeScript contracts for the paper-trading engine (Blueprint #557).
 *
 * Record kinds live under one root collection `paper-trading` with
 * kind-anchor docs and `items` subcollections — see
 * `shared/paper-trading-ids.ts` for paths and ID builders.
 *
 * The trade doc is the lifecycle aggregate: one doc carries ticket, order,
 * fills, legs, marks, and per-variant exit evaluations so a single trade's
 * full history is readable without cross-collection lookups.
 */

import { OptionType, OptionQuoteSource } from './options-common';
import { TradeSide } from './common';
import type { StrategyInstanceConfig } from './options-strategy-engine-contracts';
import { PaperTradingKind } from './paper-trading-ids';

export { PaperTradingKind } from './paper-trading-ids';

// ── Base ───────────────────────────────────────────────────────────────────

export interface PaperTradingDocBase {
  kind: PaperTradingKind;
  id: string;
  createdAt: string; // ISO
  updatedAt: string;
}

// ── Account ────────────────────────────────────────────────────────────────

/**
 * The paper account — one per user (RH parity: a single account holding
 * positions from every source). Cash is tracked but never enforced;
 * negative balances are permitted and visible.
 */
export interface PaperAccount extends PaperTradingDocBase {
  kind: PaperTradingKind.ACCOUNT;
  userId: string;
  cash: number;
  equity: number;
  realizedPnl: number;
  openTradeCount: number;
}

// ── Trade lifecycle ────────────────────────────────────────────────────────

export enum PaperTradeStatus {
  PENDING = 'PENDING',     // order accepted, awaiting fill (e.g. expression awaiting noon-PT pass)
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  EXPIRED = 'EXPIRED',
  ASSIGNED = 'ASSIGNED',
}

export enum PaperTradeSource {
  STRATEGY = 'strategy',
  SIGNAL = 'signal',
  MANUAL = 'manual',
}

export interface PaperFill {
  fillId: string;
  role: 'entry' | 'exit';
  date: string;                     // market date or ISO timestamp
  price: number;
  quantity: number;
  quoteSource: OptionQuoteSource.RH_MCP | OptionQuoteSource.AV_EOD;
  rawQuoteRef?: string;             // rq- doc id
}

interface PaperTradeLegBase {
  side: TradeSide;
  quantity: number;
  multiplier: number;               // 100 for option legs, 1 for shares
  entryMark: number;
  lastMark: number;
  /**
   * Lifecycle metadata carried for legs migrated from / managed by the
   * options-strategy-engine view. `id` is the human leg id
   * (`CALL-97.50-2026-10-30`); `outcome`/`closeDate` are written at
   * settlement.
   */
  id?: string;
  openDate?: string;
  closeDate?: string;
  outcome?: 'EXPIRED_WORTHLESS' | 'ASSIGNED';
}

/**
 * A trade leg — discriminated union on `kind`. Option legs require the full
 * contract identity; share legs carry none of it.
 */
export type PaperTradeLeg = PaperTradeLegBase & (
  | {
      kind: 'option';
      contractID: string;           // OCC id, e.g. SPY250817P00770000
      type: OptionType;
      strike: number;
      expiration: string;           // ISO date
    }
  | { kind: 'share' }
);

/**
 * Date → mark entry in a trade's `marks` map. Entries may carry only a
 * position mark (engine mark-pass) or only the underlying close (settlement
 * / held-shares updates pre-ledger), so both fields are optional — eval
 * variants must tolerate whichever is present.
 */
export interface PaperMark {
  mark?: number;
  underlyingClose?: number;
}

export interface VariantExitEvent {
  date: string;
  /** Exit-basis per-contract price: today's mark for eval-triggered exits;
   *  0 for worthless expiry; intrinsic value for assignment. */
  price: number;
  pnl: number;
  daysHeld: number;
}

/**
 * One exit variant's independent lifecycle evaluation on a trade. Exactly
 * one run per trade is `governing` (mirrors the real-world constraint that
 * the broker allows one exit type per order); all others are shadow
 * measurement tracks that never touch cash or the position.
 */
export interface VariantRun {
  variantKey: string;
  governing: boolean;
  state: 'ACTIVE' | 'EXITED';
  /**
   * Variant-specific working state. Key conventions per variant:
   * `trailing-stop` writes `lowWaterMark`/`highWaterMark` (side-dependent);
   * `initial-stop`, `time-stop`, and `limit-stddev` keep no working state
   * (`daysHeld` is derived from the entry fill at eval time).
   */
  workingState: Record<string, number>;
  exitEvent?: VariantExitEvent;
}

export interface PaperOrderTerms {
  side: TradeSide;
  type: string;                     // MARKET | LIMIT | ...
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
}

/** Signal provenance for trades accepted from the signal-order page. */
export interface PaperTicket {
  signalId: string;
  refId: string;                    // order-ticket refId (idempotency lineage)
  acceptedAt: string;               // ISO
}

/**
 * The trade lifecycle aggregate — order, fills, legs, marks, and variant
 * evaluations in one doc.
 */
export interface PaperTrade extends PaperTradingDocBase {
  kind: PaperTradingKind.TRADE;
  status: PaperTradeStatus;
  // dimension fields — rollup axes
  source: PaperTradeSource;
  strategyInstanceId?: string;
  cohortId?: string;
  signalId?: string;
  symbol: string;
  expression: string;               // 'EQ' | 'CSP' | 'BCS' | ...
  governingVariant: string;         // variantKey governing the real lifecycle
  // lifecycle payloads
  ticket?: PaperTicket;
  order: PaperOrderTerms;
  fills: PaperFill[];
  legs: PaperTradeLeg[];
  marks: Record<string, PaperMark>; // 'YYYY-MM-DD' → mark
  variantRuns: VariantRun[];
  /** Denormalized `variantRuns[].variantKey` list for array-contains queries. */
  variantKeys: string[];
  realizedPnl: number;
  unrealizedPnl: number;
  capitalRequired?: number;
  /** ISO timestamp of the most recent mark write (engine adapter view). */
  lastMarkedAt?: string;
  /**
   * Verbatim legacy `PositionStatus` for engine-managed trades — preserved so
   * statuses without a PaperTradeStatus equivalent (e.g. COVERED_CALL_OPEN)
   * survive the round-trip.
   */
  legacyStatus?: string;
  /**
   * Assignment outcome — set when a short option expires ITM and the
   * position converts to held shares (ASSIGNED status).
   */
  assignment?: {
    strikePrice: number;
    underlyingCloseAtExpiration: number;
    /** Market date (YYYY-MM-DD) the position was assigned. */
    assignedAt: string;
  };
  /** Held shares after assignment (ASSIGNED status). */
  shares?: {
    quantity: number;
    costBasis: number;
  };
}

// ── Cohort ─────────────────────────────────────────────────────────────────

/**
 * One accepted-as-paper signal fanned out: the underlying trade plus one
 * trade per configured expression template.
 */
export interface PaperCohort extends PaperTradingDocBase {
  kind: PaperTradingKind.COHORT;
  signalId: string;
  symbol: string;
  direction: TradeSide;
  acceptedAt: string;
  tradeIds: string[];
  expressionTemplates: string[];
}

// ── Strategy instance ──────────────────────────────────────────────────────

/** Strategy instance config housed under `paper-trading/instances/items`. */
export interface PaperStrategyInstance extends StrategyInstanceConfig {
  kind: PaperTradingKind.INSTANCE;
  paperAccountId: string;
  governingVariant: string;
}

// ── Exit variants ──────────────────────────────────────────────────────────

export type ExitVariantParams =
  | { type: 'initial-stop'; pct: number }
  | { type: 'trailing-stop'; pct: number }
  | { type: 'time-stop'; days: number }
  | { type: 'limit-stddev'; sdMultiplier: number };

export interface ExitVariantConfig {
  key: string;      // e.g. 'initial-stop-10', 'trailing-20', 'time-30d', 'limit-sd1'
  label: string;
  params: ExitVariantParams;
}

// ── Stats ──────────────────────────────────────────────────────────────────

export interface EquityCurvePoint {
  date: string;
  cumulativePnl: number;
}

/** Rollup stats doc scoped by rollup key (`all`, `inst-{id}`, `var-{key}`, ...). */
export interface PaperStats extends PaperTradingDocBase {
  kind: PaperTradingKind.STATS;
  scope: string;
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  openTradeCount: number;
  closedTradeCount: number;
  maxDrawdown: number;
  equityCurve: EquityCurvePoint[];
  /** Premium-roll metrics carried for the engine stats adapter. */
  totalPremiumCollected?: number;
  assignedCount?: number;
  expiredWorthlessCount?: number;
}

// ── Raw quote ──────────────────────────────────────────────────────────────

/** Audit payload for every contract actually touched (fill or mark). */
export interface RawQuoteDoc extends PaperTradingDocBase {
  kind: PaperTradingKind.RAW_QUOTE;
  tradeId: string;
  date: string;
  rawResponse: unknown;
}

// ── Callable contracts (FE ↔ BE) ───────────────────────────────────────────

/** `paperSignalOrder` request — accept a signal as a paper cohort. */
export interface PaperSignalOrderRequest {
  signalId: string;
  symbol: string;
  direction: TradeSide;
  quantity: number;                 // whole shares from the order ticket sizing
  refId: string;                    // order-ticket idempotency lineage
}

export interface PaperSignalOrderResponse {
  cohortId: string;
  equityTradeId: string;
  pendingExpressionTradeIds: string[];
}

/** `listPaperTrades` request — all filters optional AND-combined. */
export interface ListPaperTradesRequest {
  status?: PaperTradeStatus;
  source?: PaperTradeSource;
  strategyInstanceId?: string;
  cohortId?: string;
  signalId?: string;
  symbol?: string;
  expression?: string;
  variantKey?: string;
}

export interface ListPaperTradesResponse {
  trades: PaperTrade[];
}

export interface GetPaperStatsRequest {
  scope?: string;                   // defaults to 'all'
}

export interface GetPaperStatsResponse {
  stats: PaperStats[];
}

export interface GetPaperAccountResponse {
  account: PaperAccount | null;
}

export interface ListExitVariantsResponse {
  variants: ExitVariantConfig[];
}

// ── Union + guards ─────────────────────────────────────────────────────────

export type PaperTradingDoc =
  | PaperAccount
  | PaperTrade
  | PaperCohort
  | PaperStrategyInstance
  | PaperStats
  | RawQuoteDoc;

export function isPaperAccount(d: PaperTradingDoc): d is PaperAccount {
  return d.kind === PaperTradingKind.ACCOUNT;
}
export function isPaperTrade(d: PaperTradingDoc): d is PaperTrade {
  return d.kind === PaperTradingKind.TRADE;
}
export function isPaperCohort(d: PaperTradingDoc): d is PaperCohort {
  return d.kind === PaperTradingKind.COHORT;
}
export function isPaperStats(d: PaperTradingDoc): d is PaperStats {
  return d.kind === PaperTradingKind.STATS;
}
export function isPaperStrategyInstance(d: PaperTradingDoc): d is PaperStrategyInstance {
  return d.kind === PaperTradingKind.INSTANCE;
}
export function isRawQuoteDoc(d: PaperTradingDoc): d is RawQuoteDoc {
  return d.kind === PaperTradingKind.RAW_QUOTE;
}
