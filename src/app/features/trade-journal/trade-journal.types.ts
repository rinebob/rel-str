import { TradeDirection, TradeStatus } from '../../core/common/constants';

export interface TradeJournalListItem {
  id: string;
  symbol: string;
  direction: TradeDirection;
  status: TradeStatus;
  entryDate: string;
  entryPrice?: number | null;
  exitDate?: string | null;
  pnlPct?: number | null;
  /** Optional URL for the primary screenshot associated with this trade. */
  screenshotUrl?: string | null;
  /** Optional backend paths for associated files; used for edit flows. */
  brokerCsvPaths?: string[] | null;
  indicatorCsvPaths?: string[] | null;
  screenshotPaths?: string[] | null;
}

/**
 * Operation mode for the JSON-based trade upsert pipeline.
 */
export enum TradeUpsertOperation {
  CREATE = 'CREATE',
  EDIT = 'EDIT',
}

/**
 * Root segments and bucket names for trade-related Storage paths.
 * These are mirrored in Cloud Functions for validation.
 */
export const TRADE_STORAGE_ROOT = 'trades';
export const TRADE_USERS_SEGMENT = 'users';

export const TRADE_BUCKET_SCREENSHOTS = 'screenshots';
export const TRADE_BUCKET_BROKER_CSVS = 'brokerCsvs';
export const TRADE_BUCKET_INDICATOR_CSVS = 'indicatorCsvs';

export type TradeStorageBucket =
  | typeof TRADE_BUCKET_SCREENSHOTS
  | typeof TRADE_BUCKET_BROKER_CSVS
  | typeof TRADE_BUCKET_INDICATOR_CSVS;

export function buildTradeBucketPrefix(uid: string, tradeId: string, bucket: TradeStorageBucket): string {
  return `${TRADE_STORAGE_ROOT}/${TRADE_USERS_SEGMENT}/${uid}/${tradeId}/${bucket}`;
}

export interface TradeUpsertDto {
  operation: TradeUpsertOperation;
  /** Client-generated trade identifier used as Firestore doc id and Storage prefix. */
  tradeId: string;
  trade: TradeJournalListItem;
  brokerCsvPaths: string[];
  indicatorCsvPaths: string[];
  screenshotPaths: string[];
  deletedBrokerCsvPaths?: string[];
  deletedIndicatorCsvPaths?: string[];
  deletedScreenshotPaths?: string[];
}

export interface TradeUpsertResponse {
  trade: TradeJournalListItem;
  brokerCsvPaths: string[];
  indicatorCsvPaths: string[];
  screenshotPaths: string[];
}
