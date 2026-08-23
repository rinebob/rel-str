/**
 * SDS task worker — Cloud Task handler for per-symbol, per-interval sync.
 *
 * Thin entry point: delegates to processSymbolInterval with real GCP deps.
 * Completion tracking (processedSymbols arrayUnion) is handled here in a finally
 * block with a single transactional write.
 */

import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase-admin-init';
import { callPartnerTimeSeries } from '../partner-proxy';
import { normalizeBar } from './symbol-data-bar-helpers';
import type { OhlcBar } from '../common/market-data-types';
import { processSymbolInterval, type SdsWorkerPayload, type SdsWorkerDeps, type SdsWorkerResult } from './sds-worker-core';
import { checkSyncRunCompletion, type RunContext } from './sds-completion';
import { createCompletionDeps } from './sds-completion-deps';

const SDS_RUNS_COLLECTION = 'symbol-data-sync-runs';

/** Extract sequence letter (A/B/C) from a sequenceRunId like '2026-08-22-POST-A'. */
function extractSequence(sequenceRunId: string): string | undefined {
  const match = sequenceRunId.match(/-POST-([ABC])$/);
  return match ? match[1] : undefined;
}

/** Raw SA time-series response shape. */
interface SaTimeSeriesResponse {
  bars?: Array<{ d?: string; t?: number; o?: number; h?: number; l?: number; c?: number; ac?: number; v?: number; barStatus?: string }>;
}

export const symbolDataSyncWorker = onTaskDispatched<SdsWorkerPayload>(
  {
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 5, maxBackoffSeconds: 60 },
    rateLimits: { maxConcurrentDispatches: 50, maxDispatchesPerSecond: 20 },
    memory: '512MiB',
    timeoutSeconds: 120,
    region: 'us-central1',
  },
  async (req) => {
    const payload = req.data;
    const deps: SdsWorkerDeps = {
      db,
      async fetchBars(symbol: string, interval: string) {
        const raw = await callPartnerTimeSeries({
          symbol,
          interval: interval as 'DAILY' | 'WEEKLY' | 'MONTHLY',
          adjusted: true,
          limit: interval === 'DAILY' ? 14 : interval === 'WEEKLY' ? 10 : 6,
        }).catch(() => null);
        return ((raw as SaTimeSeriesResponse | null)?.bars ?? [])
          .map(normalizeBar)
          .filter((b): b is OhlcBar => b !== null);
      },
    };

    let result: SdsWorkerResult | undefined;
    try {
      result = await processSymbolInterval(payload, deps);
      logger.info('sds_worker_complete', { ...result, runId: payload.runId });
    } finally {
      // Always mark the symbol as processed — even on error — so the run can
      // reach completion. arrayUnion is idempotent, so retries don't inflate.
      const runRef = db.collection(SDS_RUNS_COLLECTION).doc(payload.runId);
      await db.runTransaction(async (t) => {
        const updates: Record<string, unknown> = {
          processedSymbols: FieldValue.arrayUnion(payload.symbol),
          lastActivityAt: FieldValue.serverTimestamp(),
        };
        t.set(runRef, updates, { merge: true });
      });

      // Check if this interval run is complete → fire sequence fan-in
      const completionDeps = createCompletionDeps();
      const runCtx: RunContext = {
        runId: payload.runId,
        sequenceRunId: payload.sequenceRunId,
        interval: payload.interval,
        sequence: payload.sequenceRunId ? extractSequence(payload.sequenceRunId) : undefined,
        marketDate: payload.marketDate,
        phase: 'post',
      };
      await checkSyncRunCompletion(runCtx, completionDeps);
    }
  },
);
