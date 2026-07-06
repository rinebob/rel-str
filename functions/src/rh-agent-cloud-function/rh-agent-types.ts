/**
 * Side-effect-free shared types for the RH Agent cloud function.
 *
 * These types are intentionally kept in a file with no runtime imports (no
 * firebase-admin, no firebase-functions, no external side effects) so they can be
 * safely imported by backfill scripts, unit tests, and other pure consumers.
 */

/**
 * Compact OHLCV bar shape used by symbol-data storage and RH Agent indicator/signal
 * computation. Fields are single-letter to keep Firestore documents small.
 */
export interface OhlcBar {
  d: string;   // YYYY-MM-DD
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}
