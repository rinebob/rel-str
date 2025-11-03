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

/**
 * Pub/Sub topic for partner data-ready notifications. This is the upstream
 * producer topic; our function subscribes and reacts as a consumer.
 */
export const PARTNER_DATA_READY_TOPIC =
  process.env.FUNCTIONS_EMULATOR === 'true'
    ? 'projects/rel-str/topics/partner-data-ready'
    : 'projects/alpha-vantage-proxy-api/topics/partner-data-ready';

/**
 * Root collection for recording per-run status, metrics, and error samples
 * to aid observability and idempotency.
 */
export const EVENTS_COLLECTION = 'partner-events';

/** Pairs data root collection used by writer and readers. */
export const PAIRS_COLLECTION = 'pairs-data';

/** Registry of baseline–target pairs we own. */
export const REGISTRY_COLLECTION = 'pair-registry';

/** Archive per-year collection prefix (under each pair doc): archive-YYYY */
export const ARCHIVE_COLLECTION_PREFIX = 'archive-';

/** Collection holding known/supported symbols and attributes. */
export const TRACKED_SYMBOLS_COLLECTION = 'tracked-symbols';

/** Retention days for registry entries after last member removes it. */
export const REGISTRY_RETENTION_DAYS = 30;

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
 * Phase of processing for RS pipeline.
 * - 'pre': intraday (pre-close) using ipc/ip when available
 * - 'post': end-of-day using cp/ac
 */
export type Phase = 'pre' | 'post';

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
  it?: string;  // intraday time e.g. "15:30"
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
