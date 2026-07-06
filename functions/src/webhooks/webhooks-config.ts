/**
 * Webhooks Config and Shared Types
 *
 * Centralizes constants, enums, and shared types used across the partner webhooks pipeline.
 *
 * Overall data flow summary (high level):
 * 1) Pub/Sub partner publishes data-ready messages to PARTNER_DATA_READY_TOPIC.
 * 2) Our Cloud Function (V2) subscriber parses the message, computes a stable event document ID,
 *    and records status/metrics in EVENTS_COLLECTION.
 * 3) We load baseline–target pairs from REGISTRY_COLLECTION and for each pair:
 *    - Fetch recent bars from the partner
 *    - Build phase-aware series (pre or post)
 *    - Write unified pairs data into Firestore under pairs/*
 * 4) We record completion metrics, sampled errors, and latest timestamps back to EVENTS_COLLECTION.
 *
 * This file holds topic names, collection names, fixed RS processing window sizes, run-type enums,
 * and shared type definitions used across modules.
 */
import { PartnerInterval } from '../partner-proxy';
import { RsDirection } from '../types/signal.types';

/**
 * Canonical Cloud Function names for warning events. Keep stable for UI filters.
 */
export enum RsCloudFunctionName {
  PROCESS_DATA_READY = 'processDataReadyRunV2',
  PROCESS_PAIR_LIVE = 'processPairLive',
  RECOMPUTE_BACKFILL = 'recomputeRegisteredBackfill',
  GET_TRACKED_SYMBOLS = 'getTrackedSymbols',
  VALIDATE_AND_REGISTER = 'validateAndRegisterPairs',
  UNREGISTER_PAIRS = 'unregisterPairs',
  WRITE_UNIFIED_SERIES = 'writeUnifiedSeries',
}

/**
 * Ingestion status for a pair in the registry/catalog. Used to track
 * backfill/ingestion health across the static universe of pairs.
 */
export enum PairIngestionStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED',
}

/**
 * Source of a pair in the registry/catalog.
 */
export enum PairSource {
  MVP_CONFIG = 'MVP_CONFIG',
  LIST = 'LIST',
  BULK_IMPORT_2026_0115_NEW = '2026-01-15-bulk-pairs-import-new',
  BULK_IMPORT_2026_0115_EXISTING = '2026-01-15-bulk-pairs-import-existing',
}

/**
 * Pub/Sub topic for partner data-ready notifications. This is the upstream
 * producer topic; our function subscribes and reacts as a consumer.
 *
 * In the emulator we mirror the full resource name (projects/rel-str/topics/*)
 * so that it matches the topics created via gcloud and listed by the
 * Pub/Sub emulator. In production we use the cross-project topic name in
 * alpha-vantage-proxy-api.
 */
export const PARTNER_DATA_READY_TOPIC =
  process.env.FUNCTIONS_EMULATOR === 'true'
    ? 'projects/rel-str/topics/partner-data-ready'
    : 'projects/alpha-vantage-proxy-api/topics/partner-data-ready';

/**
 * Pub/Sub topic for partner symbol-level readiness notifications. This is a
 * low-latency stream that emits batches of symbols whose
 * DAILY/WEEKLY/MONTHLY time-series data are ready for a given marketDate.
 *
 * In the emulator we mirror the full resource name (projects/rel-str/topics/*)
 * so that it matches the topics created via gcloud and listed by the
 * Pub/Sub emulator. In production we use the cross-project topic name.
 */
export const PARTNER_SYMBOLS_READY_TOPIC =
  process.env.FUNCTIONS_EMULATOR === 'true'
    ? 'projects/rel-str/topics/partner-symbols-ready'
    : 'projects/alpha-vantage-proxy-api/topics/partner-symbols-ready';

/**
 * Root collection for recording per-run status, metrics, and error samples
 * to aid observability and idempotency.
 */
export const EVENTS_COLLECTION = 'partner-events';

/** Pairs data root collection used by writer and readers (all intervals live under this). */
export const PAIRS_COLLECTION = 'pairs-data';

/** Registry of baseline–target pairs we own. */
export const REGISTRY_COLLECTION = 'pair-registry';

/** Root collection for precomputed heatmap snapshots consumed by dashboard v3. */
export const HEATMAP_SNAPSHOTS_COLLECTION = 'heatmap-snapshots';

/** Archive per-year collection prefix (under each pair doc): archive-YYYY */
export const ARCHIVE_COLLECTION_PREFIX = 'archive-';

/** Weekly archive per-year collection prefix: archive-weekly-YYYY */
export const WEEKLY_ARCHIVE_COLLECTION_PREFIX = 'archive-weekly-';

/** Monthly archive per-year collection prefix: archive-monthly-YYYY */
export const MONTHLY_ARCHIVE_COLLECTION_PREFIX = 'archive-monthly-';

/** Collection holding known/supported symbols and attributes. */
export const TRACKED_SYMBOLS_COLLECTION = 'tracked-symbols';

/** Root collection for current symbol price snapshots consumed by the frontend. */
export const SYMBOL_DATA_COLLECTION = 'symbol-data';

