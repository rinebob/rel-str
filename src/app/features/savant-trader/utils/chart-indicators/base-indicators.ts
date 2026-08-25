/**
 * Savant Trader Chart Indicators — Base configuration and attachment helpers
 *
 * Builds the base ST indicator configurations used by the signal detail
 * and quick-charts panels, plus the helpers that attach HTF zone windows,
 * signal dots, and ST Trend Rider dots to an existing indicator list.
 */
import type { IndicatorConfig, IndicatorOption } from '../../../../features/shared/components/flex-chart/flex-chart.types';
import { ChartIntervalKey, StIndicator } from '../../../../features/shared/components/flex-chart/flex-chart.types';
import { ST_INDICATOR_OPTIONS, buildDefaultConfig } from '../../../../features/shared/components/flex-chart/indicators/indicator-registry';
import { ST_SIGNAL_DOTS_INDICATOR } from '../../../../features/shared/components/flex-chart/indicators/st-signal-dots.indicator';
import { ST_ZONE_V1_UPTICK_DOTS_INDICATOR, ST_ZONE_V2_UPTICK_DOTS_INDICATOR } from '../../../../features/shared/components/flex-chart/indicators/st-trend-rider-dots.indicator';
import { ST_ZONE_WINDOW_MONTHLY_INDICATOR, ST_ZONE_WINDOW_WEEKLY_INDICATOR } from '../../../../features/shared/components/flex-chart/indicators/st-zone-window.indicator';

/** Single scatter/dot point used for signal dots, uptick dots, and HTF window markers. */
export type ChartScatterPoint = { x: Date; y: number; color?: string };

// ---------------------------------------------------------------------------
// Base configuration
// ---------------------------------------------------------------------------

/** Indicator IDs shown by default for each interval. */
const INDICATORS_BY_INTERVAL: Record<ChartIntervalKey, StIndicator[]> = {
  [ChartIntervalKey.DAILY]:   [StIndicator.TREND_BANDS, StIndicator.TREND_STRENGTH, StIndicator.ZONE, StIndicator.ZONE_V2],
  [ChartIntervalKey.WEEKLY]:  [StIndicator.TREND_BANDS, StIndicator.TREND_STRENGTH, StIndicator.ZONE, StIndicator.ZONE_V2],
  [ChartIntervalKey.MONTHLY]: [StIndicator.TREND_BANDS, StIndicator.TREND_STRENGTH, StIndicator.ZONE, StIndicator.ZONE_V2],
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
export function buildBaseIndicators(interval: ChartIntervalKey): IndicatorConfig[] {
  return INDICATORS_BY_INTERVAL[interval]
    .map(id => BASE_CONFIGS.get(id))
    .filter((cfg): cfg is IndicatorConfig => cfg !== undefined);
}

/** Add a zone-window indicator, returning a new indicator list. */
export function addHtfZoneWindow(
  indicators: IndicatorConfig[],
  option: IndicatorOption,
  data: ChartScatterPoint[],
): IndicatorConfig[] {
  if (data.length === 0) return indicators;
  const cfg = buildDefaultConfig(option);
  cfg.pane = option.defaultPane ?? 'lower-3';
  cfg.data = data;
  return [...indicators, cfg];
}

/** Add signal dots, returning a new indicator list. */
export function addSignalDots(
  indicators: IndicatorConfig[],
  data: ChartScatterPoint[],
): IndicatorConfig[] {
  if (data.length === 0) return indicators;
  const cfg = buildDefaultConfig(ST_SIGNAL_DOTS_INDICATOR);
  cfg.pane = 'lower-1';
  cfg.data = data;
  return [...indicators, cfg];
}

/** Add ST Trend Rider dots, returning a new indicator list. */
export function addUptickDots(
  indicators: IndicatorConfig[],
  option: IndicatorOption,
  data: ChartScatterPoint[],
): IndicatorConfig[] {
  if (data.length === 0) return indicators;
  const cfg = buildDefaultConfig(option);
  cfg.pane = 'overlay';
  cfg.data = data;
  return [...indicators, cfg];
}

/** Bundle of optional Savant Trader extras to attach to a base indicator list. */
export interface ChartExtras {
  htfWindow?: { option: IndicatorOption; data: ChartScatterPoint[] };
  signalDots?: ChartScatterPoint[];
  uptickDotsV1?: ChartScatterPoint[];
  uptickDotsV2?: ChartScatterPoint[];
}

/** Conditionally add HTF windows, signal dots, and uptick dots, returning a new indicator list. */
export function addChartExtras(
  indicators: IndicatorConfig[],
  extras: ChartExtras,
): IndicatorConfig[] {
  let result = indicators;
  if (extras.htfWindow) {
    result = addHtfZoneWindow(result, extras.htfWindow.option, extras.htfWindow.data);
  }
  if (extras.signalDots) {
    result = addSignalDots(result, extras.signalDots);
  }
  if (extras.uptickDotsV1) {
    result = addUptickDots(result, ST_ZONE_V1_UPTICK_DOTS_INDICATOR, extras.uptickDotsV1);
  }
  if (extras.uptickDotsV2) {
    result = addUptickDots(result, ST_ZONE_V2_UPTICK_DOTS_INDICATOR, extras.uptickDotsV2);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Convenience option references
// ---------------------------------------------------------------------------

export { ST_ZONE_WINDOW_MONTHLY_INDICATOR, ST_ZONE_WINDOW_WEEKLY_INDICATOR };
export { ST_ZONE_V1_UPTICK_DOTS_INDICATOR, ST_ZONE_V2_UPTICK_DOTS_INDICATOR };
