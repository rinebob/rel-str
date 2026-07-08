/**
 * Shared market-data types used across the backend.
 *
 * Kept in a neutral common directory so modules like symbol-data (the shared
 * SOT) do not depend on feature-specific type files such as rh-agent-types.
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
