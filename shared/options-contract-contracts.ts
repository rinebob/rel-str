/**
 * Shared contracts for the options contract viewer feature.
 *
 * Pure type and utility definitions with no runtime dependencies so they can
 * be imported by both the Firebase functions backend and the Angular frontend.
 */

/** Parsed OCC-style contract ID. */
export interface ParsedOccContractId {
  symbol: string;
  contractID: string;
  expiration: string;
  type: 'CALL' | 'PUT';
  strike: number;
}

/**
 * Parse an OCC-style contract ID (e.g. "QQQ240719C00450000") into its
 * constituent parts: underlying symbol, expiration date, type, and strike.
 */
export function parseOccContractId(occId: string): ParsedOccContractId | null {
  const id = String(occId || '').trim().toUpperCase();
  if (!id) return null;

  const match = id.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
  if (!match) return null;

  const [, symbol, dateStr, typeChar, strikeStr] = match;
  const year = 2000 + Number(dateStr.slice(0, 2));
  const month = dateStr.slice(2, 4);
  const day = dateStr.slice(4, 6);

  return {
    symbol,
    contractID: id,
    expiration: `${year}-${month}-${day}`,
    type: typeChar === 'C' ? 'CALL' : 'PUT',
    strike: Number(strikeStr) / 1000,
  };
}

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

/** Response shape for summary mode. */
export interface ContractSummaryResponse {
  ok: boolean;
  symbol: string;
  totalContracts: number;
  expirationCount: number;
  lengthBuckets: Record<string, number>;
  lastUpdated: string;
}

/** Request shape for the queryContractCatalog callable. */
export interface QueryContractCatalogRequest {
  symbol: string;
  summary?: boolean;
  expiration?: string;
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
