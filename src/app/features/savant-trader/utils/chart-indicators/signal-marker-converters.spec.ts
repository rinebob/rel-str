/**
 * signal-marker-converters — occurrenceMarkersFromReview (#1655)
 *
 * The symbol-review pane plots EVERY bundle occurrence as a dot offset
 * from its signal bar — the price-pane convention shared with the
 * zone/trend-rider dots: longs sit BELOW the bar, shorts ABOVE, at
 * 2.5×ATR(14) clearance (a dot at the close hides inside the candle).
 * Checked rows (ledger members) keep the family hue; unchecked rows
 * render solid gray — a visible distinction, not a dim.
 * Occurrences whose signal bar predates the cached bar range simply
 * don't plot — the list still renders them (documented non-error).
 */
import { occurrenceMarkersFromReview } from './signal-marker-converters';
import {
  ST_SIGNAL_DOT_COLORS,
  ST_UPTICK_DOT_COLORS,
} from '@flex-chart/indicator-visuals';
import { TradeSide } from '@common';
import type { SignalReviewOccurrence } from '@paper-trading/contracts';
import { toDatePt } from '../../utils/utils';



const occ = (over: Partial<SignalReviewOccurrence> = {}): SignalReviewOccurrence => ({
  occurrenceId: 'AAPL_2026-11-14_D_ST_TREND_RIDER_V2_LONG',
  symbol: 'AAPL',
  signalType: 'D_ST_TREND_RIDER_V2_LONG',
  signalBarDate: '2026-11-14',
  signalTimeframe: 'D',
  direction: TradeSide.LONG,
  signalStatus: 'CONFIRMED',
  signalIndicators: {},
  sourceRunId: 'run-1',
  checked: true,
  ...over,
});

const bar = (date: string, close = 100, high = close, low = close) => ({
  date,
  x: new Date(`${date}T00:00:00Z`),
  open: close,
  high,
  low,
  close,
});

describe('occurrenceMarkersFromReview', () => {
  it('plots a long dot below the bar and a short dot above, at 5×ATR — the outer review band', () => {
    // Two equal-range bars → ATR seed = 10 → offset = 50 (2× the 2.5×ATR
    // zone-dot band so occurrence markers never coincide with zone dots).
    const bars = [bar('2026-11-13', 350, 355, 345), bar('2026-11-14', 355, 360, 350)];
    const long = occurrenceMarkersFromReview(
      [occ({ signalBarDate: '2026-11-14', direction: TradeSide.LONG })],
      bars,
    );
    const short = occurrenceMarkersFromReview(
      [occ({ signalBarDate: '2026-11-14', direction: TradeSide.SHORT })],
      bars,
    );
    expect(long).toHaveLength(1);
    expect(long[0].x).toEqual(toDatePt('2026-11-14'));
    expect(long[0].y).toBe(300); // low 350 − 5×TR(10)
    expect(short[0].y).toBe(410); // high 360 + 5×TR(10)
  });

  it('skips occurrences outside the cached bar range — documented non-error', () => {
    const pts = occurrenceMarkersFromReview(
      [occ({ signalBarDate: '2020-01-02' })],
      [bar('2026-11-14')],
    );
    expect(pts).toEqual([]);
  });

  it('checked occurrences render family hue; unchecked render solid gray', () => {
    const pts = occurrenceMarkersFromReview(
      [
        occ({ occurrenceId: 'c', signalType: 'D_ST_TREND_RIDER_V1_LONG', direction: TradeSide.LONG, checked: true }),
        occ({ occurrenceId: 'u', signalType: 'D_ST_TREND_RIDER_V1_LONG', direction: TradeSide.LONG, checked: false }),
      ],
      [bar('2026-11-14')],
    );
    expect(pts.map(p => p.color)).toEqual([
      ST_UPTICK_DOT_COLORS.v1Long,
      '#9e9e9e',
    ]);
  });

  it('follows the V2 dot family for V2 signal types', () => {
    const pts = occurrenceMarkersFromReview(
      [occ({ signalType: 'D_ST_TREND_RIDER_V2_SHORT', direction: TradeSide.SHORT, checked: true })],
      [bar('2026-11-14')],
    );
    expect(pts[0].color).toBe(ST_UPTICK_DOT_COLORS.v2Short);
  });

  it('non-Rider signal types fall back to the signal-dot palette by direction', () => {
    // 'D_ZONE_FLIP_LONG' carries no _V1_/_V2_ token — the family match
    // can't produce this color, so the fallback is the only path.
    const pts = occurrenceMarkersFromReview(
      [occ({ signalType: 'D_ZONE_FLIP_LONG', direction: TradeSide.LONG, checked: true })],
      [bar('2026-11-14')],
    );
    expect(pts[0].color).toBe(ST_SIGNAL_DOT_COLORS.long);
  });

  it('empty occurrences or empty bars yields no points', () => {
    expect(occurrenceMarkersFromReview([], [bar('2026-11-14')])).toEqual([]);
    expect(occurrenceMarkersFromReview([occ()], [])).toEqual([]);
  });
});
