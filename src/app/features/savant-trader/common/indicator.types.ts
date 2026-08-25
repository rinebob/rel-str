/**
 * Frontend mirror of the backend indicator series callable types.
 *
 * These types intentionally duplicate the backend types in
 * functions/src/st-cloud-function/indicator-computation.ts
 * to avoid the shared-library build issues we have hit in other projects.
 * Keep them in sync with the backend.
 */

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

export interface GetIndicatorSeriesRequest {
  symbol: string;
  marketDate?: string;
  intervals?: ChartInterval[];
  indicators?: IndicatorFamily[];
  strategies?: StrategyFamily[];
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

export interface DotMarker {
  d: string;
  index: number;
  direction: 'long' | 'short';
  y: number;
  version: 'V1' | 'V2' | 'TS';
  signalType: string;
}

export interface HtfWindowPoint {
  d: string;
  y: number;
  color: string;
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
    zoneV1?: SignalMarker[];
    zoneV2?: SignalMarker[];
    trendStrength?: SignalMarker[];
    triggerBands?: SignalMarker[];
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
  bands: BandPoint[]; // Array of 4 bands, indexed by bandIndex (1..4)
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

export interface TriggerBandsPoint {
  d: string;
  // Trigger band fields TBD in Phase 2
}

/** @deprecated Use the per-family point types instead. */
export interface IndicatorDataPoint {
  d: string;
  zoneV1: number | null;
  zoneV2: number | null;
  diPlus: number | null;
  diMinus: number | null;
  diHist: number | null;
  adx: number | null;
  bands: BandPoint[];
  htfZoneV2: number | null;
}

export interface SignalMarker {
  d: string;
  index: number;
  direction: 'long' | 'short';
  signalType: string;
  reason: string;
}
