/**
 * Enums, interfaces, and path helpers for spread run/job docs.
 * Mirrors the backtest-collections.ts pattern.
 */

import type { Timestamp } from 'firebase-admin/firestore';
import type { SpreadDefinition, SpreadTimeSeriesResponse, SpreadRunStatus, SpreadJobStatus } from '@spread/contracts';

export { SpreadRunStatus, SpreadJobStatus } from '@spread/contracts';

export interface SpreadRunDoc {
  userId: string;
  status: SpreadRunStatus;
  expectedJobs: number;
  successJobs: number;
  failedJobs: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
}

export interface SpreadJobDoc {
  spreadIndex: number;
  status: SpreadJobStatus;
  definition: SpreadDefinition;
  result?: SpreadTimeSeriesResponse;
  error?: string;
  attempts: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const SPREAD_RUNS_COLLECTION = 'spread-runs';
export const SPREAD_RUN_JOBS_SUBCOL = 'jobs';

export function spreadRunDocPath(runId: string): string {
  return `${SPREAD_RUNS_COLLECTION}/${runId}`;
}

export function spreadRunJobDocPath(runId: string, spreadIndex: number): string {
  return `${SPREAD_RUNS_COLLECTION}/${runId}/${SPREAD_RUN_JOBS_SUBCOL}/${spreadIndex}`;
}
