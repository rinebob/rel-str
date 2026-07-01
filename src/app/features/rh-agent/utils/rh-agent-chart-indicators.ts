/**
 * RH Agent Chart Indicators
 *
 * Shared builder for the ST indicator configurations used by the signal detail
 * and quick-charts panels. Centralizes base configs, pane assignments, HTF zone
 * window dots, signal dots, and zone uptick dots so the same logic is not
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
import { ST_ZONE_V1_UPTICK_DOTS_INDICATOR, ST_ZONE_V2_UPTICK_DOTS_INDICATOR, detectZoneUptickDots } from '../../../features/shared/components/flex-chart/indicators/st-zone-uptick-dots.indicator';
import { ST_ZONE_WINDOW_MONTHLY_INDICATOR, ST_ZONE_WINDOW_WEEKLY_INDICATOR, computeZoneWindowData } from '../../../features/shared/components/flex-chart/indicators/st-zone-window.indicator';
import { detectTrendStrengthSignals } from '../../../features/shared/components/flex-chart/signals';

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

/** Compute zone uptick dots (V1). */
export function computeUptickDotsV1(
  bars: PriceBar[],
  htfZone: ReturnType<typeof calculateStZoneV2>
) {
  if (bars.length < 30 || htfZone.length === 0) return [];
  const zoneV1 = calculateStZone(bars, {});
  return detectZoneUptickDots(zoneV1, htfZone, bars, UptickDotColors.v1Long, UptickDotColors.v1Short);
}

/** Compute zone uptick dots (V2). */
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

/** Add zone uptick dots to an existing indicator list. */
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
// Convenience option references
// ---------------------------------------------------------------------------

export { ST_ZONE_WINDOW_MONTHLY_INDICATOR, ST_ZONE_WINDOW_WEEKLY_INDICATOR };
export { ST_ZONE_V1_UPTICK_DOTS_INDICATOR, ST_ZONE_V2_UPTICK_DOTS_INDICATOR };
