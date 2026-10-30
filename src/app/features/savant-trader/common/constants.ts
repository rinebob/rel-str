/**
 * Shared Savant Trader constants and enums.
 *
 * Keep cross-cutting Savant Trader types here so they can be imported by
 * stores, services, and components without circular dependencies.
 */

import { SignalDirection } from '../../shared/constants/signal-direction';
export { SignalDirection };

// #1017 — the PACR review-decision vocabulary (ReviewDecision,
// ALL_REVIEW_STATUSES, StatusCounts, DECISION_*_DAYS) was removed with
// the ACR workflow; ticket existence is the decision now.

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
 * Scan latest-run sources join as 'scan:{recipeId}' keys (#1232/#1256).
 */
export type SymbolListFilter = 'ALL' | typeof NO_MEMBERSHIP | (string & {});

/** Prefix marking a Scan Latest Run source in a filter/source key. */
export const SCAN_SOURCE_PREFIX = 'scan:';

/**
 * True when a source key selects a Scan Latest Run rather than a symbol
 * list. List keys can never collide — user list keys can't contain ':'.
 */
export function isScanSource(key: string): boolean {
  return key.startsWith(SCAN_SOURCE_PREFIX);
}

/** Parse 'scan:{recipeId}' back to the recipe id; null for non-scan keys. */
export function scanSourceRecipeId(key: string): string | null {
  return isScanSource(key) ? key.slice(SCAN_SOURCE_PREFIX.length) : null;
}

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