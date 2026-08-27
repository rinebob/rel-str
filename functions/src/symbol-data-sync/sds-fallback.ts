/**
 * SDS fallback timer — scheduled at 3 PM PT on weekdays.
 *
 * If no POST A sequence has been triggered by 3 PM, creates a synthetic
 * POST A run with all 3 intervals (DAILY, WEEKLY, MONTHLY) + parent sequence
 * doc, exactly as if a PDR message had arrived.
 *
 * Race condition prevention: queries for any existing POST A sequence for
 * today's marketDate with a non-terminal status. If found, skips.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFunctions } from 'firebase-admin/functions';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { db } from '../firebase-admin-init';
import { callPartnerTrackedSymbols } from '../partner-proxy';
import { getMarketDatePT } from '../common/pt-date-utils';
import {
  createPostRun,
  SDS_RUNS_COLLECTION,
  SDS_SEQUENCES_COLLECTION,
  type SdsDeps,
  type SdsTaskPayload,
} from './sds-core';
import { type PdrContext } from './sds-pdr-parser';
import { createCompletionDeps } from './sds-completion-deps';
import { shouldFallbackRun, type SequenceSummary } from './sds-fallback-logic';

/** The partner API may return either strings or objects with a .symbol property. */
type RawTrackedSymbol = string | { symbol: string };

/** Normalize the partner API's tracked-symbols response to string[]. */
export function normalizeTrackedSymbols(raw: RawTrackedSymbol[] | undefined): string[] {
  return (raw ?? [])
    .map((s) => (typeof s === 'string' ? s : s?.symbol))
    .filter(Boolean);
}

export const sdsFallback = onSchedule(
  {
    schedule: '0 15 * * 1-5', // 3 PM PT, Mon–Fri
    timeZone: 'America/Los_Angeles',
    memory: '512MiB',
    timeoutSeconds: 300,
    region: 'us-central1',
  },
  async () => {
    const marketDate = getMarketDatePT();
    logger.info('sds_fallback_start', { marketDate });
    try {

      // Check for existing POST A sequence
      const seqSnap = await db.collection(SDS_SEQUENCES_COLLECTION)
        .where('marketDate', '==', marketDate)
        .where('sequence', '==', 'A')
        .get();

      const sequences: SequenceSummary[] = seqSnap.docs.map((d) => {
        const data = d.data();
        return {
          marketDate: data.marketDate ?? '',
          sequence: data.sequence ?? '',
          status: data.status ?? '',
        };
      });

      if (!shouldFallbackRun(sequences, marketDate)) {
        logger.info('sds_fallback_skip', { marketDate, reason: 'POST A sequence already exists' });
        return;
      }

      logger.info('sds_fallback_creating', { marketDate });

      // Get tracked symbols — fallback syncs all, no excludeSymbols filtering.
      // The partner API may return either plain strings or objects with a
      // .symbol property — normalize to string[].
      const resp = await callPartnerTrackedSymbols();
      const trackedSymbols: string[] = normalizeTrackedSymbols(resp.symbols);

      // Build deps — no intraday fetch needed for POST runs
      const queue = getFunctions().taskQueue('symbolDataSyncWorker');
      const completionDeps = createCompletionDeps();

      const deps: SdsDeps = {
        db,
        async enqueueTask(payload: SdsTaskPayload) {
          await queue.enqueue(payload);
        },
        async getTrackedSymbols() {
          return trackedSymbols;
        },
        async fetchIntradaySnapshot() {
          return [];
        },
        completionDeps,
      };

      const sequenceRunId = `${marketDate}-POST-A`;
      const intervals: Array<'DAILY' | 'WEEKLY' | 'MONTHLY'> = ['DAILY', 'WEEKLY', 'MONTHLY'];

      for (const interval of intervals) {
        const runId = `${marketDate}-FALLBACK-POST-A-${interval}`;
        const runRef = db.collection(SDS_RUNS_COLLECTION).doc(runId);

        // Idempotency: skip if run doc already exists with terminal status
        const existing = await runRef.get();
        if (existing.exists) {
          logger.info('sds_fallback_skip_interval', { interval, runId, reason: 'run doc already exists' });
          continue;
        }

        // Create run doc
        await runRef.set({
          runId,
          marketDate,
          runType: 'ts-post-all-intervals',
          phase: 'post',
          interval,
          sequence: 'A',
          sequenceRunId,
          symbols: trackedSymbols,
          processedSymbols: [],
          status: 'processing',
          completionEnqueued: false,
          startedAt: FieldValue.serverTimestamp(),
        });

        // Create sequence doc + enqueue per-symbol tasks
        const ctx: PdrContext = {
          runType: 'ts-post-all-intervals',
          phase: 'post',
          runId,
          marketDate,
          interval,
          sequence: 'A',
          excludeSymbols: undefined,
          includeSymbols: undefined,
          clockPt: undefined,
        };

        const result = await createPostRun(ctx, trackedSymbols, sequenceRunId, deps, runRef);
        logger.info('sds_fallback_interval_created', { interval, runId, ...result });
      }

      logger.info('sds_fallback_complete', { marketDate });
    } catch (err: any) {
      logger.error('sds_fallback_error', { error: err?.message });
    }
  },
);
