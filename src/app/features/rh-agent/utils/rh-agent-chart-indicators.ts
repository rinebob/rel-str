/**
 * RH Agent Chart Indicators
 *
 * Shared builder for the ST indicator configurations used by the signal detail
 * and quick-charts panels. Centralizes base configs, pane assignments, HTF zone
 * window dots, signal dots, and ST Trend Rider dots so the same logic is not
 * duplicated across components.
 */
import type { IndicatorConfig, IndicatorOption, IndicatorPane, PriceBar } from '../../../features/shared/components/flex-chart/flex-chart.types';
import type { RhAgentSignalItem } from '../services/rh-agent.service';
import { StIndicator } from '../../../features/shared/components/flex-chart/flex-chart.types';
import { ST_INDICATOR_OPTIONS, buildDefaultConfig } from '../../../features/shared/components/flex-chart/indicators/indicator-registry';
import { calculateStZone } from '../../../features/shared/components/flex-chart/indicators/st-zone.indicator';
import { calculateStZoneV2 } from '../../../features/shared/components/flex-chart/indicators/st-zone-v2.indicator';
import { calculateStTrendStrength } from '../../../features/shared/components/flex-chart/indicators/st-trend-strength.indicator';
import { ST_SIGNAL_DOTS_INDICATOR, computeSignalDots } from '../../../features/shared/components/flex-chart/indicators/st-signal-dots.indicator';
import { ST_ZONE_V1_UPTICK_DOTS_INDICATOR, ST_ZONE_V2_UPTICK_DOTS_INDICATOR, detectZoneUptickDots } from '../../../features/shared/components/flex-chart/indicators/st-trend-rider-dots.indicator';
import { ST_ZONE_WINDOW_MONTHLY_INDICATOR, ST_ZONE_WINDOW_WEEKLY_INDICATOR, computeZoneWindowData } from '../../../features/shared/components/flex-chart/indicators/st-zone-window.indicator';
import { detectTrendStrengthSignals } from '../../../features/shared/components/flex-chart/signals';
import type { BandSeriesData } from '../../../features/shared/components/flex-chart/indicators/st-trend-bands.indicator';
import type { IndicatorDataPoint, IntervalData, SignalMarker, TrendBandsPoint } from '../common/rh-agent-indicator.types';

// ---------------------------------------------------------------------------
// Base configuration
// ---------------------------------------------------------------------------

/** Indicator IDs shown by default for each interval. */
const INDICATORS_BY_INTERVAL: Record<'daily' | 'weekly' | 'monthly', StIndicator[]> = {
  daily:   [StIndicator.TREND_BANDS, StIndicator.TREND_STRENGTH, StIndicator.ZONE, StIndicator.ZONE_V2],
  weekly:  [StIndicator.TREND_BANDS, StIndicator.TREND_STRENGTH, StIndicator.ZONE, StIndicator.ZONE_V2],
  monthly: [StIndicator.TREND_BANDS, StIndicator.TREND_STRENGTH, StIndicator.ZONE, StIndicator.ZONE_V2],
};

/** Pre-built base IndicatorConfig map with pane assignments and display names. */
const BASE_CONFIGS = new Map<string, IndicatorConfig>(
  (() => {
    const m: [string, IndicatorConfig][] = [];
    for (const opt of ST_INDICATOR_OPTIONS) {
      const cfg = buildDefaultConfig(opt);
      if (opt.id === StIndicator.TREND_STRENGTH) {
        cfg.pane = 'lower-1';
      }
      if (opt.id === StIndicator.ZONE) {
        cfg.pane = 'lower-2';
        cfg.options = { ...cfg.options, name: 'ST-ZONE V1' };
      }
      if (opt.id === StIndicator.ZONE_V2) {
        cfg.pane = 'lower-3';
        cfg.options = { ...cfg.options, name: 'ST-ZONE V2' };
      }
      m.push([opt.id, cfg]);
    }
    return m;
  })()
);

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export const UptickDotColors = {
  v1Long:  '#4caf50',
  v1Short: '#f44336',
  v2Long:  '#8bc34a',
  v2Short: '#ff9800',
} as const;

// ---------------------------------------------------------------------------
// Public builder API
// ---------------------------------------------------------------------------

