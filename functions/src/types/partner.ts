/**
 * Functions: Partner types
 * Options contract DTOs are shared via @options-contract/contracts
 * (shared/options-contract-contracts.ts) and re-exported below.
 */

/** Public DTO for tracked symbols returned by partner-backed callable.
 *  Mirrors the upstream/tracked-symbols document shape so we can persist
 *  consistent docs into `symbol-data`.
 */
export interface TrackedSymbolDTO {
  symbol: string;
  name?: string;
  supported?: boolean;
  isBaseline?: boolean;
  currency?: string;
  region?: string;
  timezone?: string;
  type?: string;
  marketOpen?: string;
  marketClose?: string;
  matchScore?: string;
}

/** Response shape for getTrackedSymbols callable. */
export interface GetTrackedSymbolsResponse {
  items: TrackedSymbolDTO[];
  cached: boolean;
  updatedAt?: number;
}

/** Partner function endpoint path segments. */
export enum PartnerEndpointPath {
  TRACKED_SYMBOLS = 'partnerListTrackedSymbolsV2',
  TIME_SERIES = 'partnerTimeSeriesV2',
  MARKET_HOLIDAYS = 'partnerMarketHolidays',
  INTRADAY_SNAPSHOT = 'partnerIntradaySnapshotV2',
  COMPANY_OVERVIEW = 'partnerCompanyOverviewV2',
  HISTORICAL_OPTIONS = 'partnerHistoricalOptionsV2',
  HISTORICAL_OPTIONS_CONTRACT_V2 = 'partnerHistoricalOptionsContractV2',
  LIST_CONTRACTS_V2 = 'partnerListContractsV2',
}

export enum OptionType {
  CALL = 'call',
  PUT = 'put',
}

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

/** Response shape for partnerHistoricalOptionsV2 endpoint. */
export interface PartnerHistoricalOptionsResponse {
  ok: boolean;
  symbol: string;
  date: string | null;
  source: string;
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

export type {
  HistoricalOptionsContractV2Observation,
  PartnerHistoricalOptionsContractV2Response,
  GetHistoricalOptionsContractRequest,
  ListContractsV2Contract,
  PartnerListContractsV2Response,
  GetListContractsRequest,
} from '@options-contract/contracts';

/** Raw AV data fields from company overview — all values are strings. */
export interface PartnerOverviewData extends Record<string, string> {}

/** Response shape for partnerCompanyOverviewV2 endpoint. */
export interface PartnerCompanyOverviewResponse {
  ok: boolean;
  symbol: string;
  data: PartnerOverviewData;
  metadata: {
    lastUpdated: string;
    nextUpdate: string;
    ttlSeconds: number;
    vendor: string;
    endpoint: string;
  };
  timestamp: string;
  processingTimeMs: number;
}

/** RS calculation phase for a day's value. */
export enum RsPhase {
  PRE = 'pre',
  POST = 'post',
}

export enum MarketHolidayStatus {
  CLOSED = 'closed',
  EARLY_CLOSE = 'early_close',
}

export interface MarketHolidayItem {
  name: string;
  date: string; // YYYY-MM-DD
  status: MarketHolidayStatus;
  earlyCloseEt?: string;
  notes?: string;
}

export interface PartnerMarketHolidaysResponse {
  ok: boolean;
  year: string;
  holidays: MarketHolidayItem[];
  processingTimeMs?: number;
  timestamp?: string;
}

/** Intraday snapshot item from partnerIntradaySnapshotV2 endpoint. */
export interface IntradaySnapshotItem {
  symbol: string;
  ip: number;      // Latest intraday price
  ipc: number;     // Intraday change %
  io: number;      // Epoch ms timestamp
  it: string;      // Time string (e.g., "10:30")
  ic: number;      // Intraday change $
}

/** Response shape for partnerIntradaySnapshotV2 endpoint. */
export interface PartnerIntradaySnapshotResponse {
  ok: true;
  marketDate: string;
  count: number;
  snapshots: IntradaySnapshotItem[];
}

/** Response shape for partnerListTrackedSymbolsV2 endpoint. */
export interface PartnerListTrackedSymbolsResponse {
  ok: true;
  count: number;
  symbols: string[];  // Just the symbol strings
  timestamp?: string;
}

// PhasePreference removed: selection is fixed by rubric (historical: POST-only; today: POST else PRE)
