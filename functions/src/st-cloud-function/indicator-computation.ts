/**
 * ST Indicator Computation
 *
 * Pure indicator computation (no Firebase / no Cloud Functions imports).
 * Used by the callable, the worker, and local backfill scripts so that
 * scripts do not trigger Firebase Admin SDK initialization at import time.
 */
import { computeStTrendBands } from '@st/trend-bands';
import { computeStZone } from '@st/zone';
import { computeStZoneV2 } from '@st/zone-v2';
import { computeStTrendStrength } from '../indicators/st-trend-strength';
import { computeStTriggerBands } from '../indicators/st-trigger-bands';
import { detectZoneUptickCandidates, detectZoneZeroCrossCandidates } from '@st/signal-detect';
import type { ZoneSignalCandidate } from '@st/signal-detect';
import { partitionByIbs } from '@st/signal-filter';
import type { IbsFilterContext, Partitioned } from '@st/signal-filter';
import type { OHLCV } from '@st/trend-bands';
import type { OhlcBar } from '../common/market-data-types';
import {
  ST_HTF_WINDOW,
  ST_SIGNAL_DOT_OFFSET,
  ST_TREND_BAND_COLORS,
  TRIGGER_BANDS_SIGNAL_TYPES,
} from '@flex-chart/indicator-visuals';
import type { TriggerBandsSignalType } from '@flex-chart/indicator-visuals';

// =============================================================================
// TYPES
// =============================================================================

export interface IndicatorSignalMarker {
  d: string;                    // bar date
  index: number;                // bar index in the interval's bars array
  direction: 'long' | 'short';
  signalType: string;
  reason: string;
  ibs?: number | null;          // signal bar's IBS (partition-attached; null when uncomputable)
}

export interface DotMarker {
  d: string;                    // bar date
  index: number;                // bar index in the interval's bars array
  direction: 'long' | 'short';
  y: number;                    // chart y-coordinate (price with ATR offset, or DI hist with offset)
  version: 'V1' | 'V2' | 'TS' | 'TB';
  signalType: string;
  ibs?: number | null;          // signal bar's IBS (partition-attached; null when uncomputable)
}

/** Zone dot markers partitioned by the IBS filter — `emitted` is what charts
 *  draw today; `suppressed` is the ghost set FE renders under #1680. */
export interface ZoneDotMarkers {
  emitted: DotMarker[];
  suppressed: DotMarker[];
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
  htfDiHist: number | null;
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
  htfDiHist: number | null;
  adx: number | null;
}

export interface TrendBandsPoint {
  d: string;
  bands: BandPoint[];
}

export interface TriggerBandsPoint {
  d: string;
  upper: number | null;
  lower: number | null;
  longPullback: boolean;
  longPullbackState: boolean;
  longBreakout: boolean;
  shortPullback: boolean;
  shortPullbackState: boolean;
  shortBreakout: boolean;
}

export interface SignalIntervalData {
  zoneV1?: IndicatorSignalMarker[];
  zoneV2?: IndicatorSignalMarker[];
  trendStrength?: IndicatorSignalMarker[];
  dotMarkers?: {
    zoneV1?: ZoneDotMarkers;
    zoneV2?: ZoneDotMarkers;
    trendStrength?: DotMarker[];
    triggerBands?: DotMarker[];
  };
  htfWindows?: {
    weekly?: HtfWindowPoint[];
    monthly?: HtfWindowPoint[];
  };
}

// Canonical definition lives in shared/screenshot-capture-contracts.ts
// (#765) — re-exported here so existing import sites keep working.
export { ChartInterval } from '@screenshot-capture/contracts';

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
  };
  dotMarkers?: {
    zoneV1?: ZoneDotMarkers;
    zoneV2?: ZoneDotMarkers;
    trendStrength?: DotMarker[];
    triggerBands?: DotMarker[];
  };
  htfWindows?: {
    weekly?: HtfWindowPoint[];
    monthly?: HtfWindowPoint[];
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function barsToOhlcv(bars: OhlcBar[]): OHLCV[] {
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
  const [bullColor, bearColor] = ST_TREND_BAND_COLORS[bandIndex - 1] ?? ['#999999', '#999999'];
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
      htfDiHist: null,
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
    htfDiHist: toNullable(strength.htfDiHist[i]),
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
      htfDiHist: p.htfDiHist,
      adx: p.adx,
    })),
    trendBands: data.map(p => ({ d: p.d, bands: p.bands })),
  };
}

function emptySignalInterval(): SignalIntervalData {
  return {};
}

export interface ZoneSignalSets {
  emitted: IndicatorSignalMarker[];
  suppressed: IndicatorSignalMarker[];
}

