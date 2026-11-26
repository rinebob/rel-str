/**
 * Savant Trader Chart Indicators â€” Callable signal marker conversion
 *
 * Converts backend pre-computed signal markers (trend-strength dots, zone
 * uptick dots, HTF zone windows) into chart-ready scatter-point arrays.
 */
import { ChartIntervalKey } from '../../../../features/shared/components/flex-chart/flex-chart.types';
import {
  ATR_OFFSET_MULT,
  computeATR,
} from '../../../../features/shared/components/flex-chart/indicators/st-trend-rider-dots.indicator';
import type { StSignalItem } from '../../services/st.service';
import type { IntervalData } from '../../common/indicator.types';
import type { PriceBar } from '../../../heatmap-chart/heatmap-chart.types';
import { toDatePt } from '../../utils/utils';
import type { ChartScatterPoint } from './base-indicators';
import { UptickDotColors } from './base-indicators';
import {
  isTriggerBandsSignalType,
  ST_SIGNAL_DOT_COLORS,
  ST_TRIGGER_BANDS_DOT_COLORS,
  ST_UPTICK_DOT_COLORS,
} from '@flex-chart/indicator-visuals';
import type { SignalReviewOccurrence } from '@paper-trading/contracts';
import { TradeSide } from '@common';

const SIGNAL_DOT_LONG_COLOR = ST_SIGNAL_DOT_COLORS.long;
const SIGNAL_DOT_SHORT_COLOR = ST_SIGNAL_DOT_COLORS.short;

/** Index bars by `date` (YYYY-MM-DD) — the lookup every signal-bar→dot
 *  converter shares. Carries the array index too: dot placement needs
 *  `atr[idx]`, which is position-addressed, not date-addressed. */
function barIndexByDate(bars: PriceBar[]): Map<string, { bar: PriceBar; idx: number }> {
  const map = new Map<string, { bar: PriceBar; idx: number }>();
  bars.forEach((b, idx) => {
    if (b.date) map.set(b.date.slice(0, 10), { bar: b, idx });
  });
  return map;
}

/** Dot y for a signal bar — the price-pane convention shared with the
 *  zone/trend-rider dots: longs sit BELOW the bar, shorts ABOVE it, at
 *  `mult`×ATR(14) clearance so the dot never hides inside the candle. */
function signalDotY(bar: PriceBar, idx: number, atr: number[], isLong: boolean, mult = ATR_OFFSET_MULT): number {
  const offset = atr[idx] * mult;
  return isLong ? bar.low - offset : bar.high + offset;
}

/** Review-occurrence dots ride at TWICE the zone-dot offset — a persisted
 *  occurrence is almost always coincident with a computed zone dot at the
 *  same 2.5×ATR position in the same family hue, so sharing the offset
 *  makes the marker invisible (a ghost dot on a solid dot reads solid).
 *  The outer band keeps the overlay separable from the detector layer. */
const REVIEW_DOT_ATR_MULT = ATR_OFFSET_MULT * 2;

/**
 * Convert StSignalItem[] from signal-history into chart dot points.
 * Matches each signal's barDate to a price bar to get the y-coordinate (close price).
 * Filters by signalType prefix (e.g. 'D_ZONE_V1' for V1 daily dots).
 */
export function uptickDotsFromHistory(
  signals: StSignalItem[],
  bars: PriceBar[],
  signalTypePrefix: string,
  longColor: string,
  shortColor: string,
): ChartScatterPoint[] {
  if (!signals.length || !bars.length) return [];
  const barByDate = barIndexByDate(bars);
  const atr = computeATR(bars);

  const dots: ChartScatterPoint[] = [];
  for (const s of signals) {
    if (!s.signalType.startsWith(signalTypePrefix)) continue;
    const hit = barByDate.get(s.barDate);
    if (!hit?.bar.close) continue;
    const isLong = s.direction === 'LONG' || (s as any).action === 'LONG';
    dots.push({
      x: toDatePt(s.barDate),
      y: signalDotY(hit.bar, hit.idx, atr, isLong),
      color: isLong ? longColor : shortColor,
    });
  }
  return dots;
}

/** Unchecked review occurrences render as solid neutral gray — the
 *  earlier ghost-alpha treatment read as invisible against coincident
 *  dots (UAT F2/F4), so unchecked is a hue distinction, not a dim. */
const REVIEW_UNCHECKED_COLOR = '#9e9e9e';

/**
 * Convert signal-review bundle occurrences into chart overlay dots (#1655).
 * Every occurrence plots at the outer review band (longs low − 5×ATR,
 * shorts high + 5×ATR — REVIEW_DOT_ATR_MULT) — the pane exists to see
 * the unselected candidates too, so nothing is filtered out. Color follows
 * the Trend Rider family of the signal type (V1/V2 palette, direction side);
 * non-Rider types fall back to the plain signal-dot palette. Checked rows
 * (ledger members) keep the family hue; unchecked render solid gray —
 * "candidate not yet taken" stays visible and readable.
 * Occurrences whose signal bar is outside the cached bar range produce no
 * point (the list still renders them — documented non-error).
 */
