import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions/v2';

import type { UpdateData } from 'firebase-admin/firestore';
import { db, FieldValue } from '../../firebase-admin-init';

import { Interval } from '../../types/signal.types';
import { RsPhase } from '../../types/partner';
import { writeUnifiedSeries } from '../../webhooks/pairs-writer';
import { buildPhaseSeries } from '../../webhooks/rs-series';
import { fetchDailyBarsRange, type PartnerBar, type FetchRangeOptions, type RsSymbolCacheDoc } from '../../webhooks/symbol-fetch';
import { triggerHeatmapUpdatesForBaselines } from '../heatmap/heatmap-snapshots';

import {
  PAIRS_COLLECTION,
  WEEKLY_ARCHIVE_COLLECTION_PREFIX,
  MONTHLY_ARCHIVE_COLLECTION_PREFIX,
  EVENTS_COLLECTION,
  RS_SYMBOL_CACHE_COLLECTION,
  RS_SYMBOL_CACHE_SYMBOLS_SUBCOL,
} from '../../webhooks/webhooks-config';

import {
  RsBackfillRunStatus,
  type RsBackfillRunDoc,
  RsJobStatus,
  RsJobType,
  rsBackfillJobDocPath,
  rsBackfillRunDocPath,
  RsRealtimeRunStatus,
  type RsRealtimeRunDoc,
  rsRealtimeRunDocPath,
  rsRealtimeRunJobDocPath,
} from './rs-time-series-jobs.model';
import type { ProcessRsJobPayload } from './rs-time-series-jobs.helper';

type BarsCache = Map<string, PartnerBar[]>;

function buildBarsCacheKey(symbol: string, opts: FetchRangeOptions): string {
  const interval = opts.interval ?? Interval.DAILY;
  const fromIso = String(opts.from).slice(0, 10);
  const toIso = String(opts.to).slice(0, 10);
  return `${symbol}|${interval}|${fromIso}|${toIso}`;
}

async function getOrFetchBars(
  marketDate: string | undefined,
  symbol: string,
  opts: FetchRangeOptions,
  cache: BarsCache,
): Promise<PartnerBar[]> {
  const key = buildBarsCacheKey(symbol, opts);
  const cached = cache.get(key);
  if (cached) {
    logger.info('rsBarsCache_hit', {
      symbol,
      interval: opts.interval ?? Interval.DAILY,
      from: String(opts.from).slice(0, 10),
      to: String(opts.to).slice(0, 10),
    });
    return cached;
  }

  const interval: Interval = (opts.interval as Interval) ?? Interval.DAILY;
  const fromIso = String(opts.from).slice(0, 10);
  const toIso = String(opts.to).slice(0, 10);

  // Cross-job cache: reuse symbol bars for the same marketDate+interval when available.
  if (marketDate) {
    try {
      const cacheDocRef = db
        .collection(RS_SYMBOL_CACHE_COLLECTION)
        .doc(marketDate)
        .collection(RS_SYMBOL_CACHE_SYMBOLS_SUBCOL)
        .doc(symbol);

      const snap = await cacheDocRef.get();
      if (snap.exists) {
        const doc = snap.data() as Partial<RsSymbolCacheDoc> | undefined;
        let cachedBarsForInterval: PartnerBar[] | null | undefined;
        if (interval === Interval.DAILY) {
          cachedBarsForInterval = doc?.dailyBars ?? null;
        } else if (interval === Interval.WEEKLY) {
          cachedBarsForInterval = doc?.weeklyBars ?? null;
        } else if (interval === Interval.MONTHLY) {
          cachedBarsForInterval = doc?.monthlyBars ?? null;
        }

        if (Array.isArray(cachedBarsForInterval) && cachedBarsForInterval.length > 0) {
          logger.info('rsBarsCache_firestore_hit', {
            symbol,
            marketDate,
            interval,
            from: fromIso,
            to: toIso,
            cachedCount: cachedBarsForInterval.length,
          });
          cache.set(key, cachedBarsForInterval as PartnerBar[]);
          return cachedBarsForInterval as PartnerBar[];
        }
      }
    } catch (e: any) {
      logger.warn('rsBarsCache_firestore_lookup_failed', {
        symbol,
        marketDate,
        interval,
        from: fromIso,
        to: toIso,
        message: e?.message,
      });
    }
  }

  logger.info('rsBarsCache_miss', {
    symbol,
    marketDate: marketDate || null,
    interval,
    from: fromIso,
    to: toIso,
  });

  const bars = await fetchDailyBarsRange(symbol, opts);
  cache.set(key, bars);

  // Persist into rs-symbol-cache for reuse across jobs sharing this marketDate+interval.
  if (marketDate) {
    try {
      const cacheDocRef = db
        .collection(RS_SYMBOL_CACHE_COLLECTION)
        .doc(marketDate)
        .collection(RS_SYMBOL_CACHE_SYMBOLS_SUBCOL)
        .doc(symbol);

      const snap = await cacheDocRef.get();
      const existing = (snap.exists ? (snap.data() as Partial<RsSymbolCacheDoc>) : {}) || {};

      const next: RsSymbolCacheDoc = {
        dailyBars: interval === Interval.DAILY ? (bars ?? null) : (existing.dailyBars ?? null),
        weeklyBars: interval === Interval.WEEKLY ? (bars ?? null) : (existing.weeklyBars ?? null),
        monthlyBars: interval === Interval.MONTHLY ? (bars ?? null) : (existing.monthlyBars ?? null),
        fetchedAt: FieldValue.serverTimestamp() as FirebaseFirestore.Timestamp,
        runId: existing.runId,
      };

      await cacheDocRef.set(next, { merge: false });
      logger.info('rsBarsCache_firestore_write', {
        symbol,
        marketDate,
        interval,
        from: fromIso,
        to: toIso,
        bars: bars.length,
      });
    } catch (e: any) {
      logger.warn('rsBarsCache_firestore_write_failed', {
        symbol,
        marketDate,
        interval,
        from: fromIso,
        to: toIso,
        message: e?.message,
      });
    }
  }

  return bars;
}

