/**
 * Frontend: Partner types
 * Options contract DTOs are shared via @options-contract/contracts
 * (shared/options-contract-contracts.ts) and re-exported below.
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
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  adjusted?: boolean; // Default true for split-adjusted data
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

// ==========================
// Historical Options Contract V2 DTOs
// Single source of truth: shared/options-contract-contracts.ts
// ==========================

export type {
  HistoricalOptionsContractV2Observation,
  PartnerHistoricalOptionsContractV2Response,
  GetHistoricalOptionsContractRequest,
  ListContractsV2Contract,
  PartnerListContractsV2Response,
  GetListContractsRequest,
} from '@options-contract/contracts';
