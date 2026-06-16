/**
 * Functions: Partner types
 * Note: Keep in sync with FE types at `src/app/core/models/partner.types.ts`.
 * If you change fields here, reflect the same shape there. # TODO(sync): FE/BE contract
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

// PhasePreference removed: selection is fixed by rubric (historical: POST-only; today: POST else PRE)
