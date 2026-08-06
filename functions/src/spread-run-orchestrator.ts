/**
 * Spread run orchestrator callable.
 * Accepts a submitSpreadRun request from the UI, creates a spread-runs document,
 * fans out one Cloud Task per spread definition, and returns the run ID for polling.
 * Mirrors backtest-orchestrator.ts pattern.
 */

import { onCall } from 'firebase-functions/v2/https';
import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions/v2';

import { db, FieldValue } from './firebase-admin-init';
import { RH_AGENT_ALLOWED_ORIGINS } from './rh-agent-cloud-function/rh-agent-cors';
import { SPREAD_RUNS_COLLECTION, SpreadRunStatus } from './spread-run-model';
import { SPREAD_RUN_WORKER_QUEUE } from './spread-run-worker';
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

    const queue = getFunctions().taskQueue(SPREAD_RUN_WORKER_QUEUE);

    for (let i = 0; i < spreads.length; i++) {
      await queue.enqueue(
        {
          runId,
          spreadIndex: i,
          definition: spreads[i],
        },
        {
          scheduleDelaySeconds: Math.floor(i * 0.5),
        },
      );
    }

    logger.info('spread_orchestrator_complete', { runId, total: spreads.length });
    return { runId };
  },
);