/** Build the base indicator list for an interval (D/W/M). */
export function buildBaseIndicators(interval: 'daily' | 'weekly' | 'monthly'): IndicatorConfig[] {
  return INDICATORS_BY_INTERVAL[interval]
    .map(id => BASE_CONFIGS.get(id))
    .filter((cfg): cfg is IndicatorConfig => cfg !== undefined);
}

/** Compute ST-Zone V2 values for a set of bars (used as HTF context). */
export function computeHtfZoneV2(bars: PriceBar[]): ReturnType<typeof calculateStZoneV2> {
  if (bars.length < 30) return [];
  return calculateStZoneV2(bars, {});
}

/** Compute HTF zone-window dots mapped onto LTF bars. */
export function computeHtfWindowData(htfZone: ReturnType<typeof calculateStZoneV2>, ltfBars: PriceBar[]) {
  if (htfZone.length === 0 || ltfBars.length === 0) return [];
  return computeZoneWindowData(htfZone, ltfBars);
}

/** Compute signal dots for the trend-strength histogram. */
export function computeSignalDotsData(bars: PriceBar[]) {
  if (bars.length < 30) return [];
  const strengthData = calculateStTrendStrength(bars, {});
  const signals = detectTrendStrengthSignals(strengthData, bars);
  return computeSignalDots(signals, strengthData);
}

/** Compute ST Trend Rider dots for Zone V1. */
export function computeUptickDotsV1(
  bars: PriceBar[],
  htfZone: ReturnType<typeof calculateStZoneV2>
) {
  if (bars.length < 30 || htfZone.length === 0) return [];
  const zoneV1 = calculateStZone(bars, {});
  return detectZoneUptickDots(zoneV1, htfZone, bars, UptickDotColors.v1Long, UptickDotColors.v1Short);
}

/** Compute ST Trend Rider dots for Zone V2. */
export function computeUptickDotsV2(
  bars: PriceBar[],
  htfZone: ReturnType<typeof calculateStZoneV2>
) {
  if (bars.length < 30 || htfZone.length === 0) return [];
  const zoneV2 = calculateStZoneV2(bars, {});
  return detectZoneUptickDots(zoneV2, htfZone, bars, UptickDotColors.v2Long, UptickDotColors.v2Short);
}

/** Add a zone-window indicator to an existing indicator list. */
export function addHtfZoneWindow(
  indicators: IndicatorConfig[],
  option: IndicatorOption,
  data: { x: Date; y: number; color?: string }[]
): void {
  if (data.length === 0) return;
  const cfg = buildDefaultConfig(option);
  cfg.pane = option.defaultPane ?? 'lower-3';
  cfg.data = data;
  indicators.push(cfg);
}

/** Add signal dots to an existing indicator list. */
export function addSignalDots(
  indicators: IndicatorConfig[],
  data: { x: Date; y: number; color?: string }[]
): void {
  if (data.length === 0) return;
  const cfg = buildDefaultConfig(ST_SIGNAL_DOTS_INDICATOR);
  cfg.pane = 'lower-1';
  cfg.data = data;
  indicators.push(cfg);
}

/**
 * Convert RhAgentSignalItem[] from signal-history into chart dot points.
 * Matches each signal's barDate to a price bar to get the y-coordinate (close price).
 * Filters by signalType prefix (e.g. 'D_ZONE_V1' for V1 daily dots).
 */
export function uptickDotsFromHistory(
  signals: RhAgentSignalItem[],
  bars: PriceBar[],
  signalTypePrefix: string,
  longColor: string,
  shortColor: string,
): { x: Date; y: number; color?: string }[] {
  if (!signals.length || !bars.length) return [];

  const barByDate = new Map<string, PriceBar>();
  for (const b of bars) {
    const d = (b as any).date ?? (b as any).d ?? '';
    if (d) barByDate.set(String(d).slice(0, 10), b);
  }

  const dots: { x: Date; y: number; color?: string }[] = [];
  for (const s of signals) {
    if (!s.signalType.startsWith(signalTypePrefix)) continue;
    const bar = barByDate.get(s.barDate);
    if (!bar) continue;
    const close = (bar as any).close ?? (bar as any).c ?? 0;
    if (!close) continue;
    const isLong = s.direction === 'LONG' || (s as any).action === 'LONG';
    dots.push({
      x: new Date(s.barDate + 'T00:00:00.000Z'),
      y: close,
      color: isLong ? longColor : shortColor,
    });
  }
  return dots;
}

