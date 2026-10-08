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

/**
 * Filter value for the "Not triaged" option — symbols that belong to zero
 * EXCLUSIVE (triage) lists, i.e. untriaged. Membership in non-exclusive lists
 * (MONITOR, user lists) does not count: the filter exists to feed the triage
 * review loop. 'ALL' is the shared "no list filter applied" sentinel —
 * every surface uses the same value (labels may differ per surface).
 */
export const NO_MEMBERSHIP = 'NO_MEMBERSHIP';

/**
 * True when a list-filter value resolves against the live catalog — 'ALL'
 * and NO_MEMBERSHIP are always valid; any other value must be a current
 * list key. Surfaces use this to fall back to their show-everything anchor
 * when a stored filter references a deleted list.
 */
export function isLiveListFilter(
  filter: string,
  hasListKey: (key: string) => boolean,
): boolean {
  return filter === 'ALL' || filter === NO_MEMBERSHIP || hasListKey(filter);
}

/**
 * Union of every value a list-filter dropdown can emit — system list keys,
 * the 'ALL' sentinel, NO_MEMBERSHIP, and arbitrary user-list keys
 * (`string & {}` widens the union without losing literal autocomplete).
 */
export type SymbolListFilter = 'ALL' | typeof NO_MEMBERSHIP | (string & {});

/** Symbol type classification for the trading universe. */
export type SymbolType = 'STOCK' | 'ETF' | 'FUTURE' | 'FOREX' | 'CRYPTO' | 'OTHER';

/** Dimensions available for grouping the symbol list in the grouped review.
 *  NONE is a gallery-only flat-mode sentinel (#820), not a real dimension —
 *  grouping code throws on it (see getGroupKey). */
export enum GroupDimension {
  SECTOR = 'sector',
  INDUSTRY = 'industry',
  MARKET_CAP_TIER = 'marketCapTier',
  /** Flat gallery — no expando grouping, cards sorted market-cap desc (#820). */
  NONE = 'none',
}

/** Signal timeframe filter options. */
export enum SignalTimeframe {
  ALL = 'ALL',
  DAILY = 'D',
  WEEKLY = 'W',
}

/** Gallery card-chart interval — a strict subset of SignalTimeframe; ALL is
 *  meaningless as a chart interval (#819: keeps the decoupled chart toggle
 *  from silently rendering daily under no-active-pill). */
export type CardChartTimeframe = SignalTimeframe.DAILY | SignalTimeframe.WEEKLY;

/** Default card-chart interval — the header Chart toggle and ui-store both
 *  start on daily (#819 r2: single source for the repeated DAILY literal). */
export const DEFAULT_CARD_CHART_TIMEFRAME: CardChartTimeframe = SignalTimeframe.DAILY;

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
