**Topic:** Spread Time Series Viewer  
**Issue:** #77  
**Domain:** SPREAD-VIEWER  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-08-05  
**Last Updated:** 2026-08-05  

# Implementation Plan: Spread Time Series Viewer — BACKEND

## Overview

Backend infrastructure for spread time series loading. Extends `fetchWithRetry` for POST, creates a spread proxy for the SA single endpoint, and implements a Cloud Tasks queue architecture (orchestrator + worker) mirroring the existing `backtest-runs` and `rs-backfill-runs` patterns.

## Components

### 1. `functions/src/partner-infrastructure.ts` (modified)

Extend `fetchWithRetry` to support POST with body:

```typescript
export async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  options?: { maxAttempts?: number; method?: string; body?: string },
): Promise<Response> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const method = options?.method ?? 'GET';
  const body = options?.body;
  // ... same retry logic, but pass { headers, method, body } to fetch()
}
```

Backward compatible — existing callers pass `(url, headers)` or `(url, headers, maxAttempts)`. The new optional `options` object doesn't break them.

**Note:** Caller sets `Content-Type: application/json` in the headers object. `fetchWithRetry` remains a dumb retry wrapper.

### 2. `functions/src/spread-proxy.ts` (new)

POST handler delegating to SA's `partnerSpreadTimeSeries` endpoint.

**Pattern:** Follows `options-contract-proxy.ts` exactly.

```typescript
import { PARTNER_AUDIENCE, CALLER_SA, PartnerHttpError, generateIdTokenWithEmail, fetchWithRetry } from './partner-infrastructure';
import { PartnerEndpointPath } from './types/partner';
import type { SpreadDefinition, SpreadTimeSeriesResponse } from '@spread/contracts';

const PARTNER_SPREAD_TIME_SERIES_URL =
  process.env.PARTNER_SPREAD_TIME_SERIES_URL ||
  `${PARTNER_AUDIENCE.replace(/\/$/, '')}/${PartnerEndpointPath.SPREAD_TIME_SERIES}`;

const PARTNER_SPREAD_TIME_SERIES_AUDIENCE =
  process.env.PARTNER_SPREAD_TIME_SERIES_AUDIENCE || PARTNER_SPREAD_TIME_SERIES_URL;

export async function callPartnerSpreadTimeSeries(
  definition: SpreadDefinition,
): Promise<SpreadTimeSeriesResponse> {
  const idToken = await generateIdTokenWithEmail(PARTNER_SPREAD_TIME_SERIES_AUDIENCE, CALLER_SA);
  const headers = {
    Authorization: `Bearer ${idToken}`,
    'Content-Type': 'application/json',
  };
  const body = JSON.stringify(definition);
  const resp = await fetchWithRetry(PARTNER_SPREAD_TIME_SERIES_URL, headers, { method: 'POST', body });

  if (!resp.ok) {
    throw new PartnerHttpError(resp.status, await resp.text());
  }
  return resp.json() as Promise<SpreadTimeSeriesResponse>;
}
```

### 3. `functions/src/spread-run-model.ts` (new)

Enums, interfaces, and path helpers for spread run/job docs. Mirrors `rs-time-series-jobs.model.ts`.

```typescript
import type { Timestamp } from 'firebase-admin/firestore';
import type { SpreadDefinition, SpreadTimeSeriesResponse } from '@spread/contracts';

export enum SpreadRunStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETE = 'COMPLETE',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED',
}

export enum SpreadJobStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCESS = 'SUCCESS',
  TRANSIENT_FAILURE = 'TRANSIENT_FAILURE',
  PERMANENT_FAILURE = 'PERMANENT_FAILURE',
}

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
```

### 4. `functions/src/spread-run-orchestrator.ts` (new)

`submitSpreadRun` callable. Mirrors `backtest-orchestrator.ts`.

```typescript
import { onCall } from 'firebase-functions/v2/https';
import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions/v2';
import { db, FieldValue } from './firebase-admin-init';
import { RH_AGENT_ALLOWED_ORIGINS } from './rh-agent-cloud-function/rh-agent-cors';
import { SPREAD_RUNS_COLLECTION, SpreadRunStatus } from './spread-run-model';
import { spreadRunWorker } from './spread-run-worker';
import type { SubmitSpreadRunRequest, SubmitSpreadRunResponse } from '@spread/contracts';

export const submitSpreadRun = onCall<SubmitSpreadRunRequest, Promise<SubmitSpreadRunResponse>>(
  { region: 'us-central1', cors: RH_AGENT_ALLOWED_ORIGINS },
  async (request) => {
    const userId = request.auth?.uid;
    if (!userId) throw new Error('Authentication required');

    const spreads = request.data.spreads;
    if (!spreads || spreads.length === 0) throw new Error('At least one spread is required');

    const runId = `spread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const runRef = db.collection(SPREAD_RUNS_COLLECTION).doc(runId);

    await runRef.set({
      userId,
      status: SpreadRunStatus.IN_PROGRESS,
      expectedJobs: spreads.length,
      successJobs: 0,
      failedJobs: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const queue = getFunctions().taskQueue(spreadRunWorker.taskQueueName);

    for (let i = 0; i < spreads.length; i++) {
      await queue.enqueue({
        runId,
        spreadIndex: i,
        definition: spreads[i],
      });
    }

    logger.info('spread_run_orchestrator_complete', { runId, total: spreads.length });
    return { runId };
  },
);
```

### 5. `functions/src/spread-run-worker.ts` (new)

`spreadRunWorker` task. Mirrors `backtest-worker.ts`.

```typescript
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';
import { db, FieldValue } from './firebase-admin-init';
import { callPartnerSpreadTimeSeries } from './spread-proxy';
import {
  spreadRunDocPath,
  spreadRunJobDocPath,
  SpreadRunStatus,
  SpreadJobStatus,
} from './spread-run-model';
import type { SpreadDefinition } from '@spread/contracts';

