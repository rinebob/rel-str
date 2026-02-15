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

/** Aggregate realtime run status, mirroring backfill but keyed by runId. */
export enum RsRealtimeRunStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETE = 'COMPLETE',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED',
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

/**
 * Aggregate run document for realtime RS runs keyed by runId.
 *
 * These runs are triggered by partner-data-ready messages and track
 * per-run progress across all pair/interval jobs.
 */
export interface RsRealtimeRunDoc {
  runId: string;

  /** ET market date for this run (YYYY-MM-DD). */
  marketDate: string | null;

  /** Interval for this realtime run (DAILY | WEEKLY | MONTHLY). */
  interval: Interval;

  phase: RsPhase;

  /** Number of unique pairs included in this run. */
  pairCount: number;

  /** Total jobs expected for this run (one per pair for this interval). */
  expectedJobs: number;
  successJobs: number;
  permanentFailureJobs: number;

  /** High-level status mirroring partner-events runStatus. */
  runStatus: RsRealtimeRunStatus;

  /** Optional partner metadata for correlation. */
  trigger?: string;
  runType?: string;

  /** Optional list of pairIds that reached PERMANENT_FAILURE for at least one job. */
  permanentFailurePairs?: string[];

  /** Timestamps for run document lifecycle and execution, all stored as Firestore Timestamps. */
  runDocCreatedAt: Timestamp;
  runDocUpdatedAt: Timestamp;
  runStartedAt?: Timestamp;
  runCompletedAt?: Timestamp;

  /** Human-readable duration of the run from first terminal job to completion, formatted as mm:ss. */
  totalDuration?: string;
}

// Root collection paths for RS job documents.
// These are COLLECTION paths (even segments when a run/job id is appended).
//
// Backfill runs:      system (coll) / rs-backfill-runs (doc) / runs (coll) / {runId} (doc)
// Realtime runs by runId: system (coll) / rs-realtime-runs (doc) / runs (coll) / {runId} (doc)
// Realtime jobs by runId: system (coll) / rs-realtime-runs (doc) / runs (coll) / {runId} (doc) / jobs (coll) / {jobId} (doc)
export const RS_BACKFILL_RUNS_ROOT = 'system/rs-backfill-runs/runs';
export const RS_REALTIME_RUNS_ROOT = 'system/rs-realtime-runs/runs';
export const RS_REALTIME_RUN_JOBS_SUBCOL = 'jobs';

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
  const jobId = `${pairId}-${interval}-${String(phase).toUpperCase()}`;
  return `${RS_BACKFILL_RUNS_ROOT}/${runId}/jobs/${jobId}`;
}

/** Build the Firestore document path for a realtime run aggregate doc keyed by runId. */
export function rsRealtimeRunDocPath(runId: string): string {
  return `${RS_REALTIME_RUNS_ROOT}/${runId}`;
}

/** Build the Firestore document path for a runId-keyed realtime job doc. */
export function rsRealtimeRunJobDocPath(
  runId: string,
  pairId: string,
  interval: Interval,
  phase: RsPhase,
): string {
  const jobId = `${pairId}-${interval}-${String(phase).toUpperCase()}`;
  return `${RS_REALTIME_RUNS_ROOT}/${runId}/${RS_REALTIME_RUN_JOBS_SUBCOL}/${jobId}`;
}
