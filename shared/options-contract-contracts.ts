/**
 * Shared contracts for the options contract viewer feature.
 *
 * Pure type and utility definitions with no runtime dependencies so they can
 * be imported by both the Firebase functions backend and the Angular frontend.
 */

import { OptionType } from './options-common';

export { OptionType, parseOccContractId, buildOccContractId, normalizeOptionType } from './options-common';
export type { ParsedOccContractId } from './options-common';

/** One historical options time-series observation for a single contract. */
export interface HistoricalOptionsContractV2Observation {
  date: string;
  last?: string;
  mark?: string;
  bid?: string;
  bid_size?: string;
  ask?: string;
  ask_size?: string;
  volume?: string;
  open_interest?: string;
  implied_volatility?: string;
  delta?: string;
  gamma?: string;
  theta?: string;
  vega?: string;
  rho?: string;
}

/** A (openDate, contractId) pair from a Contract List row or pasted input.
 *  `openDate` is the position entry date used for the span marker and
 *  clip-to-entry; `null` for bare IDs pasted without a date. */
export interface PlottedEntry {
  contractId: string;
  openDate: string | null;
}

/** Response shape for partnerHistoricalOptionsContractV2 endpoint. */
export interface PartnerHistoricalOptionsContractV2Response {
  ok: boolean;
  symbol: string;
  contractID: string;
  expiration: string;
  type: 'call' | 'put';
  strike: string;
  startDate: string;
  endDate: string;
  series: HistoricalOptionsContractV2Observation[];
}

/** Request shape for the getHistoricalOptionsContract callable. */
export interface GetHistoricalOptionsContractRequest {
  symbol: string;
  contractID: string;
  length?: string | null;
}

// ==========================
// Contract Discovery (partnerListContractsV2)
// ==========================

/** One contract entry returned by the partnerListContractsV2 endpoint. */
export interface ListContractsV2Contract {
  contractId: string;
  expiration: string;
  strike: number;
  type: 'C' | 'P';
}

/** Response shape for partnerListContractsV2 endpoint. */
export interface PartnerListContractsV2Response {
  ok: boolean;
  symbol: string;
  contracts: ListContractsV2Contract[];
  count: number;
}

/** Request shape for the listOptionsContracts callable. */
export interface GetListContractsRequest {
  symbol: string;
  expiration?: string;
  strike?: number;
  type?: 'C' | 'P';
}

// ==========================
// Contract Index (options-file-index cross-project read)
// ==========================

/** One expiration entry in the options contract index. */
export interface ExpirationIndexEntry {
  date: string;
  strikes: number[];
}

/** One strike entry in the options contract index. */
export interface StrikeIndexEntry {
  strike: number;
  expirations: string[];
}

/** Response shape for the getOptionsContractIndex callable. */
export interface OptionsContractIndexResponse {
  ok: boolean;
  symbol: string;
  expirations: ExpirationIndexEntry[];
  strikes: StrikeIndexEntry[];
}

/** Request shape for the getOptionsContractIndex callable. */
export interface GetOptionsContractIndexRequest {
  symbol: string;
}

// ==========================
// Contract Catalog (partnerContractCatalogV2)
// ==========================

/** Latest snapshot of greeks/liquidity from the most recent observation. */
export interface ContractLatestSnapshot {
  mark?: string;
  volume?: string;
  openInterest?: string;
  iv?: string;
  delta?: string;
  gamma?: string;
  theta?: string;
  vega?: string;
  rho?: string;
}

/** One contract entry in the catalog response. */
export interface ContractCatalogEntry {
  contractId: string;
  expiration: string;
  strike: number;
  type: 'call' | 'put';
  firstObserved: string;
  lastObserved: string;
  observationCount: number;
  expectedObservationCount: number;
  contractLengthDays: number | null;
  contractLengthBucket: string;
  latest?: ContractLatestSnapshot;
}

/** Response shape for catalog mode. */
export interface ContractCatalogResponse {
  ok: boolean;
  symbol: string;
  contracts: ContractCatalogEntry[];
  count: number;
  nextPageToken?: string;
}

/** Single entry in the length-buckets array returned by summary mode. */
export interface LengthBucket {
  label: string;
  count: number;
  sortOrder: number;
}

/** Response shape for summary mode. */
export interface ContractSummaryResponse {
  ok: boolean;
  symbol: string;
  totalContracts: number;
  expirationCount: number;
  lengthBuckets: LengthBucket[];
  lastUpdated: string;
}

