/**
 * Savant Trader Chart Indicators â€” Callable signal marker conversion
 *
 * Converts backend pre-computed signal markers (trend-strength dots, zone
 * uptick dots, HTF zone windows) into chart-ready scatter-point arrays.
 */
import { ChartIntervalKey } from '../../../../features/shared/components/flex-chart/flex-chart.types';
import { ST_SIGNAL_DOTS_INDICATOR } from '../../../../features/shared/components/flex-chart/indicators/st-signal-dots.indicator';
import type { StSignalItem } from '../../services/st.service';
import type { IntervalData } from '../../common/indicator.types';
import { toDatePt } from '../../utils/utils';
import type { ChartScatterPoint } from './base-indicators';
import { UptickDotColors } from './base-indicators';
import { ST_SIGNAL_DOT_COLORS, ST_TRIGGER_BANDS_DOT_COLORS } from '@flex-chart/indicator-visuals';

const SIGNAL_DOT_LONG_COLOR = ST_SIGNAL_DOT_COLORS.long;
const SIGNAL_DOT_SHORT_COLOR = ST_SIGNAL_DOT_COLORS.short;

/**
 * Convert StSignalItem[] from signal-history into chart dot points.
 * Matches each signal's barDate to a price bar to get the y-coordinate (close price).
 * Filters by signalType prefix (e.g. 'D_ZONE_V1' for V1 daily dots).
 */
export function uptickDotsFromHistory(
  signals: StSignalItem[],
  bars: { x: Date; close?: number; c?: number }[],
  signalTypePrefix: string,
  longColor: string,
  shortColor: string,
): ChartScatterPoint[] {
  if (!signals.length || !bars.length) return [];

  const barByDate = new Map<string, { x: Date; close?: number; c?: number }>();
  for (const b of bars) {
    const d = (b as any).date ?? (b as any).d ?? '';
    if (d) barByDate.set(String(d).slice(0, 10), b);
  }

  const dots: ChartScatterPoint[] = [];
  for (const s of signals) {
    if (!s.signalType.startsWith(signalTypePrefix)) continue;
    const bar = barByDate.get(s.barDate);
    if (!bar) continue;
    const close = (bar as any).close ?? (bar as any).c ?? 0;
    if (!close) continue;
    const isLong = s.direction === 'LONG' || (s as any).action === 'LONG';
    dots.push({
      x: toDatePt(s.barDate),
      y: close,
      color: isLong ? longColor : shortColor,
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
  const markers = intervalData?.dotMarkers?.[key] ?? [];
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
    const color = ST_TRIGGER_BANDS_DOT_COLORS[m.signalType];
    if (!color) continue;
    dots.push({ x: toDatePt(m.d), y: m.y, color, index: m.index });
  }
  return dots;
}