/** Add ST Trend Rider dots to an existing indicator list. */
export function addUptickDots(
  indicators: IndicatorConfig[],
  option: IndicatorOption,
  data: { x: Date; y: number; color?: string }[]
): void {
  if (data.length === 0) return;
  const cfg = buildDefaultConfig(option);
  cfg.pane = 'overlay';
  cfg.data = data;
  indicators.push(cfg);
}

// ---------------------------------------------------------------------------
// Callable indicator data conversion
// ---------------------------------------------------------------------------

function toDate(d: string): Date {
  return new Date(`${d}T00:00:00.000Z`);
}

function zoneColor(zone: number): string {
  const ZONE_COLORS: Record<number, string> = {
    4: '#0d47a1',
    3: '#2196f3',
    2: '#4caf50',
    1: '#81c784',
    0: '#9e9e9e',
    [-1]: '#e57373',
    [-2]: '#f44336',
    [-3]: '#e91e63',
    [-4]: '#b71c1c',
  };
  return ZONE_COLORS[zone] || '#9e9e9e';
}

function zoneToChartData(
  points: IndicatorDataPoint[],
  field: 'zoneV1' | 'zoneV2',
): { x: Date; y: number; color?: string }[] {
  return points
    .filter(p => p[field] !== null && Number.isFinite(p[field] as number))
    .map(p => {
      const zone = p[field] as number;
      return { x: toDate(p.d), y: zone, color: zoneColor(zone) };
    });
}

function trendStrengthToChartData(
  points: IndicatorDataPoint[],
): { x: Date; y: number; y2: number; y3: number; color: string }[] {
  return points
    .filter(p => p.diPlus !== null && p.diMinus !== null && p.diHist !== null)
    .map(p => {
      const diHist = p.diHist as number;
      return {
        x: toDate(p.d),
        y: diHist,
        y2: p.diPlus as number,
        y3: p.diMinus as number,
        color: diHist >= 0 ? '#2196f3' : '#ffeb3b',
      };
    });
}

function trendBandsToChartData(
  points: TrendBandsPoint[],
  bars: PriceBar[],
): BandSeriesData[] {
  if (points.length === 0 || bars.length === 0) return [];

  const dateToIndex = new Map<string, number>();
  for (let i = 0; i < bars.length; i++) {
    const d = (bars[i] as any).date ?? bars[i].x;
    const dateStr = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
    dateToIndex.set(dateStr, i);
  }

  const bandMap = new Map<number, { bandIndex: number; bullColor: string; bearColor: string; data: { index: number; open: number; high: number; low: number; close: number }[] }>();

  for (const p of points) {
    const index = dateToIndex.get(p.d);
    if (index === undefined) continue;
    for (const b of p.bands) {
      if (b.open === null || b.high === null || b.low === null || b.close === null) continue;
      const idx = b.bandIndex;
      if (!bandMap.has(idx)) {
        bandMap.set(idx, {
          bandIndex: idx,
          bullColor: b.bullColor,
          bearColor: b.bearColor,
          data: [],
        });
      }
      bandMap.get(idx)!.data.push({ index, open: b.open, high: b.high, low: b.low, close: b.close });
    }
  }

  return Array.from(bandMap.values()).sort((a, b) => a.bandIndex - b.bandIndex);
}

/** Convert one interval of the callable response into chart-ready data. */
export function convertIntervalIndicators(
  intervalData: IntervalData | undefined,
  bars: PriceBar[],
): {
  zoneV1: { x: Date; y: number; color?: string }[];
  zoneV2: { x: Date; y: number; color?: string }[];
  trendStrength: { x: Date; y: number; y2: number; y3: number }[];
  trendBands: BandSeriesData[];
} {
  const zone = intervalData?.indicators?.zoneV1 ?? [];
  const trendStrength = intervalData?.indicators?.trendStrength ?? [];
  const trendBands = intervalData?.indicators?.trendBands ?? [];
  return {
    zoneV1: zoneToChartData(zone, 'zoneV1'),
    zoneV2: zoneToChartData(zone, 'zoneV2'),
    trendStrength: trendStrengthToChartData(trendStrength),
    trendBands: trendBandsToChartData(trendBands, bars),
  };
}