/** Subcollection name under symbol-data/{symbol} for year-sharded daily bars. */
export const SYMBOL_BARS_DAILY_SUBCOL = 'daily';

/** Subcollection name under symbol-data/{symbol} for the single flat weekly bars doc. */
export const SYMBOL_BARS_WEEKLY_SUBCOL = 'weekly';

/** Subcollection name under symbol-data/{symbol} for the single flat monthly bars doc. */
export const SYMBOL_BARS_MONTHLY_SUBCOL = 'monthly';

/** Doc ID for the single weekly/monthly bars doc within their subcollection. */
export const SYMBOL_BARS_FLAT_DOC_ID = 'all';

/** Root collection for rs-symbol-cache (time-series bars by marketDate+symbol). */
export const RS_SYMBOL_CACHE_COLLECTION = 'rs-symbol-cache';

/** Subcollection name under rs-symbol-cache/{marketDate} holding per-symbol docs. */
export const RS_SYMBOL_CACHE_SYMBOLS_SUBCOL = 'symbols';

/** Warning events emitted by backend for UI visibility. */
export const WARNINGS_COLLECTION = 'rs-warnings';

/** Root collection for app-level singletons and status docs. */
export const APP_COLLECTION = 'app';
/** Document id for the global refresh status consumed by FE header. */
export const REFRESH_STATUS_DOC = 'refresh-status';

/** Signals subcollection name under each pair doc. */
export const SIGNALS_COLLECTION = 'signals';
export const SIGNALS_OPENS_SUBCOLLECTION = 'opens';
export const SIGNALS_CLOSES_SUBCOLLECTION = 'closes';

/** Per-pair signals-activity collection under each pair doc. */
export const SIGNALS_ACTIVITY_COLLECTION = 'signals-activity';

/** Root signals-activity mirror collection (aggregated across pairs). */
export const SIGNALS_ACTIVITY_ROOT_COLLECTION = 'signals-activity';

/** If true, disable canonical RS engine outputs (signals/activity/positions) for all pipelines. */
export const DISABLE_SIGNALS_ACTIVITY_POSITIONS =
  String(process.env.DISABLE_SIGNALS_ACTIVITY_POSITIONS || '').toLowerCase() === 'true';

// RS signal thresholds for live/open-close detection
export const RS_OPEN_LONG_THRESHOLD = 0.8;
export const RS_CLOSE_LONG_THRESHOLD = 0.8;
export const RS_OPEN_SHORT_THRESHOLD = 0.2;
export const RS_CLOSE_SHORT_THRESHOLD = 0.2;

/** Minimal RS sample used by the RS engine (normalized + raw RS per day). */
export interface RsSample {
  day: string;      // YYYY-MM-DD
  rsNorm: number;   // normalized RS used for thresholds
  rsRaw: number;    // raw RS (e.g., post.rsRaw)
}

/** Logical RS event kinds emitted by the engine. */
export enum RsEventKind {
  HOLD = 'HOLD',
  OPEN = 'OPEN',
  CLOSE = 'CLOSE',
}

/** Logical RS event over time as positions move between FLAT/LONG/SHORT. */
export interface RsEvent {
  kind: RsEventKind;
  day: string;
  direction?: RsDirection;
}

/** Thresholds for the RS engine (matching RS_* constants above). */
export interface RsThresholds {
  openLong: number;
  closeLong: number;
  openShort: number;
  closeShort: number;
}

/** Label for year bucket kind metadata. */
export const YEAR_BUCKET_KIND = 'year';

/** Kind labels for metadata documents (console visibility). */
export const COLLECTION_KIND_POSITIONS = 'positions';

/** Max number of warning docs to persist per run/process (default 50). */
export const WARNINGS_CAP_PER_RUN = Number(process.env.WARNINGS_CAP_PER_RUN || 50);

/** If true, do not persist 'missing_close_time_on_post' warnings (useful in emulator). */
export const SILENCE_MISSING_POST_TIME = String(process.env.SILENCE_MISSING_POST_TIME || '').toLowerCase() === 'true';

/** If true, suppress verbose rs-series skip/info logs (e.g., missing fields, non-finite checks). */
export const SILENCE_RS_SERIES_INFO = String(process.env.SILENCE_RS_SERIES_INFO || '').toLowerCase() === 'true';

/** If true, suppress verbose registry listing logs (e.g., pair-registry enumeration). */
export const SILENCE_REGISTRY_INFO = String(process.env.SILENCE_REGISTRY_INFO || '').toLowerCase() === 'true';

/** If true, suppress admin info logs (e.g., recomputePairsRs starting messages). */
export const SILENCE_ADMIN_INFO = String(process.env.SILENCE_ADMIN_INFO || '').toLowerCase() === 'true';

/** If true, enable verbose console logging for selected partner/proxy diagnostics. */
export const ENABLE_CONSOLE_LOGGING = String(process.env.ENABLE_CONSOLE_LOGGING || '').toLowerCase() === 'true';

