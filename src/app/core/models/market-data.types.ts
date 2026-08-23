/**
 * Shared market-data types (frontend mirror of functions/src/common/market-data-types.ts).
 *
 * Kept in core/models/ so any feature service can import without layering violations.
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
  barStatus?: -1 | 0 | 1;  // SA interim/end-of-period flag (-1 opening, 0 interim, 1 final)
}

/** Firestore doc shape for daily/{year}, weekly/all, monthly/all. */
export interface OhlcBarsDoc {
  bars: OhlcBar[];
}
