/**
 * RH Agent Indicator Computation
 *
 * Pure indicator computation (no Firebase / no Cloud Functions imports).
 * Used by the callable, the worker, and local backfill scripts so that
 * scripts do not trigger Firebase Admin SDK initialization at import time.
 */
import { computeStTrendBands } from '../indicators/st-trend-bands';
import { computeStZone } from '../indicators/st-zone';
import { computeStZoneV2 } from '../indicators/st-zone-v2';
import { computeStTrendStrength } from '../indicators/st-trend-strength';
import { detectAllStTrendRiderSignals } from './strategies/signal-detection';
import { StSignalDirection } from './rh-agent-config';
import type { OHLCV } from '../indicators/st-trend-bands';

// Local copy of the rs-bars shape to avoid importing rs-bars-sync (which has
// Firebase side effects) into backfill scripts and other pure consumers.
export interface OhlcBar {
  d: string;   // YYYY-MM-DD
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

// =============================================================================
// TYPES
// =============================================================================

export interface IndicatorSignalMarker {
  d: string;                    // bar date
  index: number;                // bar index in the interval's bars array
  direction: 'long' | 'short';
  signalType: string;
  reason: string;
}

export interface BandPoint {
  bandIndex: number;
  bullColor: string;
  bearColor: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  mid: number | null;
  up: boolean | null;
}

export interface IndicatorDataPoint {
  d: string;
  zoneV1: number | null;
  zoneV2: number | null;
  diPlus: number | null;
  diMinus: number | null;
  diHist: number | null;
  adx: number | null;
  bands: BandPoint[];
  htfZoneV2: number | null;     // HTF zone V2 context for this bar
}

export type IndicatorIntervalData = IndicatorDataPoint[];

export interface SignalIntervalData {
  zoneV1?: IndicatorSignalMarker[];
  zoneV2?: IndicatorSignalMarker[];
  trendStrength?: IndicatorSignalMarker[];
  triggerBands?: IndicatorSignalMarker[];
}

export enum ChartInterval {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export enum IndicatorFamily {
  ZONE_V1 = 'zoneV1',
  ZONE_V2 = 'zoneV2',
  TREND_STRENGTH = 'trendStrength',
  TREND_BANDS = 'trendBands',
  TRIGGER_BANDS = 'triggerBands',
}

export enum StrategyFamily {
  ZONE_V1 = 'zoneV1',
  ZONE_V2 = 'zoneV2',
  TREND_STRENGTH = 'trendStrength',
  TRIGGER_BANDS = 'triggerBands',
}

export interface SymbolIndicatorSeriesResponse {
  symbol: string;
  marketDate: string;
  computedAt: string;
  intervals: {
    daily?: IntervalData;
    weekly?: IntervalData;
    monthly?: IntervalData;
  };
}

export interface IntervalData {
  indicators: {
    zoneV1?: IndicatorIntervalData;
    zoneV2?: IndicatorIntervalData;
    trendStrength?: IndicatorIntervalData;
    trendBands?: IndicatorIntervalData;
    triggerBands?: IndicatorIntervalData;
  };
  signals: {
    zoneV1?: IndicatorSignalMarker[];
    zoneV2?: IndicatorSignalMarker[];
    trendStrength?: IndicatorSignalMarker[];
    triggerBands?: IndicatorSignalMarker[];
  };
}

// =============================================================================
// HELPERS
// =============================================================================

const TREND_BAND_COLORS: Array<[string, string]> = [
  ['#ffeb3b', '#2196f3'], // band 1: yellow up, blue down
  ['#ffeb3b', '#2196f3'], // band 2: yellow up, blue down
  ['#ff9800', '#1565c0'], // band 3: orange up, dark blue down
  ['#ff9800', '#1565c0'], // band 4: orange up, dark blue down
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function barsToOhlcv(bars: OhlcBar[]): OHLCV[] {
  return bars.map(b => ({
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  }));
}

function toNullable(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function toBoolNullable(value: boolean): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function buildBandPoint(
  bandIndex: number,
  band: { o: number[]; h: number[]; l: number[]; c: number[]; m: number[]; up: boolean[] },
  i: number,
): BandPoint {
  const [bullColor, bearColor] = TREND_BAND_COLORS[bandIndex - 1] ?? ['#999999', '#999999'];
  return {
    bandIndex,
    bullColor,
    bearColor,
    open: toNullable(band.o[i]),
    high: toNullable(band.h[i]),
    low: toNullable(band.l[i]),
    close: toNullable(band.c[i]),
    mid: toNullable(band.m[i]),
    up: toBoolNullable(band.up[i]),
  };
}

function detectTrendStrengthSignals(data: IndicatorDataPoint[]): IndicatorSignalMarker[] {
  const signals: IndicatorSignalMarker[] = [];
  const thresholds = [-10, 0, 10];

  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1].diHist;
    const curr = data[i].diHist;
    if (prev === null || curr === null || !Number.isFinite(prev) || !Number.isFinite(curr)) continue;

    for (const threshold of thresholds) {
      if (prev < threshold && curr >= threshold) {
        signals.push({
          d: data[i].d,
          index: i,
          direction: 'long',
          signalType: `cross-${threshold === 0 ? 'zero' : threshold > 0 ? 'plus-10' : 'minus-10'}`,
          reason: `DI hist crossed above ${threshold} (${prev.toFixed(1)} → ${curr.toFixed(1)})`,
        });
      }
      if (prev > threshold && curr <= threshold) {
        signals.push({
          d: data[i].d,
          index: i,
          direction: 'short',
          signalType: `cross-${threshold === 0 ? 'zero' : threshold > 0 ? 'plus-10' : 'minus-10'}`,
          reason: `DI hist crossed below ${threshold} (${prev.toFixed(1)} → ${curr.toFixed(1)})`,
        });
      }
    }
  }

  return signals;
}

function mapHtfZoneToLtfDates(ltfDates: string[], htfDates: string[], htfZone: (number | null)[]): (number | null)[] {
  // Both arrays are sorted chronologically. For each LTF date, use the most recent HTF zone
  // whose HTF date is <= the LTF date.
  const result: (number | null)[] = new Array(ltfDates.length).fill(null);
  let htfIdx = 0;
  for (let i = 0; i < ltfDates.length; i++) {
    const ltfDate = ltfDates[i];
    while (htfIdx < htfDates.length && htfDates[htfIdx] <= ltfDate) {
      htfIdx++;
    }
    result[i] = htfIdx > 0 ? htfZone[htfIdx - 1] : null;
  }
  return result;
}

function assignHtfContext(ltfData: IndicatorDataPoint[], htfData: IndicatorDataPoint[]): void {
  const ltfDates = ltfData.map((p: IndicatorDataPoint) => p.d);
  const htfDates = htfData.map((p: IndicatorDataPoint) => p.d);
  const htfZone = htfData.map((p: IndicatorDataPoint) => p.zoneV2);
  const mapped = mapHtfZoneToLtfDates(ltfDates, htfDates, htfZone);
  for (let i = 0; i < ltfData.length; i++) {
    ltfData[i].htfZoneV2 = mapped[i];
  }
}

function computeIndicatorInterval(bars: OhlcBar[]): IndicatorIntervalData {
  if (bars.length < 30) {
    return bars.map(b => ({
      d: b.d,
      zoneV1: null,
      zoneV2: null,
      diPlus: null,
      diMinus: null,
      diHist: null,
      adx: null,
      bands: [],
      htfZoneV2: null,
    }));
  }

  const ohlcv = barsToOhlcv(bars);
  const bands = computeStTrendBands(ohlcv);
  const zoneV1 = computeStZone(ohlcv, bands);
  const zoneV2 = computeStZoneV2(ohlcv, bands);
  const strength = computeStTrendStrength(ohlcv);

  return bars.map((b, i) => ({
    d: b.d,
    zoneV1: toNullable(zoneV1.zone[i]),
    zoneV2: toNullable(zoneV2.zone[i]),
    diPlus: toNullable(strength.diPlus[i]),
    diMinus: toNullable(strength.diMinus[i]),
    diHist: toNullable(strength.diHist[i]),
    adx: toNullable(strength.adx[i]),
    bands: [
      buildBandPoint(1, bands.band1, i),
      buildBandPoint(2, bands.band2, i),
      buildBandPoint(3, bands.band3, i),
      buildBandPoint(4, bands.band4, i),
    ],
    htfZoneV2: null,
  }));
}

function emptySignalInterval(): SignalIntervalData {
  return {};
}

function generateZoneSignals(
  data: IndicatorDataPoint[],
  version: 'V1' | 'V2',
  timeframe: 'D' | 'W',
): IndicatorSignalMarker[] {
  if (data.length < 2) return [];

  const zone = data.map((p: IndicatorDataPoint) => (version === 'V1' ? p.zoneV1 : p.zoneV2));
  // ST Trend Rider uses the same-timeframe zone as its own context, not a cross-zone
  // HTF check. The windowV2 parameter is kept so future strategies can supply a true
  // higher-timeframe window if needed.
  const windowV2 = zone;
  const zoneNumbers = zone.map((z: number | null) => (z === null ? NaN : z));
  const windowV2Numbers = windowV2.map((z: number | null) => (z === null ? NaN : z));
  const ohlcv = data.map((p: IndicatorDataPoint) => ({ open: 0, high: 0, low: 0, close: 0, date: p.d }));

  const signals = detectAllStTrendRiderSignals(zoneNumbers, windowV2Numbers, ohlcv, version, timeframe);
  if (signals.length === 0) return [];

  return signals.map(signal => {
    const idx = signal.index ?? 0;
    return {
      d: data[idx].d,
      index: idx,
      direction: signal.action === StSignalDirection.LONG ? 'long' : 'short',
      signalType: signal.signalType,
      reason: signal.reason,
    };
  });
}

function generateSymbolSignals(
  daily: IndicatorIntervalData,
  weekly: IndicatorIntervalData,
  monthly: IndicatorIntervalData,
  dailyBars: OhlcBar[],
  weeklyBars: OhlcBar[],
  monthlyBars: OhlcBar[],
): {
  daily: SignalIntervalData;
  weekly: SignalIntervalData;
  monthly: SignalIntervalData;
} {
  const dailySignals = emptySignalInterval();
  const weeklySignals = emptySignalInterval();
  const monthlySignals = emptySignalInterval();

  dailySignals.trendStrength = detectTrendStrengthSignals(daily);
  weeklySignals.trendStrength = detectTrendStrengthSignals(weekly);
  monthlySignals.trendStrength = detectTrendStrengthSignals(monthly);

  // Only emit last-bar zone signals for the daily and weekly intervals
  if (dailyBars.length >= 45 && weeklyBars.length >= 30) {
    dailySignals.zoneV1 = generateZoneSignals(daily, 'V1', 'D');
    dailySignals.zoneV2 = generateZoneSignals(daily, 'V2', 'D');
  }
  if (weeklyBars.length >= 45 && monthlyBars.length >= 30) {
    weeklySignals.zoneV1 = generateZoneSignals(weekly, 'V1', 'W');
    weeklySignals.zoneV2 = generateZoneSignals(weekly, 'V2', 'W');
  }

  return { daily: dailySignals, weekly: weeklySignals, monthly: monthlySignals };
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Compute all indicator time series for a symbol from cached bars.
 * This is the backend source of truth used by the worker when writing docs.
 */
export function computeIndicatorSeries(
  dailyBars: OhlcBar[],
  weeklyBars: OhlcBar[],
  monthlyBars: OhlcBar[],
): {
  daily: IndicatorIntervalData;
  weekly: IndicatorIntervalData;
  monthly: IndicatorIntervalData;
} {
  const daily = computeIndicatorInterval(dailyBars);
  const weekly = computeIndicatorInterval(weeklyBars);
  const monthly = computeIndicatorInterval(monthlyBars);

  assignHtfContext(daily, weekly);
  assignHtfContext(weekly, monthly);

  return { daily, weekly, monthly };
}

/**
 * Compute all indicator time series and signal markers for a symbol from cached bars.
 * This is the backend source of truth used by the chart callable.
 */
export function computeSymbolIndicatorSeries(
  symbol: string,
  dailyBars: OhlcBar[],
  weeklyBars: OhlcBar[],
  monthlyBars: OhlcBar[],
): SymbolIndicatorSeriesResponse {
  const indicators = computeIndicatorSeries(dailyBars, weeklyBars, monthlyBars);
  const signals = generateSymbolSignals(indicators.daily, indicators.weekly, indicators.monthly, dailyBars, weeklyBars, monthlyBars);

  return {
    symbol,
    marketDate: todayIso(),
    computedAt: new Date().toISOString(),
    intervals: {
      daily: {
        indicators: {
          zoneV1: indicators.daily,
          zoneV2: indicators.daily,
          trendStrength: indicators.daily,
          trendBands: indicators.daily,
        },
        signals: signals.daily,
      },
      weekly: {
        indicators: {
          zoneV1: indicators.weekly,
          zoneV2: indicators.weekly,
          trendStrength: indicators.weekly,
          trendBands: indicators.weekly,
        },
        signals: signals.weekly,
      },
      monthly: {
        indicators: {
          zoneV1: indicators.monthly,
          zoneV2: indicators.monthly,
          trendStrength: indicators.monthly,
          trendBands: indicators.monthly,
        },
        signals: signals.monthly,
      },
    },
  };
}
