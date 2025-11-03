/**
 * Functions: Partner types
 * Note: Keep in sync with FE types at `src/app/core/models/partner.types.ts`.
 * If you change fields here, reflect the same shape there. # TODO(sync): FE/BE contract
 */

/** Public DTO for tracked symbols returned by partner-backed callable. */
export interface TrackedSymbolDTO {
  symbol: string;
  name?: string;
  exchange?: string;
  sector?: string;
  supported?: boolean;
  isBaseline?: boolean;
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
}

/** RS calculation phase for a day's value. */
export enum RsPhase {
  PRE = 'pre',
  POST = 'post',
}

// PhasePreference removed: selection is fixed by rubric (historical: POST-only; today: POST else PRE)
