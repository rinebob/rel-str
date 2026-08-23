/**
 * SDS task worker — Cloud Task handler for per-symbol, per-interval sync.
 *
 * Thin entry point: delegates to processSymbolInterval with real GCP deps.
 * Completion tracking (processedCount increment) is handled here in a finally
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

const SDS_RUNS_COLLECTION = 'symbol-data-sync-runs';

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
      // Always increment processedCount — even on error — so the run can complete.
      // Single transactional write for all counter updates.
      const runRef = db.collection(SDS_RUNS_COLLECTION).doc(payload.runId);
      await db.runTransaction(async (t) => {
        const updates: Record<string, unknown> = {
          processedCount: FieldValue.increment(1),
        };
        if (result?.status === 'ok') {
          updates.successCount = FieldValue.increment(1);
        } else if (result?.status === 'error') {
          updates.failedCount = FieldValue.increment(1);
          updates.failedSymbols = FieldValue.arrayUnion(payload.symbol);
        }
        t.set(runRef, updates, { merge: true });
      });
    }
  },
);
