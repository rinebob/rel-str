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