/**
 * Cloud Tasks worker entrypoint for RS jobs.
 *
 * This function is invoked by the Firebase v2 Tasks infrastructure for both
 * backfill and realtime RS jobs. It is responsible only for:
 * - Deserializing the task payload into a `ProcessRsJobPayload`.
 * - Delegating all lifecycle and compute logic to `processRsJobInternal`.
 * - Surfacing any unhandled errors back to Cloud Tasks so retries are
 *   applied according to the configured retry policy.
 *
 * The actual RS work (fetching time-series, computing RS, writing archives,
 * and updating run/job metadata) is implemented in `processRsJobInternal`
 * and `runRsPairIntervalJob`.
 */
export const processRsJobTask = onTaskDispatched<ProcessRsJobPayload>(
  {
    retryConfig: {
      maxAttempts: 5,
      minBackoffSeconds: 10,
      maxBackoffSeconds: 300,
    },
    rateLimits: {
      maxConcurrentDispatches: 20,
      maxDispatchesPerSecond: 1.0,
    },
    memory: '512MiB',
  },
  async (req) => {
    try {
      const payload = req.data as ProcessRsJobPayload;
      await processRsJobInternal(payload);
    } catch (e: any) {
      logger.error('processRsJobTask_failed', { message: e?.message || String(e) });
      throw e;
    }
  },
);

/**
 * Executes a single RS job for a given pair/interval/phase.
 *
 * Responsibilities:
 * - Normalize `from`/`to` into a bounded `[lower, upper]` window.
 * - Apply interval-specific padding so RS computation has sufficient
 *   historical context (e.g., pad DAILY by 10 days, WEEKLY by 35 days,
 *   MONTHLY by 5 months).
 * - Fetch upstream bars for baseline and target via `fetchDailyBarsRange`.
 * - Build an RS series using `buildPhaseSeries`.
 * - Clamp the resulting series to `[lower, upper]`.
 * - For DAILY:
 *   - Write the RS series via `writeUnifiedSeries` and update latest
 *     mirrors on the pair root doc.
 * - For WEEKLY / MONTHLY:
 *   - Purge existing archive docs for the window from the appropriate
 *     year-sharded collections.
 *   - Write the recomputed RS series via `writeUnifiedSeries` and update
 *     latest mirrors.
 * - Emit structured logs for observability, including no-series cases.
 *
 * Any thrown error bubbles up to `processRsJobInternal`, which converts it
 * into a `PERMANENT_FAILURE` job status and records `lastError` on the
 * corresponding job document.
 *
 * @param payload Full RS job payload describing pair, interval, phase,
 *   window, and job type context.
 */
