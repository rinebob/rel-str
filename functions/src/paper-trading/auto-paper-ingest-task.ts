/**
 * @topic #553 — Paper Trading Infra (task #917 / Thread #904)
 *
 * Cloud Task entry point for the auto-paper ingest. Enqueued once per
 * completed ST run by RunProgressTracker.checkRunCompletion — on its own
 * queue so the RH MCP session + per-symbol quote calls get a real
 * memory/timeout budget instead of the 256MiB/60s symbol-worker one.
 * All gating and selection live in `runAutoPaperIngestPass`. Retry safety:
 * gates are idempotent today, and #918's fill path dedupes on the
 * deterministic tradeId.
 */

import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';

import type { AutoPaperIngestPayload } from '../common/st-shared-types';
import {
  defaultAutoPaperIngestDeps,
  runAutoPaperIngestPass,
} from './passes/auto-paper-ingest-pass';

export const stAutoPaperIngest = onTaskDispatched<AutoPaperIngestPayload>(
  {
    retryConfig: {
      maxAttempts: 3,
      minBackoffSeconds: 30,
      maxBackoffSeconds: 300,
    },
    rateLimits: {
      // One dispatch per run-completion; serialize anyway so a retried
      // enqueue can't run two ingests over the same run concurrently.
      maxConcurrentDispatches: 1,
      maxDispatchesPerSecond: 1,
    },
    // Quote-work sizing: RH MCP session + ~100–200 quote calls.
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async (req) => {
    const { runId, marketDate, triggeredBy } = req.data;
    logger.info('st_autopaper_task_received', { runId, marketDate, triggeredBy });
    const result = await runAutoPaperIngestPass(req.data, defaultAutoPaperIngestDeps());
    logger.info('st_autopaper_task_done', { runId, status: result.status, reason: result.reason });
  },
);
