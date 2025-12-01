/**
 * Frontend: Partner types
 * Keep in sync with Functions types at `functions/src/types/partner.ts`.
 * # TODO(sync): FE/BE contract – update both when these shapes change.
 */

export interface TrackedSymbolDTO {
  symbol: string;
  name?: string;
  exchange?: string;
  sector?: string;
  supported?: boolean;
  isBaseline?: boolean;
}

export interface GetTrackedSymbolsResponse {
  items: TrackedSymbolDTO[];
  cached: boolean;
  updatedAt?: number;
}

// ==========================
// RS chart / OHLCV DTOs
// Keep in sync with Functions types in `functions/src/rs-chart-bars.callables.ts`.
// ==========================

/** Supported bar intervals for Savant / RS chart OHLC requests. */
export enum BarsInterval {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}

export interface GetPairDailyBarsRequest {
  symbol: string;
  interval?: BarsInterval;
  yearsBack?: number;
  days?: number;
  limit?: number;
}

export interface PartnerDailyBarDTO {
  date: string;       // YYYY-MM-DD
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  issues?: string[];
}

export interface GetPairDailyBarsResponse {
  bars: PartnerDailyBarDTO[];
}
