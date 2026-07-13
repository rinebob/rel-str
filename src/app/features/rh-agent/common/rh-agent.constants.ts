/**
 * Shared RH Agent constants and enums.
 *
 * Keep cross-cutting RH Agent types here so they can be imported by
 * stores, services, and components without circular dependencies.
 */

/** Daily PACR review status for a symbol. */
export enum RhReviewStatus {
  PENDING        = 'PENDING',
  REVIEW         = 'REVIEW',
  ACCEPT         = 'ACCEPT',
  CONSIDER       = 'CONSIDER',
  REJECT         = 'REJECT',
  EXCLUDE        = 'EXCLUDE',
  LOW_TRADABILITY = 'LOW_TRADABILITY',
  WATCH          = 'WATCH',
  ELEVATE        = 'ELEVATE',
}

/** All PACR review statuses in display order. */
export const ALL_REVIEW_STATUSES: RhReviewStatus[] = [
  RhReviewStatus.PENDING,
  RhReviewStatus.REVIEW,
  RhReviewStatus.ACCEPT,
  RhReviewStatus.CONSIDER,
  RhReviewStatus.REJECT,
  RhReviewStatus.EXCLUDE,
  RhReviewStatus.LOW_TRADABILITY,
  RhReviewStatus.WATCH,
  RhReviewStatus.ELEVATE,
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
  ELEVATE: number;
};

/** Canonical names for the built-in user-managed symbol lists. */
export enum RhSymbolListName {
  PRIMARY = 'PRIMARY',
  SECONDARY = 'SECONDARY',
  NEUTRAL = 'NEUTRAL',
  AVOID = 'AVOID',
  HIDE = 'HIDE',
  PAST_SIGNALS = 'PAST_SIGNALS',
}

/** All built-in symbol list names in display order. */
export const ALL_SYMBOL_LIST_NAMES: RhSymbolListName[] = [
  RhSymbolListName.PRIMARY,
  RhSymbolListName.SECONDARY,
  RhSymbolListName.NEUTRAL,
  RhSymbolListName.AVOID,
  RhSymbolListName.HIDE,
  RhSymbolListName.PAST_SIGNALS,
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

/** Signal direction filter options. */
export enum SignalDirection {
  ALL = 'ALL',
  LONG = 'LONG',
  SHORT = 'SHORT',
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
export enum RhAgentRunTriggerFilter {
  ALL      = 'all',
  MANUAL   = 'manual',
  PDR      = 'pdr',
  NIGHTLY  = 'nightly',
}

/** Filter by run date range. */
export enum RhAgentRunDateFilter {
  TODAY = 'today',
  WEEK  = 'week',
  ALL   = 'all',
}

/** Filter by run status. */
export enum RhAgentRunStatusFilter {
  ALL     = 'all',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED  = 'failed',
  PARTIAL = 'partial',
}