/**
 * Detect zone signal candidates for chart markers and partition them by the
 * signal bar's IBS. Uses the SAME shared detectors + partition as the
 * strategy path (@st/signal-detect + @st/signal-filter) so emitted markers
 * are exactly the signals the strategy emits on the same bars.
 *
 * `bars` is index-aligned with `data` (both derive from the same OhlcBar[]
 * — point i describes bar i); the partition reads each candidate's IBS off
 * `bars[candidate.index]`. Suppression is emission-only — the detectors'
 * FIRED latches are consumed on suppressed candidates, so nothing re-fires.
 *
 * ALWAYS-FILTERED contract: `ibsCtx` overrides the filter context (specs
 * inject `now`; prod omits it → `{}` = filter at default 0.5 / wall clock).
 * There is deliberately no unfiltered mode on this path — `partitionByIbs`'s
 * `ctx === undefined` pass-through is unreachable from here.
 */
export function generateZoneSignals(
  data: IndicatorDataPoint[],
  bars: OhlcBar[],
  version: 'V1' | 'V2',
  timeframe: 'D' | 'W',
  ibsCtx: IbsFilterContext = {},
): ZoneSignalSets {
  const empty: ZoneSignalSets = { emitted: [], suppressed: [] };
  if (data.length < 2) return empty;
  // Structural invariant — `data` derives 1:1 from `bars` upstream; a
  // mismatch is a wiring bug, not a data condition, so fail loudly.
  if (data.length !== bars.length) {
    throw new Error(`generateZoneSignals: data/bars misaligned (${data.length} vs ${bars.length})`);
  }

  const zone = data.map((p: IndicatorDataPoint) => (version === 'V1' ? p.zoneV1 : p.zoneV2));
  // ST Trend Rider uses the same-timeframe zone as its own context, not a cross-zone
  // HTF check. The windowV2 parameter is kept so future strategies can supply a true
  // higher-timeframe window if needed.
  const windowV2 = zone;
  const zoneNumbers = zone.map((z: number | null) => (z === null ? NaN : z));
  const windowV2Numbers = windowV2.map((z: number | null) => (z === null ? NaN : z));

  const candidates = [
    ...detectZoneUptickCandidates(zoneNumbers, windowV2Numbers, version, timeframe),
    ...detectZoneZeroCrossCandidates(zoneNumbers, version, timeframe),
  ].sort((a, b) => a.index - b.index);
  if (candidates.length === 0) return empty;

  const partitioned = partitionByIbs(candidates, bars, timeframe, ibsCtx);
  const toMarker = (c: Partitioned<ZoneSignalCandidate>): IndicatorSignalMarker => ({
    d: data[c.index].d,
    index: c.index,
    direction: c.direction,
    signalType: c.signalType,
    reason: c.reason,
    ibs: c.ibs,
  });
  return {
    emitted: partitioned.emitted.map(toMarker),
    suppressed: partitioned.suppressed.map(toMarker),
  };
}

export function computeATR(bars: OhlcBar[], period = 14): number[] {
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

function zoneDotsFromSignals(
  signals: IndicatorSignalMarker[],
  bars: OhlcBar[],
  atr: number[],
  version: 'V1' | 'V2',
): DotMarker[] {
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
      ibs: signal.ibs,
    });
  }
  return markers;
}

/** Partitioned zone signals → the {emitted,suppressed} dotMarkers payload,
 *  computing ATR once per (interval, version) instead of once per set. */
function generateZoneDotMarkers(
  sets: ZoneSignalSets,
  bars: OhlcBar[],
  version: 'V1' | 'V2',
): ZoneDotMarkers {
  const empty: ZoneDotMarkers = { emitted: [], suppressed: [] };
  if (bars.length === 0) return empty;
  const atr = computeATR(bars);
  return {
    emitted: zoneDotsFromSignals(sets.emitted, bars, atr, version),
    suppressed: zoneDotsFromSignals(sets.suppressed, bars, atr, version),
  };
}

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
      y: point.diHist + (signal.direction === 'long' ? ST_SIGNAL_DOT_OFFSET : -ST_SIGNAL_DOT_OFFSET),
      version: 'TS',
      signalType: signal.signalType,
    });
  }
  return markers;
}

/** Chart-ready Trigger Bands series for one interval (independent of the 30-bar gate the other families use). */
function computeTriggerBandsSeries(bars: OhlcBar[]): TriggerBandsPoint[] {
  const r = computeStTriggerBands(barsToOhlcv(bars));
  return bars.map((b, i) => ({
    d: b.d,
    upper: r.upper[i] === null ? null : toNullable(r.upper[i] as number),
    lower: r.lower[i] === null ? null : toNullable(r.lower[i] as number),
    longPullback: r.longPullback[i],
    longPullbackState: r.longPullbackState[i],
    longBreakout: r.longBreakout[i],
    shortPullback: r.shortPullback[i],
    shortPullbackState: r.shortPullbackState[i],
    shortBreakout: r.shortBreakout[i],
  }));
}

// Closer to the bar than the zone dots (ATR_OFFSET_MULT) so a Trigger Bands
// breakout dot and a zone dot on the same bar do not overlap.
const TRIGGER_DOT_ATR_MULT = 1.5;

/** Breakout dots only — the pullback flags already show as band colour, so
 *  a dot per flagged/armed bar was noise. Long dots sit just below the
 *  lower band, short dots just above the upper band — outside the
 *  envelope, never inside the channel. */