// ---------------------------------------------------------------------------
// Callable signal marker conversion
// ---------------------------------------------------------------------------

const SIGNAL_DOT_LONG_COLOR = '#4caf50';
const SIGNAL_DOT_SHORT_COLOR = '#f44336';
const SIGNAL_DOT_OFFSET = 3;

/** Convert backend trend-strength signals into scatter dots on the histogram. */
export function convertTrendStrengthSignals(
  intervalData: IntervalData | undefined,
  bars: PriceBar[],
): { x: Date; y: number; color?: string }[] {
  const signals = intervalData?.signals?.trendStrength ?? [];
  const strength = intervalData?.indicators?.trendStrength ?? [];
  if (signals.length === 0 || strength.length === 0 || bars.length === 0) return [];

  const dots: { x: Date; y: number; color?: string }[] = [];
  for (const sig of signals) {
    const point = strength[sig.index];
    if (!point || point.diHist === null) continue;
    dots.push({
      x: toDate(sig.d),
      y: point.diHist + (sig.direction === 'long' ? SIGNAL_DOT_OFFSET : -SIGNAL_DOT_OFFSET),
      color: sig.direction === 'long' ? SIGNAL_DOT_LONG_COLOR : SIGNAL_DOT_SHORT_COLOR,
    });
  }
  return dots;
}

/** Convert backend ST Trend Rider signals (V1 or V2) into overlay long/short dots. */
export function convertZoneSignals(
  intervalData: IntervalData | undefined,
  bars: PriceBar[],
  v1 = true,
): { x: Date; y: number; color?: string }[] {
  const key = v1 ? 'zoneV1' : 'zoneV2';
  const signals = intervalData?.signals?.[key] ?? [];
  if (signals.length === 0 || bars.length === 0) return [];

  const longColor = v1 ? UptickDotColors.v1Long : UptickDotColors.v2Long;
  const shortColor = v1 ? UptickDotColors.v1Short : UptickDotColors.v2Short;

  const dots: { x: Date; y: number; color?: string }[] = [];
  for (const sig of signals) {
    const bar = bars[sig.index];
    if (!bar) continue;
    const close = bar.close ?? (bar as any).c ?? 0;
    if (!close) continue;
    dots.push({
      x: toDate(sig.d),
      y: close,
      color: sig.direction === 'long' ? longColor : shortColor,
    });
  }
  return dots;
}

/**
 * Inject callable indicator data into the base indicator configs for a single interval.
 * When the callable has no data for an indicator, the config is left unchanged so the
 * flex chart can fall back to its inline calculator.
 */
export function injectCallableIndicatorData(
  indicators: IndicatorConfig[],
  intervalData: IntervalData | undefined,
  bars: PriceBar[],
): IndicatorConfig[] {
  const converted = convertIntervalIndicators(intervalData, bars);
  return indicators.map(cfg => {
    switch (cfg.type) {
      case StIndicator.ZONE:
        return converted.zoneV1.length ? { ...cfg, data: converted.zoneV1 } : cfg;
      case StIndicator.ZONE_V2:
        return converted.zoneV2.length ? { ...cfg, data: converted.zoneV2 } : cfg;
      case StIndicator.TREND_STRENGTH:
        return converted.trendStrength.length ? { ...cfg, data: converted.trendStrength } : cfg;
      case StIndicator.TREND_BANDS:
        return converted.trendBands.length ? { ...cfg, bandData: converted.trendBands } : cfg;
      default:
        return cfg;
    }
  });
}

// ---------------------------------------------------------------------------
// Convenience option references
// ---------------------------------------------------------------------------

export { ST_ZONE_WINDOW_MONTHLY_INDICATOR, ST_ZONE_WINDOW_WEEKLY_INDICATOR };
export { ST_ZONE_V1_UPTICK_DOTS_INDICATOR, ST_ZONE_V2_UPTICK_DOTS_INDICATOR };
