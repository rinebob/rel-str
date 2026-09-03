/**
 * Shared Savant Trader constants and enums.
 *
 * Keep cross-cutting Savant Trader types here so they can be imported by
 * stores, services, and components without circular dependencies.
 */

import { SignalDirection } from '../../shared/constants/signal-direction';
export { SignalDirection };

/** Daily PACR review status for a symbol. */
export enum ReviewDecision {
  PENDING        = 'PENDING',
  REVIEW         = 'REVIEW',
  ACCEPT         = 'ACCEPT',
  CONSIDER       = 'CONSIDER',
  REJECT         = 'REJECT',
  EXCLUDE        = 'EXCLUDE',
  LOW_TRADABILITY = 'LOW_TRADABILITY',
  WATCH          = 'WATCH',
}

/** All PACR review statuses in display order. */
export const ALL_REVIEW_STATUSES: ReviewDecision[] = [
  ReviewDecision.PENDING,
  ReviewDecision.REVIEW,
  ReviewDecision.ACCEPT,
  ReviewDecision.CONSIDER,
  ReviewDecision.REJECT,
  ReviewDecision.EXCLUDE,
  ReviewDecision.LOW_TRADABILITY,
  ReviewDecision.WATCH,
];

/** Concrete count shape so templates can use dot access (e.g. counts.REVIEW). */
export type StatusCounts = {
  PENDING: number;
  REVIEW: number;
  ACCEPT: number;
  CONSIDER: number;
  REJECT: number;
  EXCLUDE: number;
  LOW_TRADABILITY: number;
  WATCH: number;
};

/** Canonical names for the built-in user-managed symbol lists. */
export enum SymbolListName {
  NONE = 'NONE',
  PRIMARY = 'PRIMARY',
  SECONDARY = 'SECONDARY',
  NEUTRAL = 'NEUTRAL',
  AVOID = 'AVOID',
  HIDE = 'HIDE',
  PAST_SIGNALS = 'PAST_SIGNALS',
}

/** All built-in symbol list names in display order. */
export const ALL_SYMBOL_LIST_NAMES: SymbolListName[] = [
  SymbolListName.PRIMARY,
  SymbolListName.SECONDARY,
  SymbolListName.NEUTRAL,
  SymbolListName.AVOID,
  SymbolListName.HIDE,
  SymbolListName.PAST_SIGNALS,
];

/** Symbol type classification for the trading universe. */
export type SymbolType = 'STOCK' | 'ETF' | 'FUTURE' | 'FOREX' | 'CRYPTO' | 'OTHER';

/** Dimensions available for grouping the symbol list in the grouped review. */
export enum GroupDimension {
  SECTOR = 'sector',
  INDUSTRY = 'industry',
  MARKET_CAP_TIER = 'marketCapTier',
}

/** Signal timeframe filter options. */
export enum SignalTimeframe {
  ALL = 'ALL',
  DAILY = 'D',
  WEEKLY = 'W',
}

/** Signal persistence status. */
export enum SignalStatus {
  INTERIM = 'INTERIM',
  CONFIRMED = 'CONFIRMED',
}

/** Active timeframe + direction filter for the signal review page. */
export interface SignalFilter {
  timeframe: SignalTimeframe;
  direction: SignalDirection;
}

export const SIGNAL_FILTER_ALL: SignalFilter = {
  timeframe: SignalTimeframe.ALL,
  direction: SignalDirection.ALL,
};

/** Filter by who triggered the run. */
export enum RunTriggerFilter {
  ALL      = 'all',
  MANUAL   = 'manual',
  PDR      = 'pdr',
  NIGHTLY  = 'nightly',
}

/** Filter by run date range. */
export enum RunDateFilter {
  TODAY = 'today',
  WEEK  = 'week',
  ALL   = 'all',
}

/** Filter by run status. */
export enum RunStatusFilter {
  ALL     = 'all',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED  = 'failed',
  PARTIAL = 'partial',
}

/** Viewport mode for the chart-review sidebar. */
export type ViewportMode = 'signals' | 'browse';

// ---------------------------------------------------------------------------
// Occurrence decision retention
// ---------------------------------------------------------------------------

/**
 * Number of days of occurrence decisions to load for the signal review UI.
 * Decisions older than this window are not fetched but may still exist in
 * Firestore until the TTL cleanup removes them. Change this value to adjust
 * how far back the signal review page looks.
 */
export const DECISION_FETCH_DAYS = 3;

/**
 * Age in days after which occurrence decisions are eligible for TTL deletion
 * by the scheduled cleanup function. Kept longer than `DECISION_FETCH_DAYS`
 * so there is a buffer between what the UI shows and what the DB retains.
 */
export const DECISION_TTL_DAYS = 7;