/** Retention days for registry entries after last member removes it. */
export const REGISTRY_RETENTION_DAYS = 30;

/** Users root collection. */
export const USERS_COLLECTION = 'users';

/** Per-user trades (overlays) subcollection name. */
export const USER_TRADES_COLLECTION = 'trades';

/** Per-user PnL daily aggregates subcollection name. */
export const USER_PNL_DAILY_COLLECTION = 'pnlDaily';

/** Root collection for app-level analytics (global aggregates). */
export const ANALYTICS_COLLECTION = 'analytics';

/** Document id of the aggregate summary under the analytics collection. */
export const ANALYTICS_SUMMARY_DOC = 'summary';

/** Root collection for system-wide positions (per-position trade records, not per-user overlays). */
export const POSITIONS_COLLECTION = 'positions';

/** Bucket document id for open shards (replaces historical 'hot' for positions/signals). */
export const OPEN_BUCKET_ID = 'open';

/** Standard name for subcollections that hold item documents under bucket docs. */
export const ITEMS_SUBCOLLECTION = 'items';

/** Standard name for subcollections that hold day documents under bucket docs. */
export const DAYS_SUBCOLLECTION = 'days';

/** Suffix for year shards that hold closed items. */
export const CLOSED_YEAR_SUFFIX = '-closed';

/** Compute the closed-year bucket id (e.g., '2025-closed') for a given day. */
export function yearClosedOf(day: string): string {
  const y = String(day || '').slice(0, 4);
  return `${y}${CLOSED_YEAR_SUFFIX}`;
}

/** Enumerates upstream run types of interest emitted by the partner. */
export enum RunType {
  TS_DAILY_PRE = 'ts-daily-pre',
  TS_DAILY_POST = 'ts-daily-post',
  TS_WEEKLY_POST = 'ts-weekly-post',
  TS_MONTHLY_POST = 'ts-monthly-post',
  HEARTBEAT = 'heartbeat',
  RB_TEST = 'rb-test',
}

/** Standard time-series intervals for parity with partner naming. */
export enum TimeSeriesInterval {
  INTRADAY = 'intraday',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

/** Helper set to validate recognized run types quickly. */
export const ALLOWED_RUN_TYPES = new Set<string>(Object.values(RunType));

/**
 * Processing constraints (configurable via env for backfills/expansion)
 * - FIXED_INTERVAL: Only DAILY data is fetched.
 * - FIXED_LIMIT: Max bars to request (default 30; override RS_LIMIT)
 * - FIXED_DAYS: Calendar span to request (default 30; override RS_DAYS)
 *
 * Examples:
 *   RS_DAYS=365 RS_LIMIT=365 → fetch roughly a full year of DAILY bars.
 */
export const FIXED_INTERVAL: PartnerInterval = 'DAILY';
export const FIXED_LIMIT = Number(process.env.RS_LIMIT || process.env.PARTNER_LIMIT || 30);
export const FIXED_DAYS = Number(process.env.RS_DAYS || 30);

/**
 * When true, treat partner-data-ready as a lightweight finalizer and rely on
 * the symbol-driven pipeline (partner-symbols-ready + rs-symbol-cache) for
 * fetching bars and computing RS. When false, run the legacy pair-centric
 * fetch + RS loop inside processDataReadyRunV2.
 */
export const USE_SYMBOL_DRIVEN_PIPELINE =
  String(process.env.USE_SYMBOL_DRIVEN_PIPELINE || '').toLowerCase() === 'true';

/**
 * Normalized baseline–target key used through the pipeline.
 * Example: { baseline: 'SPY', target: 'AAPL' } maps to pairs/SPY-AAPL
 */
export type PairKey = { baseline: string; target: string };

/**
 * Sampled processing error captured while iterating over pairs, for observability.
 */
export interface ProcessErrorSample {
  pair: string;
  message: string;
  status?: number;
  code?: string;
}

/**
 * Partner time-series bar shape used across the pipeline. Values may be optional depending on phase.
 */
export type PartnerBar = {
  d?: string;   // YYYY-MM-DD
  t?: number;   // epoch ms
  ac?: number;  // adjusted close (EOD)
  c?: number;   // close
  pc?: number;  // prior close
  cp?: number;  // percent change EOD
  ip?: number;  // intraday price
  ipc?: number; // intraday percent change
  it?: string;  // intraday time e.g. "15:30" or "15:30:00"
};

/** Minimal bar used by RS math when only time and close are needed. */
export interface SeriesBar { t: number; c: number }

/** RS point aligned by day across baseline and target. */
export interface RsPoint { t: number; rs: number; baseClose: number; targetClose: number }

/**
 * Phase series point with rank and per-symbol stats used by writer.
 * One per aligned trading day across baseline and target.
 */
export interface PhaseSeriesPoint {
  day: string;
  dow: string;   // day-of-week label (UTC)
  t: number;
  rank: number;
  baseCp: number;
  targetCp: number;
  baseClose: number;
  targetClose: number;
  it?: string;
}

export const BACKFILL_START_DATE = '2019-01-01';