function generateTriggerBandsDotMarkers(points: TriggerBandsPoint[], bars: OhlcBar[]): DotMarker[] {
  if (points.length === 0 || bars.length === 0) return [];
  const atr = computeATR(bars);
  const markers: DotMarker[] = [];
  points.forEach((p, i) => {
    const bar = bars[i];
    if (!bar) return;
    const offset = atr[i] * TRIGGER_DOT_ATR_MULT;
    const push = (direction: 'long' | 'short', signalType: TriggerBandsSignalType, y: number): void => {
      markers.push({ d: p.d, index: i, direction, y, version: 'TB', signalType });
    };
    if (p.longBreakout && p.lower !== null) push('long', TRIGGER_BANDS_SIGNAL_TYPES.LONG_BREAKOUT, p.lower - offset);
    if (p.shortBreakout && p.upper !== null) push('short', TRIGGER_BANDS_SIGNAL_TYPES.SHORT_BREAKOUT, p.upper + offset);
  });
  return markers;
}

// Canonical visual vocabulary lives in shared/flex-chart-indicator-visuals.ts
// (the assembler consumes the same constants — parity is structural).
const HTF_WINDOW_LONG_COLOR = ST_HTF_WINDOW.longColor;
const HTF_WINDOW_SHORT_COLOR = ST_HTF_WINDOW.shortColor;
const HTF_WINDOW_Y = ST_HTF_WINDOW.y;

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

/** Detect + partition one interval's zone signals (V1+V2), write its signals
 *  list (emitted only), its {emitted,suppressed} dotMarkers, and its HTF
 *  window dots. `htfKey` names the higher timeframe feeding the windows. */
function attachZoneSignals(
  out: SignalIntervalData,
  data: IndicatorIntervalData,
  bars: OhlcBar[],
  timeframe: 'D' | 'W',
  htfData: IndicatorIntervalData,
  htfKey: 'weekly' | 'monthly',
  ibsCtx?: IbsFilterContext,
): void {
  const v1 = generateZoneSignals(data, bars, 'V1', timeframe, ibsCtx);
  const v2 = generateZoneSignals(data, bars, 'V2', timeframe, ibsCtx);
  out.zoneV1 = v1.emitted;
  out.zoneV2 = v2.emitted;
  out.dotMarkers = {
    ...out.dotMarkers,
    zoneV1: generateZoneDotMarkers(v1, bars, 'V1'),
    zoneV2: generateZoneDotMarkers(v2, bars, 'V2'),
  };
  out.htfWindows = {
    ...out.htfWindows,
    [htfKey]: generateHtfWindowData(htfData, bars),
  };
}

function generateSymbolSignals(
  daily: IndicatorIntervalData,
  weekly: IndicatorIntervalData,
  monthly: IndicatorIntervalData,
  dailyBars: OhlcBar[],
  weeklyBars: OhlcBar[],
  monthlyBars: OhlcBar[],
  ibsCtx?: IbsFilterContext,
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

  // Emit zone signals for the daily and weekly intervals (used for chart dots).
  // IBS-partitioned: emitted markers mirror the strategy path's emitted set;
  // suppressed candidates persist as the ghost set for the FE (#1680).
  if (dailyBars.length >= 45 && weeklyBars.length >= 30) {
    attachZoneSignals(dailySignals, daily, dailyBars, 'D', weekly, 'weekly', ibsCtx);
  }
  if (weeklyBars.length >= 45 && monthlyBars.length >= 30) {
    attachZoneSignals(weeklySignals, weekly, weeklyBars, 'W', monthly, 'monthly', ibsCtx);
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
  ibsCtx?: IbsFilterContext,
): SymbolIndicatorSeriesResponse {
  const indicators = computeIndicatorSeries(dailyBars, weeklyBars, monthlyBars);
  const signals = generateSymbolSignals(indicators.daily, indicators.weekly, indicators.monthly, dailyBars, weeklyBars, monthlyBars, ibsCtx);

  const interval = (
    data: IndicatorIntervalData,
    sig: SignalIntervalData,
    bars: OhlcBar[],
  ): Pick<IntervalData, 'indicators' | 'signals' | 'dotMarkers'> => {
    const triggerBands = computeTriggerBandsSeries(bars);
    return {
      indicators: { ...splitIndicatorInterval(data), triggerBands },
      signals: sig,
      dotMarkers: { ...sig.dotMarkers, triggerBands: generateTriggerBandsDotMarkers(triggerBands, bars) },
    };
  };

  return {
    symbol,
    marketDate: todayIso(),
    computedAt: new Date().toISOString(),
    intervals: {
      daily: { ...interval(indicators.daily, signals.daily, dailyBars), htfWindows: signals.daily.htfWindows },
      weekly: { ...interval(indicators.weekly, signals.weekly, weeklyBars), htfWindows: signals.weekly.htfWindows },
      monthly: interval(indicators.monthly, signals.monthly, monthlyBars),
    },
  };
}
