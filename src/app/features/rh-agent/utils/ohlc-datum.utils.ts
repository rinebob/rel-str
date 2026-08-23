import type { OhlcBar } from '../../../core/models/market-data.types';
import type { OHLCDatum } from '../../shared/types/rs.interfaces';

/** Convert OhlcBar (local Firestore shape) to OHLCDatum (chart shape).
 *  Filters out bars with invalid close (matching old RsBarsService behavior)
 *  and falls back to close for missing open/high/low. */
export function toOHLCDatum(bars: OhlcBar[]): OHLCDatum[] {
  return bars
    .filter(b => Number.isFinite(b.c) && b.c > 0)
    .map(b => ({
      x: new Date(`${b.d}T00:00:00.000Z`),
      date: b.d,
      open: Number.isFinite(b.o) ? b.o : b.c,
      high: Number.isFinite(b.h) ? b.h : b.c,
      low: Number.isFinite(b.l) ? b.l : b.c,
      close: b.c,
      volume: b.v,
    }));
}
