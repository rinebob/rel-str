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
import { StSignalDirection } from './rh-agent-signals';
import type { OHLCV } from '../indicators/st-trend-bands';
import type { OhlcBar } from './rh-agent-types';

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

export interface DotMarker {
  d: string;                    // bar date
  index: number;                // bar index in the interval's bars array
  direction: 'long' | 'short';
  y: number;                    // chart y-coordinate (price with ATR offset, or DI hist with offset)
  version: 'V1' | 'V2' | 'TS';
  signalType: string;
}

export interface HtfWindowPoint {
  d: string;                    // bar date (LTF)
  y: number;                    // -6 or +6
  color: string;                // long/short color
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

export interface ZoneV1Point {
  d: string;
  zone: number | null;
}

export interface ZoneV2Point {
  d: string;
  zone: number | null;
}

export interface TrendStrengthPoint {
  d: string;
  diPlus: number | null;
  diMinus: number | null;
  diHist: number | null;
  adx: number | null;
}

export interface TrendBandsPoint {
  d: string;
  bands: BandPoint[];
}

export interface TriggerBandsPoint {
  d: string;
  // Trigger band fields TBD in Phase 2
}

export interface SignalIntervalData {
  zoneV1?: IndicatorSignalMarker[];
  zoneV2?: IndicatorSignalMarker[];
  trendStrength?: IndicatorSignalMarker[];
  triggerBands?: IndicatorSignalMarker[];
  dotMarkers?: {
    zoneV1?: DotMarker[];
    zoneV2?: DotMarker[];
    trendStrength?: DotMarker[];
  };
  htfWindows?: {
    weekly?: HtfWindowPoint[];
    monthly?: HtfWindowPoint[];
  };
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
    zoneV1?: ZoneV1Point[];
    zoneV2?: ZoneV2Point[];
    trendStrength?: TrendStrengthPoint[];
    trendBands?: TrendBandsPoint[];
    triggerBands?: TriggerBandsPoint[];
  };
  signals: {
    zoneV1?: IndicatorSignalMarker[];
    zoneV2?: IndicatorSignalMarker[];
    trendStrength?: IndicatorSignalMarker[];
    triggerBands?: IndicatorSignalMarker[];
  };
  dotMarkers?: {
    zoneV1?: DotMarker[];
    zoneV2?: DotMarker[];
    trendStrength?: DotMarker[];
  };
  htfWindows?: {
    weekly?: HtfWindowPoint[];
    monthly?: HtfWindowPoint[];
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

function splitIndicatorInterval(data: IndicatorIntervalData): {
  zoneV1: ZoneV1Point[];
  zoneV2: ZoneV2Point[];
  trendStrength: TrendStrengthPoint[];
  trendBands: TrendBandsPoint[];
} {
  return {
    zoneV1: data.map(p => ({ d: p.d, zone: p.zoneV1 })),
    zoneV2: data.map(p => ({ d: p.d, zone: p.zoneV2 })),
    trendStrength: data.map(p => ({
      d: p.d,
      diPlus: p.diPlus,
      diMinus: p.diMinus,
      diHist: p.diHist,
      adx: p.adx,
    })),
    trendBands: data.map(p => ({ d: p.d, bands: p.bands })),
  };
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

function computeATR(bars: OhlcBar[], period = 14): number[] {
  const atr: number[] = new Array(bars.length).fill(0);
  if (bars.length < 2) return atr;

  const tr: number[] = [bars[0].h - bars[0].l];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].h;
    const l = bars[i].l;
    const pc = bars[i - 1].c;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  let sum = 0;
  for (let i = 0; i < Math.min(period, tr.length); i++) sum += tr[i];
  const seed = sum / Math.min(period, tr.length);
  for (let i = 0; i < period && i < bars.length; i++) atr[i] = seed;

  for (let i = period; i < bars.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }

  return atr;
}

const ATR_OFFSET_MULT = 2.5;

function generateZoneDotMarkers(
  signals: IndicatorSignalMarker[],
  bars: OhlcBar[],
  version: 'V1' | 'V2',
): DotMarker[] {
  if (signals.length === 0 || bars.length === 0) return [];
  const atr = computeATR(bars);
  const markers: DotMarker[] = [];
  for (const signal of signals) {
    const idx = signal.index;
    const bar = bars[idx];
    if (!bar) continue;
    const offset = atr[idx] * ATR_OFFSET_MULT;
    const y = signal.direction === 'long' ? bar.l - offset : bar.h + offset;
    markers.push({
      d: signal.d,
      index: idx,
      direction: signal.direction,
      y,
      version,
      signalType: signal.signalType,
    });
  }
  return markers;
}

const TS_DOT_OFFSET = 3;

function generateTrendStrengthDotMarkers(
  signals: IndicatorSignalMarker[],
  data: IndicatorIntervalData,
): DotMarker[] {
  if (signals.length === 0 || data.length === 0) return [];
  const markers: DotMarker[] = [];
  for (const signal of signals) {
    const idx = signal.index;
    const point = data[idx];
    if (!point || point.diHist === null) continue;
    markers.push({
      d: signal.d,
      index: idx,
      direction: signal.direction,
      y: point.diHist + (signal.direction === 'long' ? TS_DOT_OFFSET : -TS_DOT_OFFSET),
      version: 'TS',
      signalType: signal.signalType,
    });
  }
  return markers;
}

const HTF_WINDOW_LONG_COLOR = '#4caf50';
const HTF_WINDOW_SHORT_COLOR = '#f44336';
const HTF_WINDOW_Y = 6;

function generateHtfWindowData(
  htfData: IndicatorIntervalData,
  ltfBars: OhlcBar[],
): HtfWindowPoint[] {
  if (htfData.length === 0 || ltfBars.length === 0) return [];

  // Build a sorted map of HTF date -> zoneV2
  const entries: [string, number][] = [...htfData]
    .filter(p => p.zoneV2 !== null && Number.isFinite(p.zoneV2))
    .map(p => [p.d, p.zoneV2 as number]);
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  const htfByDate = new Map<string, number>(entries);
  const sortedDates = Array.from(htfByDate.keys()).sort();

  const result: HtfWindowPoint[] = [];
  for (const bar of ltfBars) {
    // Find most recent HTF date at or before this LTF bar
    let htfDate: string | null = null;
    for (const d of sortedDates) {
      if (d <= bar.d) htfDate = d;
      else break;
    }
    if (!htfDate) continue;
    const zone = htfByDate.get(htfDate) ?? 0;

    if (zone > 0) {
      result.push({ d: bar.d, y: -HTF_WINDOW_Y, color: HTF_WINDOW_LONG_COLOR });
    } else if (zone < 0) {
      result.push({ d: bar.d, y: HTF_WINDOW_Y, color: HTF_WINDOW_SHORT_COLOR });
    } else {
      result.push({ d: bar.d, y: -HTF_WINDOW_Y, color: HTF_WINDOW_LONG_COLOR });
      result.push({ d: bar.d, y: HTF_WINDOW_Y, color: HTF_WINDOW_SHORT_COLOR });
    }
  }
  return result;
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

  dailySignals.dotMarkers = {
    trendStrength: generateTrendStrengthDotMarkers(dailySignals.trendStrength, daily),
  };
  weeklySignals.dotMarkers = {
    trendStrength: generateTrendStrengthDotMarkers(weeklySignals.trendStrength, weekly),
  };
  monthlySignals.dotMarkers = {
    trendStrength: generateTrendStrengthDotMarkers(monthlySignals.trendStrength, monthly),
  };

  // Emit all zone signals for the daily and weekly intervals (used for chart dots)
  if (dailyBars.length >= 45 && weeklyBars.length >= 30) {
    dailySignals.zoneV1 = generateZoneSignals(daily, 'V1', 'D');
    dailySignals.zoneV2 = generateZoneSignals(daily, 'V2', 'D');
    dailySignals.dotMarkers = {
      ...dailySignals.dotMarkers,
      zoneV1: generateZoneDotMarkers(dailySignals.zoneV1, dailyBars, 'V1'),
      zoneV2: generateZoneDotMarkers(dailySignals.zoneV2, dailyBars, 'V2'),
    };
    dailySignals.htfWindows = {
      weekly: generateHtfWindowData(weekly, dailyBars),
    };
  }
  if (weeklyBars.length >= 45 && monthlyBars.length >= 30) {
    weeklySignals.zoneV1 = generateZoneSignals(weekly, 'V1', 'W');
    weeklySignals.zoneV2 = generateZoneSignals(weekly, 'V2', 'W');
    weeklySignals.dotMarkers = {
      ...weeklySignals.dotMarkers,
      zoneV1: generateZoneDotMarkers(weeklySignals.zoneV1, weeklyBars, 'V1'),
      zoneV2: generateZoneDotMarkers(weeklySignals.zoneV2, weeklyBars, 'V2'),
    };
    weeklySignals.htfWindows = {
      monthly: generateHtfWindowData(monthly, weeklyBars),
    };
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
        indicators: splitIndicatorInterval(indicators.daily),
        signals: signals.daily,
        dotMarkers: signals.daily.dotMarkers,
        htfWindows: signals.daily.htfWindows,
      },
      weekly: {
        indicators: splitIndicatorInterval(indicators.weekly),
        signals: signals.weekly,
        dotMarkers: signals.weekly.dotMarkers,
        htfWindows: signals.weekly.htfWindows,
      },
      monthly: {
        indicators: splitIndicatorInterval(indicators.monthly),
        signals: signals.monthly,
        dotMarkers: signals.monthly.dotMarkers,
      },
    },
  };
}
