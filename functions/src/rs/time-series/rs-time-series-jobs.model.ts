import type { Timestamp } from 'firebase-admin/firestore';
import { Interval } from '../../types/signal.types';
import { RsPhase } from '../../types/partner';

/**
 * RS job type (realtime vs backfill), mirroring Savant's TimeSeriesJobType.
 */
export enum RsJobType {
  REALTIME = 'realtime',
  BACKFILL = 'backfill',
}

/**
 * RS job mode (compact vs full backfill), mirroring Savant's TimeSeriesJobMode.
 */
export enum RsJobMode {
  COMPACT = 'COMPACT',
  FULL_BACKFILL = 'FULL_BACKFILL',
}

/**
 * Full RS job status state machine, mirroring Savant's TimeSeriesJobStatus.
 */
export enum RsJobStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCESS = 'SUCCESS',
  TRANSIENT_FAILURE = 'TRANSIENT_FAILURE',
  PERMANENT_FAILURE = 'PERMANENT_FAILURE',
}

/**
 * Aggregate backfill run status.
 */
export enum RsBackfillRunStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETE = 'COMPLETE',
}

/**
 * Firestore document shape for a single RS pair job (pair + interval + phase).
 *
 * Used for both realtime and backfill job collections; distinguished by
 * `jobType` and `mode` as well as the document path.
 */
export interface RsPairJobDoc {
  /** Logical pair id, e.g. "SPY-AAPL". */
  pairId: string;
  baseline: string;
  target: string;

  interval: Interval;
  phase: RsPhase;

  /** Inclusive RS archive window for this job. */
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD

  jobType: RsJobType;
  mode: RsJobMode;

  status: RsJobStatus;
  attempts: number;
  lastError?: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastAttemptAt?: Timestamp;
}

/**
 * Aggregate run document for RS backfill runs.
 *
 * Realtime flows may maintain separate aggregates under rs-time-series-jobs
 * date docs; this type is focused on backfill runs under rs-backfill-runs.
 */
export interface RsBackfillRunDoc {
  runId: string;

  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD

  phase: RsPhase;
  intervals: Interval[];

  /** Number of unique pairs included in this run. */
  pairCount: number;

  /** Total jobs expected for this run (pair * interval * phase combinations). */
  expectedJobs: number;
  successJobs: number;
  permanentFailureJobs: number;

  status: RsBackfillRunStatus;

  createdAt: Timestamp;
  updatedAt: Timestamp;
  runCompletedAt?: Timestamp;
}

// Root collection paths for RS job documents.
// These are COLLECTION paths (even segments when a run/job id is appended).
//
// Run docs:    system (coll) / rs-backfill-runs (doc) / runs (coll) / {runId} (doc)
// Realtime jobs: system (coll) / rs-time-series-jobs (doc) / dates (coll) / {marketDate} (doc)
export const RS_BACKFILL_RUNS_ROOT = 'system/rs-backfill-runs/runs';
export const RS_TIME_SERIES_JOBS_ROOT = 'system/rs-time-series-jobs/dates';

/**
 * Build the Firestore document path for a backfill run aggregate doc.
 */
export function rsBackfillRunDocPath(runId: string): string {
  return `${RS_BACKFILL_RUNS_ROOT}/${runId}`;
}

/**
 * Build the Firestore document path for a specific backfill job doc.
 */
export function rsBackfillJobDocPath(
  runId: string,
  pairId: string,
  interval: Interval,
  phase: RsPhase,
): string {
  const jobId = `${pairId}-${interval}-${phase}`;
  return `${RS_BACKFILL_RUNS_ROOT}/${runId}/jobs/${jobId}`;
}

/**
 * Build the Firestore document path for a realtime date aggregate doc.
 */
export function rsRealtimeDateDocPath(marketDate: string): string {
  return `${RS_TIME_SERIES_JOBS_ROOT}/${marketDate}`;
}

/**
 * Build the Firestore document path for a specific realtime job doc.
 */
export function rsRealtimeJobDocPath(
  marketDate: string,
  pairId: string,
  interval: Interval,
  phase: RsPhase,
): string {
  const jobId = `${pairId}-${interval}-${phase}`;
  return `${RS_TIME_SERIES_JOBS_ROOT}/${marketDate}/jobs/${jobId}`;
}