async function runRsPairIntervalJob(payload: ProcessRsJobPayload, cache: BarsCache): Promise<void> {
  const { pairId, baseline, target, interval, phase, from, to, marketDate } = payload;

  const effectivePairId = pairId || `${baseline}-${target}`;
  if (!baseline || !target) {
    throw new Error('runRsPairIntervalJob_missing_baseline_or_target');
  }

  const lower = from ? String(from).slice(0, 10) : '0000-01-01';
  const upper = to
    ? String(to).slice(0, 10)
    : (() => {
        const today = new Date();
        return `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(
          today.getUTCDate(),
        ).padStart(2, '0')}`;
      })();

  const padFromForInterval = (fromVal: string | undefined, iv: Interval): string | undefined => {
    if (!fromVal) return fromVal;
    const base = new Date(`${fromVal}T00:00:00.000Z`);
    if (Number.isNaN(base.getTime())) return fromVal;

    if (iv === Interval.DAILY) {
      const padDays = 10;
      const padded = new Date(base.getTime() - padDays * 24 * 60 * 60 * 1000);
      const y = padded.getUTCFullYear();
      const m = String(padded.getUTCMonth() + 1).padStart(2, '0');
      const d = String(padded.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    if (iv === Interval.WEEKLY) {
      const padDays = 35;
      const padded = new Date(base.getTime() - padDays * 24 * 60 * 60 * 1000);
      const y = padded.getUTCFullYear();
      const m = String(padded.getUTCMonth() + 1).padStart(2, '0');
      const d = String(padded.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    if (iv === Interval.MONTHLY) {
      const padMonths = 5;
      const year = base.getUTCFullYear();
      const month = base.getUTCMonth() - padMonths;
      const padded = new Date(Date.UTC(year, month, 1));
      const y = padded.getUTCFullYear();
      const m = String(padded.getUTCMonth() + 1).padStart(2, '0');
      const d = String(padded.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    return fromVal;
  };

  // DAILY
  if (interval === Interval.DAILY) {
    const paddedFrom = padFromForInterval(from, Interval.DAILY) ?? from ?? lower;
    const baseDaily = await getOrFetchBars(marketDate, baseline, {
      from: paddedFrom,
      to: to!,
      interval: Interval.DAILY,
    }, cache);
    const targetDaily = await getOrFetchBars(marketDate, target, {
      from: paddedFrom,
      to: to!,
      interval: Interval.DAILY,
    }, cache);

    let series = buildPhaseSeries(
      baseDaily,
      targetDaily,
      (phase as RsPhase) ?? RsPhase.POST,
      baseline,
      target,
      logger,
      { from, to },
    );
    series = series.filter((p) => p.day >= lower && p.day <= upper);

    if (series.length === 0) {
      logger.warn('runRsPairIntervalJob_daily_no_series', {
        pair: effectivePairId,
        phase,
        from,
        to,
      });
      return;
    }

    await writeUnifiedSeries(
      baseline,
      target,
      (phase as RsPhase) ?? RsPhase.POST,
      series,
      baseDaily,
      targetDaily,
      Interval.DAILY,
    );
    logger.info('runRsPairIntervalJob_daily_done', {
      pair: effectivePairId,
      phase,
      from,
      to,
      writtenDays: series.length,
    });
    return;
  }

  // WEEKLY
  if (interval === Interval.WEEKLY) {
    const paddedFromWeekly = padFromForInterval(from, Interval.WEEKLY) ?? from ?? lower;
    const baseWeekly = await getOrFetchBars(marketDate, baseline, {
      from: paddedFromWeekly,
      to: to!,
      interval: Interval.WEEKLY,
    }, cache);
    const targetWeekly = await getOrFetchBars(marketDate, target, {
      from: paddedFromWeekly,
      to: to!,
      interval: Interval.WEEKLY,
    }, cache);

    let weeklySeries = buildPhaseSeries(
      baseWeekly,
      targetWeekly,
      (phase as RsPhase) ?? RsPhase.POST,
      baseline,
      target,
      logger,
      { from, to },
    );
    weeklySeries = weeklySeries.filter((p) => p.day >= lower && p.day <= upper);

    if (weeklySeries.length === 0) {
      logger.warn('runRsPairIntervalJob_weekly_no_series', {
        pair: effectivePairId,
        phase,
        from,
        to,
        paddedFromWeekly,
        lower,
        upper,
        baseWeeklyBars: baseWeekly?.length ?? 0,
        targetWeeklyBars: targetWeekly?.length ?? 0,
      });
      return;
    }

    try {
      const fromYear = Number(lower.slice(0, 4));
      const toYear = Number(upper.slice(0, 4));
      for (let y = fromYear; y <= toYear; y++) {
        const yearStr = String(y);
        const col = `${WEEKLY_ARCHIVE_COLLECTION_PREFIX}${yearStr}`;
        const yearFrom = `${yearStr}-01-01`;
        const yearTo = `${yearStr}-12-31`;
        const yearLower = lower > yearFrom ? lower : yearFrom;
        const yearUpper = upper < yearTo ? upper : yearTo;
        const collRef = db
          .collection(PAIRS_COLLECTION)
          .doc(effectivePairId)
          .collection(col);
        const snap = await collRef
          .where('day', '>=', yearLower)
          .where('day', '<=', yearUpper)
          .get();
        if (!snap.empty) {
          const batch = db.batch();
          for (const doc of snap.docs) {
            batch.delete(doc.ref);
          }
          await batch.commit();
        }
      }
    } catch (e: any) {
      logger.warn('runRsPairIntervalJob_weekly_purge_failed', {
        pair: effectivePairId,
        phase,
        message: e?.message,
      });
    }

    const windowToDay = (() => {
      if (to) {
        return String(to).slice(0, 10);
      }
      const today = new Date();
      const y = today.getUTCFullYear();
      const m = String(today.getUTCMonth() + 1).padStart(2, '0');
      const d = String(today.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    })();

    await writeUnifiedSeries(
      baseline,
      target,
      (phase as RsPhase) ?? RsPhase.POST,
      weeklySeries,
      baseWeekly,
      targetWeekly,
      Interval.WEEKLY,
      windowToDay,
    );

    logger.info('runRsPairIntervalJob_weekly_done', {
      pair: effectivePairId,
      phase,
      from,
      to,
      writtenDays: weeklySeries.length,
    });
    return;
  }

  // MONTHLY
  if (interval === Interval.MONTHLY) {
    const paddedFromMonthly = padFromForInterval(from, Interval.MONTHLY) ?? from ?? lower;
    const baseMonthly = await getOrFetchBars(marketDate, baseline, {
      from: paddedFromMonthly,
      to: to!,
      interval: Interval.MONTHLY,
    }, cache);
    const targetMonthly = await getOrFetchBars(marketDate, target, {
      from: paddedFromMonthly,
      to: to!,
      interval: Interval.MONTHLY,
    }, cache);

    let monthlySeries = buildPhaseSeries(
      baseMonthly,
      targetMonthly,
      (phase as RsPhase) ?? RsPhase.POST,
      baseline,
      target,
      logger,
      { from, to },
    );
    monthlySeries = monthlySeries.filter((p) => p.day >= lower && p.day <= upper);

    if (monthlySeries.length === 0) {
      logger.warn('runRsPairIntervalJob_monthly_no_series', {
        pair: effectivePairId,
        phase,
        from,
        to,
        paddedFromMonthly,
        lower,
        upper,
        baseMonthlyBars: baseMonthly?.length ?? 0,
        targetMonthlyBars: targetMonthly?.length ?? 0,
      });
      return;
    }

    try {
      const fromYear = Number(lower.slice(0, 4));
      const toYear = Number(upper.slice(0, 4));
      for (let y = fromYear; y <= toYear; y++) {
        const yearStr = String(y);
        const col = `${MONTHLY_ARCHIVE_COLLECTION_PREFIX}${yearStr}`;
        const yearFrom = `${yearStr}-01-01`;
        const yearTo = `${yearStr}-12-31`;
        const yearLower = lower > yearFrom ? lower : yearFrom;
        const yearUpper = upper < yearTo ? upper : yearTo;
        const collRef = db
          .collection(PAIRS_COLLECTION)
          .doc(effectivePairId)
          .collection(col);
        const snap = await collRef
          .where('day', '>=', yearLower)
          .where('day', '<=', yearUpper)
          .get();
        if (!snap.empty) {
          const batch = db.batch();
          for (const doc of snap.docs) {
            batch.delete(doc.ref);
          }
          await batch.commit();
        }
      }
    } catch (e: any) {
      logger.warn('runRsPairIntervalJob_monthly_purge_failed', {
        pair: effectivePairId,
        phase,
        message: e?.message,
      });
    }

    const windowToDay = (() => {
      if (to) {
        return String(to).slice(0, 10);
      }
      const today = new Date();
      const y = today.getUTCFullYear();
      const m = String(today.getUTCMonth() + 1).padStart(2, '0');
      const d = String(today.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    })();

    await writeUnifiedSeries(
      baseline,
      target,
      (phase as RsPhase) ?? RsPhase.POST,
      monthlySeries,
      baseMonthly,
      targetMonthly,
      Interval.MONTHLY,
      windowToDay,
    );

    logger.info('runRsPairIntervalJob_monthly_done', {
      pair: effectivePairId,
      phase,
      from,
      to,
      writtenDays: monthlySeries.length,
    });
    return;
  }

  logger.warn('runRsPairIntervalJob_unsupported_interval', {
    pair: effectivePairId,
    baseline,
    target,
    interval,
    phase,
    from,
    to,
  });
}

/**
 * Updates aggregate counters on a backfill run when a job reaches a
 * terminal state (SUCCESS or PERMANENT_FAILURE).
 *
 * Behavior:
 * - Increments `successJobs` when `isSuccess` is true.
 * - Increments `permanentFailureJobs` when `isPermanentFailure` is true.
 * - Always refreshes `updatedAt` using `serverTimestamp`.
 * - After the atomic transaction, re-reads the run doc to check whether
 *   `successJobs + permanentFailureJobs >= expectedJobs` and, if so and the
 *   run is not already COMPLETE, marks the run `COMPLETE` and sets
 *   `runCompletedAt`.
 *
 * This helper does not throw if the run document is missing; it simply
 * returns early, allowing the worker to continue without disrupting other
 * jobs.
 *
 * @param runId Identifier of the backfill run under
 *   `system/rs-backfill-runs/runs/{runId}`.
 * @param isSuccess Whether the job finished in `SUCCESS` state.
 * @param isPermanentFailure Whether the job finished in `PERMANENT_FAILURE`
 *   state.
 */
async function updateBackfillRunForJobTerminal(
  runId: string,
  isSuccess: boolean,
  isPermanentFailure: boolean,
): Promise<void> {
  const runRef = db.doc(rsBackfillRunDocPath(runId));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if (!snap.exists) {
      return;
    }
    const updates: UpdateData<RsBackfillRunDoc> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (isSuccess) {
      updates['successJobs'] = FieldValue.increment(1);
    }
    if (isPermanentFailure) {
      updates['permanentFailureJobs'] = FieldValue.increment(1);
    }
    tx.update(runRef, updates);
  });

  const latestSnap = await runRef.get();
  if (!latestSnap.exists) {
    return;
  }
  const data = latestSnap.data() as RsBackfillRunDoc;
  const expected = data.expectedJobs ?? 0;
  const success = data.successJobs ?? 0;
  const failure = data.permanentFailureJobs ?? 0;
  if (success + failure >= expected && data.status !== RsBackfillRunStatus.COMPLETE) {
    await runRef.update({
      status: RsBackfillRunStatus.COMPLETE,
      runCompletedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

/**
 * Updates aggregate counters on a realtime run (keyed by runId) when a job
 * reaches a terminal state. Mirrors backfill behavior but stores aggregates
 * under `system/rs-realtime-runs/{runId}` and uses RsRealtimeRunStatus.
 *
 * @param runId Identifier of the realtime run under `system/rs-realtime-runs/{runId}`.
 * @param pairId Identifier of the pair for which the job was executed.
 * @param isSuccess Whether the job finished in `SUCCESS` state.
 * @param isPermanentFailure Whether the job finished in `PERMANENT_FAILURE`
 *   state.
 */
async function updateRealtimeRunForJobTerminal(
  runId: string,
  pairId: string,
  isSuccess: boolean,
  isPermanentFailure: boolean,
): Promise<void> {
  const runRef = db.doc(rsRealtimeRunDocPath(runId));

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if (!snap.exists) {
      return;
    }
    const existing = snap.data() as RsRealtimeRunDoc;
    const updates: UpdateData<RsRealtimeRunDoc> = {
      runDocUpdatedAt: FieldValue.serverTimestamp(),
    };

    if (isSuccess) {
      updates['successJobs'] = FieldValue.increment(1);
    }
    if (isPermanentFailure) {
      updates['permanentFailureJobs'] = FieldValue.increment(1);
      updates['permanentFailurePairs'] = FieldValue.arrayUnion(pairId);
    }

    // Set runStartedAt the first time any job reaches a terminal
    // state for this run.
    if (!existing.runStartedAt) {
      (updates as any)['runStartedAt'] = FieldValue.serverTimestamp();
    }
    tx.update(runRef, updates);
  });

  const latestSnap = await runRef.get();
  if (!latestSnap.exists) {
    return;
  }
  const data = latestSnap.data() as RsRealtimeRunDoc;
  const expected = data.expectedJobs ?? 0;
  const success = data.successJobs ?? 0;
  const failure = data.permanentFailureJobs ?? 0;
  if (success + failure >= expected && data.runStatus === RsRealtimeRunStatus.IN_PROGRESS) {

    const finalStatus: RsRealtimeRunStatus =
      failure === 0 ? RsRealtimeRunStatus.COMPLETE
      : success > 0 ? RsRealtimeRunStatus.PARTIAL
      : RsRealtimeRunStatus.FAILED;

    let totalDuration: string | undefined;
    if (data.runStartedAt && typeof (data.runStartedAt as any).toMillis === 'function') {
      try {
        const startMs = (data.runStartedAt as any).toMillis();
        const endMs = Date.now();
        const diffSec = Math.max(0, Math.round((endMs - startMs) / 1000));
        const mm = String(Math.floor(diffSec / 60)).padStart(2, '0');
        const ss = String(diffSec % 60).padStart(2, '0');
        totalDuration = `${mm}:${ss}`;
      } catch {
        totalDuration = undefined;
      }
    }

    const finalUpdate: UpdateData<RsRealtimeRunDoc> = {
      runStatus: finalStatus,
      runCompletedAt: FieldValue.serverTimestamp(),
      runDocUpdatedAt: FieldValue.serverTimestamp(),
    } as any;

    if (totalDuration) {
      (finalUpdate as any).totalDuration = totalDuration;
    }

    await runRef.update(finalUpdate);

    // Mirror aggregate metrics back to the partner-events doc for this run so
    // that dashboards relying on EVENTS_COLLECTION remain accurate when
    // realtime Cloud Tasks are used instead of the legacy inline loop.
    try {
      const eventId = runId;
      const eventRef = db.collection(EVENTS_COLLECTION).doc(eventId);
      const windowFrom = (data as any).from as string | undefined;
      const windowTo = (data as any).to as string | undefined;

      const backfillStyleStatus: 'COMPLETE' | 'PARTIAL' | 'FAILED' =
        failure === 0 ? 'COMPLETE' : success > 0 ? 'PARTIAL' : 'FAILED';

      const eventPatch: Record<string, any> = {
        runStatus: backfillStyleStatus,
        successJobs: success,
        permanentFailureJobs: failure,
        pairsProcessed: success,
        pairsFailed: failure,
        runCompletedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (windowFrom || windowTo) {
        eventPatch.window = {
          from: windowFrom || null,
          to: windowTo || null,
        };
      }

      await eventRef.set(eventPatch, { merge: true });
    } catch (e: any) {
      logger.warn('updateRealtimeRunForJobTerminal_event_mirror_failed', {
        runId,
        message: e?.message,
      });
    }

    // Trigger heatmap snapshot updates for affected baselines after successful realtime run completion
    if (finalStatus === RsRealtimeRunStatus.COMPLETE || finalStatus === RsRealtimeRunStatus.PARTIAL) {
      try {
        // Extract unique baselines from the run's jobs
        const interval = data.interval;
        const jobsRef = db.doc(rsRealtimeRunDocPath(runId)).collection('jobs');
        const jobsSnap = await jobsRef.get();
        const baselinesSet = new Set<string>();
        
        jobsSnap.forEach((doc) => {
          const jobData = doc.data();
          if (jobData?.baseline) {
            baselinesSet.add(String(jobData.baseline).toUpperCase());
          }
        });

        const baselines = Array.from(baselinesSet);
        
        if (baselines.length > 0) {
          await triggerHeatmapUpdatesForBaselines(interval, baselines);
          logger.info('updateRealtimeRunForJobTerminal_heatmap_triggered', {
            runId,
            interval,
            baselines: baselines.length,
          });
        }
      } catch (e: any) {
        logger.error('updateRealtimeRunForJobTerminal_heatmap_trigger_failed', {
          runId,
          message: e?.message,
        });
      }
    }
  }
}

/**
 * Core RS job processor used by `processRsJobTask`.
 *
 * Responsibilities:
 * - Resolve the Firestore job document path from the payload:
 *   - BACKFILL jobs → `rsBackfillJobDocPath(runId, pairId, interval, phase)`.
 *   - REALTIME jobs → `rsRealtimeRunJobDocPath(runId, pairId, interval, phase)` (runId-keyed).
 *
 * - Verify that the job document exists; if missing, log and return
 *   without attempting compute.
 * - Transition the job to `IN_PROGRESS`, increment `attempts`, and set
 *   `lastAttemptAt` / `updatedAt`.
 * - Invoke `runRsPairIntervalJob` to perform the RS compute and archive
 *   writes.
 * - On success, set job status to `SUCCESS`.
 * - On error, set job status to `PERMANENT_FAILURE`, record `lastError`,
 *   and log a structured `processRsJobInternal_error` entry.
 * - For BACKFILL jobs, call `updateBackfillRunForJobTerminal` so the
 *   parent run aggregates (`successJobs`, `permanentFailureJobs`,
 *   `status`, `runCompletedAt`) remain consistent.
 * - For REALTIME jobs, call `updateRealtimeRunForJobTerminal` so the
 *   parent run aggregates (`successJobs`, `permanentFailureJobs`,
 *   `status`, `runCompletedAt`) remain consistent.
 *
 * This function deliberately avoids throwing after the job document has
 * been updated to a terminal state; instead it logs and returns, allowing
 * Cloud Tasks to treat the execution as successful from an infrastructure
 * perspective while still marking the job as a permanent failure in
 * Firestore.
 *
 * @param payload RS job payload received from Cloud Tasks, including
 *   job type, identifiers, pair info, interval, phase, and backfill
 *   window.
 */
export async function processRsJobInternal(payload: ProcessRsJobPayload): Promise<void> {
  const { jobType, runId, pairId, baseline, target, interval, phase } = payload;

  const pairLabel = pairId || `${baseline}-${target}`;

  let jobPath: string;
  if (jobType === RsJobType.BACKFILL) {
    if (!runId) {
      logger.warn('processRsJobInternal_missing_runId', { payload });
      return;
    }
    jobPath = rsBackfillJobDocPath(runId, pairId, interval, phase);
  } else {
    if (!runId) {
      logger.warn('processRsJobInternal_missing_runId_for_realtime', { payload });
      return;
    }
    jobPath = rsRealtimeRunJobDocPath(runId, pairId, interval, phase);
  }

  const docRef = db.doc(jobPath);
  const snap = await docRef.get();
  if (!snap.exists) {
    logger.warn('processRsJobInternal_missing_job_doc', { jobPath });
    return;
  }

  await docRef.set(
    {
      status: RsJobStatus.IN_PROGRESS,
      attempts: FieldValue.increment(1),
      lastAttemptAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  let finalStatus: RsJobStatus = RsJobStatus.SUCCESS;
  let lastError: string | undefined;
  try {
    const cache: BarsCache = new Map<string, PartnerBar[]>();
    await runRsPairIntervalJob(payload, cache);
    finalStatus = RsJobStatus.SUCCESS;
  } catch (e: any) {
    const message = e?.message ? String(e.message) : String(e);
    lastError = message;
    finalStatus = RsJobStatus.PERMANENT_FAILURE;
    logger.error(
      `processRsJobInternal_error pair=${pairLabel} interval=${interval} jobType=${jobType}`,
      { jobPath, jobType, pairId: pairLabel, interval, phase, message },
    );
  }

  const update: Record<string, unknown> = {
    status: finalStatus,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (lastError) {
    update['lastError'] = lastError;
  }
  await docRef.set(update, { merge: true });

  if (jobType === RsJobType.BACKFILL && runId) {
    await updateBackfillRunForJobTerminal(
      runId,
      finalStatus === RsJobStatus.SUCCESS,
      finalStatus === RsJobStatus.PERMANENT_FAILURE,
    );
  }

  if (jobType === RsJobType.REALTIME && runId) {
    await updateRealtimeRunForJobTerminal(
      runId,
      pairId,
      finalStatus === RsJobStatus.SUCCESS,
      finalStatus === RsJobStatus.PERMANENT_FAILURE,
    );
  }

  logger.info(
    `processRsJobInternal_done pair=${pairLabel} interval=${interval} jobType=${jobType} status=${finalStatus}`,
    { jobPath, jobType, pairId: pairLabel, interval, phase, status: finalStatus },
  );
}