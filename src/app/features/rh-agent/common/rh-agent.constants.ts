/**
 * Shared RH Agent constants and enums.
 *
 * Keep cross-cutting RH Agent types here so they can be imported by
 * stores, services, and components without circular dependencies.
 */

/** Daily PACR review status for a symbol. */
export type RhReviewStatus =
  | 'PENDING'
  | 'PROMOTE'
  | 'ACCEPT'
  | 'CONSIDER'
  | 'REJECT'
  | 'EXCLUDE'
  | 'LOW_TRADABILITY'
  | 'WATCH'
  | 'ELEVATE';

/** All PACR review statuses in display order. */
export const ALL_REVIEW_STATUSES: RhReviewStatus[] = [
  'PENDING',
  'PROMOTE',
  'ACCEPT',
  'CONSIDER',
  'REJECT',
  'EXCLUDE',
  'LOW_TRADABILITY',
  'WATCH',
  'ELEVATE',
];

/** Concrete count shape so templates can use dot access (e.g. counts.PROMOTE). */
export type StatusCounts = {
  PENDING: number;
  PROMOTE: number;
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
}

/** All built-in symbol list names in display order. */
export const ALL_SYMBOL_LIST_NAMES: RhSymbolListName[] = [
  RhSymbolListName.PRIMARY,
  RhSymbolListName.SECONDARY,
  RhSymbolListName.NEUTRAL,
  RhSymbolListName.AVOID,
  RhSymbolListName.HIDE,
];

/** Symbol type classification for the trading universe. */
export type SymbolType = 'STOCK' | 'ETF' | 'FUTURE' | 'FOREX' | 'CRYPTO' | 'OTHER';