export function occurrenceMarkersFromReview(
  occurrences: SignalReviewOccurrence[],
  bars: PriceBar[],
): ChartScatterPoint[] {
  if (!occurrences.length || !bars.length) return [];
  const barByDate = barIndexByDate(bars);
  const atr = computeATR(bars);

  const dots: ChartScatterPoint[] = [];
  for (const occ of occurrences) {
    const hit = barByDate.get(occ.signalBarDate);
    if (!hit?.bar.close) continue;
    const isLong = occ.direction === TradeSide.LONG;
    // Version family from the _V{n}_ segment (the signalTradeDesc pattern);
    // unknown/absent versions fall back to the plain signal-dot palette.
    const v = occ.signalType.match(/_V(\d+)_/)?.[1];
    const base = v === '1'
      ? (isLong ? ST_UPTICK_DOT_COLORS.v1Long : ST_UPTICK_DOT_COLORS.v1Short)
      : v === '2'
        ? (isLong ? ST_UPTICK_DOT_COLORS.v2Long : ST_UPTICK_DOT_COLORS.v2Short)
        : (isLong ? SIGNAL_DOT_LONG_COLOR : SIGNAL_DOT_SHORT_COLOR);
    // Checked-ness is color-only — the scatter renderer has no hollow/
    // outline channel (#1679). Checked rows keep the family hue;
    // unchecked go neutral gray (UAT F4 — ghost alpha was invisible).
    dots.push({
      x: toDatePt(occ.signalBarDate),
      y: signalDotY(hit.bar, hit.idx, atr, isLong, REVIEW_DOT_ATR_MULT),
      color: occ.checked ? base : REVIEW_UNCHECKED_COLOR,
    });
  }
  return dots;
}

/** Convert backend trend-strength dot markers into scatter dots on the histogram. */
export function convertTrendStrengthDotMarkers(
  intervalData: IntervalData | undefined,
): ChartScatterPoint[] {
  const markers = intervalData?.dotMarkers?.trendStrength ?? [];
  return markers.map((m) => ({
    x: toDatePt(m.d),
    y: m.y,
    color: m.direction === 'long' ? SIGNAL_DOT_LONG_COLOR : SIGNAL_DOT_SHORT_COLOR,
    index: m.index,
  }));
}

/** Convert backend pre-computed zone dot markers into overlay long/short dots. */
export function convertZoneDotMarkers(
  intervalData: IntervalData | undefined,
  v1 = true,
): ChartScatterPoint[] {
  const key = v1 ? 'zoneV1' : 'zoneV2';
  // Shape-tolerant across the #1728 roll: pre-1728 dotMarkers are plain
  // DotMarker[]; post-1728 carry {emitted,suppressed}. FE and functions
  // deploy separately, so both shapes must read during the window.
  const raw = intervalData?.dotMarkers?.[key];
  const markers = Array.isArray(raw) ? raw : raw?.emitted ?? [];
  if (markers.length === 0) return [];

  const longColor = v1 ? UptickDotColors.v1Long : UptickDotColors.v2Long;
  const shortColor = v1 ? UptickDotColors.v1Short : UptickDotColors.v2Short;

  return markers.map((m) => ({
    x: toDatePt(m.d),
    y: m.y,
    color: m.direction === 'long' ? longColor : shortColor,
    index: m.index,
  }));
}

/** Convert backend pre-computed HTF window data into chart-ready window dots. */
export function convertHtfWindowData(
  intervalData: IntervalData | undefined,
  key: ChartIntervalKey.WEEKLY | ChartIntervalKey.MONTHLY,
): ChartScatterPoint[] {
  const markers = key === ChartIntervalKey.WEEKLY
    ? intervalData?.htfWindows?.weekly
    : intervalData?.htfWindows?.monthly;
  return (markers ?? []).map((m) => ({ x: toDatePt(m.d), y: m.y, color: m.color }));
}

/**
 * Convert the Trigger Bands dot markers of one interval into overlay scatter
 * points. Colour comes from the marker's signalType (side by hue, breakout vs
 * pullback by strength); a marker with an unrecognised signalType is dropped
 * rather than drawn in a guessed colour. Absent markers yield an empty list.
 */
export function convertTriggerBandsDotMarkers(
  intervalData: IntervalData | undefined,
): ChartScatterPoint[] {
  const dots: ChartScatterPoint[] = [];
  for (const m of intervalData?.dotMarkers?.triggerBands ?? []) {
    if (!isTriggerBandsSignalType(m.signalType)) continue;
    const color = ST_TRIGGER_BANDS_DOT_COLORS[m.signalType];
    dots.push({ x: toDatePt(m.d), y: m.y, color, index: m.index });
  }
  return dots;
}