/** Request shape for the queryContractCatalog callable. */
export interface QueryContractCatalogRequest {
  symbol: string;
  summary?: boolean;
  expiration?: string;
  expirationGte?: string;
  expirationLte?: string;
  firstObservedGte?: string;
  firstObservedLte?: string;
  contractLengthBucket?: string;
  type?: 'C' | 'P';
  strike?: number;
  strikeGte?: number;
  strikeLte?: number;
  deltaGte?: number;
  deltaLte?: number;
  ivGte?: number;
  ivLte?: number;
  minObservationCount?: number;
  sortBy?: 'expiration' | 'strike' | 'contractLengthDays' | 'observationCount' | 'delta';
  sortOrder?: 'asc' | 'desc';
  pageSize?: number;
  pageToken?: string;
}

// ==========================
// Historical Options Chain Snapshot (partnerHistoricalOptionsV2)
// ==========================

/** One Alpha Vantage historical option contract. All market-data values are optional strings. */
export interface HistoricalOptionContract {
  contractID?: string;
  symbol?: string;
  expiration?: string; // YYYY-MM-DD
  strike?: string;
  type?: OptionType;
  last?: string;
  mark?: string;
  bid?: string;
  bid_size?: string;
  ask?: string;
  ask_size?: string;
  volume?: string;
  open_interest?: string;
  date?: string;
  implied_volatility?: string;
  delta?: string;
  gamma?: string;
  theta?: string;
  vega?: string;
  rho?: string;
}

/** Aggregate analysis summary returned by partnerHistoricalOptionsV2. */
export interface HistoricalOptionsAnalysisSummary {
  totalContracts: number;
  totalVolume: number;
  totalOpenInterest: number;
  callContracts: number;
  putContracts: number;
  uniqueStrikes: number;
  avgVolumePerContract: number;
  avgOpenInterest: number;
}

/** Expiration-level breakdown in the options analysis. */
export interface HistoricalOptionsExpirationGroup {
  expiration: string;
  contractCount: number;
  timeUntilExpiration: string;
  callVolume: number;
  putVolume: number;
  callOpenInterest: number;
  putOpenInterest: number;
}

/** Strike-level breakdown in the options analysis. */
export interface HistoricalOptionsStrikeGroup {
  strike: string;
  callVolume: number;
  putVolume: number;
  callOpenInterest: number;
  putOpenInterest: number;
  totalVolume: number;
  totalOpenInterest: number;
}

/** Request shape for the getHistoricalOptionsChain callable. */
export interface GetHistoricalOptionsChainRequest {
  symbol: string;
  date: string; // YYYY-MM-DD
}

/** Response shape for the getHistoricalOptionsChain callable — raw pass-through of PartnerHistoricalOptionsResponse. */
export interface GetHistoricalOptionsChainResponse {
  ok: boolean;
  symbol: string;
  date: string | null;
  source?: string;
  endpoint: string;
  data: {
    endpoint?: string;
    message?: string;
    data: HistoricalOptionContract[];
  };
  analysis: {
    summary: HistoricalOptionsAnalysisSummary;
    expirations: HistoricalOptionsExpirationGroup[];
    strikes: HistoricalOptionsStrikeGroup[];
  };
  timestamp: string;
  processingTimeMs: number;
}

// ==========================
// Contract Availability (partnerContractAvailabilityV1)
// ==========================

/** Latest observation snapshot — absent on backfilled expired contracts. */
export interface ContractAvailabilityLatestSnapshot {
  mark?: string;
  iv?: string;
  delta?: string;
  volume?: string;
  openInterest?: string;
}

/** One contract entry in the availability response. */
export interface ContractAvailabilityEntry {
  contractId: string; // OCC-format id
  expiration: string; // YYYY-MM-DD
  strike: number;
  type: 'call' | 'put';
  /** First trading day with data — the proxy for listing date. */
  firstObserved: string;
  firstObservedDow?: string;
  lastObserved: string;
  lastObservedDow?: string;
  observationCount?: number;
  expectedObservationCount?: number;
  contractLengthDays?: number;
  contractLengthBucket?: string;
  latest?: ContractAvailabilityLatestSnapshot;
  latestDelta?: number;
  latestIv?: number;
}

/** Request params for the availability endpoint (GET query). */
export interface ContractAvailabilityRequest {
  symbol: string;
  expirationGte?: string;
  expirationLte?: string;
  /** Explicit list — overrides expirationGte/Lte server-side. */
  expirations?: string[];
  strikeGte?: number;
  strikeLte?: number;
  /** Strike must be an exact multiple of the step, within bounds. */
  strikeStep?: number;
  type?: 'C' | 'P' | 'call' | 'put';
  firstObservedGte?: string;
  firstObservedLte?: string;
}

/** Response shape for the availability endpoint. */
export interface ContractAvailabilityResponse {
  ok: boolean;
  symbol: string;
  count: number;
  /** True at the 2000-contract cap — deterministic sort. */
  truncated: boolean;
  contracts: ContractAvailabilityEntry[];
  /** Symbol-level corpus dates — the chart's valid x-axis domain. */
  corpusDates?: string[];
  corpusDateCount?: number;
}
