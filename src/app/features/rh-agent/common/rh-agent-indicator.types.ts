/**
 * Frontend mirror of the backend indicator series callable types.
 *
 * These types intentionally duplicate the backend types in
 * functions/src/rh-agent-cloud-function/rh-agent-indicator-computation.ts
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

export interface IntervalData {
  indicators: {
    zoneV1?: IndicatorDataPoint[];
    zoneV2?: IndicatorDataPoint[];
    trendStrength?: IndicatorDataPoint[];
    trendBands?: TrendBandsPoint[];
    triggerBands?: TriggerBandsPoint[];
  };
  signals: {
    zoneV1?: SignalMarker[];
    zoneV2?: SignalMarker[];
    trendStrength?: SignalMarker[];
    triggerBands?: SignalMarker[];
  };
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
  htfZoneV2: number | null;
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

export interface SignalMarker {
  d: string;
  index: number;
  direction: 'long' | 'short';
  signalType: string;
  reason: string;
}
