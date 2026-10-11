/**
 * @topic #553 — Paper Trading Infra (task #917 / Thread #904)
 *
 * Cloud Task entry point for the auto-paper ingest. Enqueued once per
 * completed ST run by RunProgressTracker.checkRunCompletion — on its own
 * queue so the RH MCP session + per-symbol quote calls get a real
 * memory/timeout budget instead of the 256MiB/60s symbol-worker one.
 * All gating, selection, quote, and fill logic live in
 * `auto-paper-ingest-pass.ts`. Retry safety: gates are idempotent and the
 * fill path dedupes on the barDate-keyed deterministic tradeId.
 */

import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';

import type { AutoPaperIngestPayload } from '../common/st-shared-types';
import {
  defaultAutoPaperIngestDeps,
  defaultAutoPaperIngestFillDeps,
  runAutoPaperIngestFill,
  runAutoPaperIngestPass,
} from './passes/auto-paper-ingest-pass';
import { createRobinhoodMcpSessionManagerFromEnv } from '../options-strategy-engine/mcp/robinhood-mcp-session-manager';
import type { RobinhoodMcpSessionManager } from '../options-strategy-engine/mcp/robinhood-mcp-session-manager';

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
    // Quote+fill sizing: RH MCP session, one batched quote call, then a
    // ledger txn + lifecycle capture per signal.
    memory: '512MiB',
    timeoutSeconds: 540,
    secrets: ['RH_CREDENTIAL_BUNDLE'],
  },
  async (req) => {
    const { runId, marketDate, triggeredBy } = req.data;
    logger.info('st_autopaper_task_received', { runId, marketDate, triggeredBy });

    // Gates first — a skipped run never pays for an MCP session.
    const gate = await runAutoPaperIngestPass(req.data, defaultAutoPaperIngestDeps());
    if (gate.status !== 'ready') {
      logger.info('st_autopaper_task_done', { runId, status: gate.status, reason: gate.reason });
      return;
    }

    let manager: RobinhoodMcpSessionManager | undefined;
    try {
      manager = await createRobinhoodMcpSessionManagerFromEnv();
      const summary = await runAutoPaperIngestFill(
        req.data,
        gate.scope,
        defaultAutoPaperIngestFillDeps(manager.callTool.bind(manager)),
      );
      logger.info('st_autopaper_task_done', {
        runId,
        status: 'ready',
        ...summary,
        errors: summary.errors.length,
      });
    } finally {
      try {
        await manager?.close();
      } catch (err) {
        // A failing close must not mask the real ingest error above.
        logger.warn('st_autopaper_session_close_failed', {
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  },
);