const MAX_ATTEMPTS = 3;

interface SpreadRunTaskPayload {
  runId: string;
  spreadIndex: number;
  definition: SpreadDefinition;
}

export const spreadRunWorker = onTaskDispatched<SpreadRunTaskPayload>(
  {
    retryConfig: {
      maxAttempts: MAX_ATTEMPTS,
      minBackoffSeconds: 10,
      maxBackoffSeconds: 60,
    },
    rateLimits: {
      maxConcurrentDispatches: 20,
      maxDispatchesPerSecond: 10,
    },
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (req) => {
    const { runId, spreadIndex, definition } = req.data;
    const retryCount = (req as { retryCount?: number }).retryCount ?? 0;
    const isFinalAttempt = retryCount >= MAX_ATTEMPTS - 1;

    const runRef = db.doc(spreadRunDocPath(runId));
    const jobRef = db.doc(spreadRunJobDocPath(runId, spreadIndex));

    // Mark job as IN_PROGRESS
    await jobRef.set({
      spreadIndex,
      status: SpreadJobStatus.IN_PROGRESS,
      definition,
      attempts: retryCount + 1,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    try {
      const result = await callPartnerSpreadTimeSeries(definition);

      await jobRef.set({
        spreadIndex,
        status: SpreadJobStatus.SUCCESS,
        definition,
        result,
        attempts: retryCount + 1,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      // Increment success counter
      await runRef.set({
        successJobs: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (isFinalAttempt) {
        await jobRef.set({
          spreadIndex,
          status: SpreadJobStatus.PERMANENT_FAILURE,
          definition,
          error: errorMsg,
          attempts: retryCount + 1,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        await runRef.set({
          failedJobs: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } else {
        await jobRef.set({
          spreadIndex,
          status: SpreadJobStatus.TRANSIENT_FAILURE,
          definition,
          error: errorMsg,
          attempts: retryCount + 1,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        // Cloud Tasks will retry automatically
        throw error; // re-throw to trigger retry
      }
    }

    // Check if run is complete
    const runDoc = await runRef.get();
    const runData = runDoc.data();
    if (runData && runData.successJobs + runData.failedJobs >= runData.expectedJobs) {
      const status = runData.failedJobs > 0 ? SpreadRunStatus.PARTIAL : SpreadRunStatus.COMPLETE;
      await runRef.set({
        status,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  },
);

// Export task queue name for orchestrator
spreadRunWorker.taskQueueName = 'spreadRunWorker';
```

**Note:** The `taskQueueName` export pattern needs to match how `backtest-worker.ts` does it (`export const BACKTEST_TASK_QUEUE = 'rhAgentBacktestPermutation'`). The worker function's name as registered with `onTaskDispatched` is the queue identifier.

### 6. `functions/src/index.ts` (modified)

Export the orchestrator and worker:

```typescript
export { submitSpreadRun } from './spread-run-orchestrator';
export { spreadRunWorker } from './spread-run-worker';
```

### 7. `firestore.rules` (modified)

Add rules for `spread-runs` and `spread-lists`:

```
// Spread runs — authenticated read, backend-only write
match /spread-runs/{runId} {
  allow read: if request.auth != null;
  allow write: if false;

  match /jobs/{jobId} {
    allow read: if request.auth != null;
    allow write: if false;
  }
}

// Spread lists — user-scoped read/write
match /spread-lists/{listId} {
  allow read: if request.auth != null && (resource == null || request.auth.uid == resource.data.userId);
  allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
  allow update: if request.auth != null && request.auth.uid == resource.data.userId;
  allow delete: if request.auth != null && request.auth.uid == resource.data.userId;
}
```

## Dependencies

- `@options/common` and `@spread/contracts` path aliases (from SHARED area)
- `partner-infrastructure.ts` (existing, modified)
- `firebase-admin-init.ts` (existing — `db`, `FieldValue`)
- `rh-agent-cors.ts` (existing — `RH_AGENT_ALLOWED_ORIGINS`)
- Cloud Tasks API enabled in the Firebase project

## Cross-Area Boundaries

- Imports shared types from `@spread/contracts` and `@options/common`
- Firestore docs written by worker are read by FE `SpreadRunService` via `onSnapshot`
- `submitSpreadRun` callable is called by FE `SpreadService` via `httpsCallable`

## Risks

- **Cloud Tasks configuration:** Rate limits and concurrency need tuning. 20 concurrent / 10 per second is conservative — may need adjustment based on SA response times.
- **Firestore counter increments:** `FieldValue.increment(1)` is not atomic across concurrent workers in all cases. If counters are inaccurate, switch to a transaction or aggregate via a Cloud Function trigger on job writes.
- **Worker timeout:** 60s may be tight if SA is slow. Monitor and adjust.

## Implementation Order

1. Extend `fetchWithRetry` with POST support
2. Create `spread-proxy.ts` with `callPartnerSpreadTimeSeries`
3. Create `spread-run-model.ts` with enums, interfaces, path helpers
4. Create `spread-run-worker.ts` with `onTaskDispatched` handler
5. Create `spread-run-orchestrator.ts` with `onCall` handler
6. Export both in `functions/src/index.ts`
7. Add Firestore security rules for `spread-runs` and `spread-lists`
8. Deploy and test with a single spread first
