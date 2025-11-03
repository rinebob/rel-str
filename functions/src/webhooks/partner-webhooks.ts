/**
 * Partner Data-Ready Subscriber and RS Writer
 *
 * Listens to partner "data-ready" Pub/Sub notifications and, for each registered
 * baseline–target pair, fetches the latest DAILY OHLCV bars (last 30), computes
 * Relative Strength (RS = targetClose / baseClose) on aligned timestamps, and
 * persists both a short RS series and a latest snapshot into Firestore under
 * `pairs/{BASELINE}-{TARGET}`.
 *
 * Why fixed DAILY/30 for now?
 * - We intentionally constrain the scope to keep the storage model and pipeline
 *   simple while we validate end-to-end behavior. Wider ranges and more
 *   intervals can be added once RS storage and FE consumption are in place.
 */
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { logger } from 'firebase-functions';
import { db, FieldValue } from '../firebase-admin-init';
import { fetchDailyBarsRaw, fetchDailyBarsRange } from './symbol-fetch';
import { buildPhaseSeries } from './rs-series';
import { writeUnifiedSeries } from './pairs-writer';
import { listRegisteredPairs } from './registry';
import {
  toKebabRunType,
  formatPtSegment,
  computeEventDocId,
  markProcessing,
} from './partner-events';
import {
  PARTNER_DATA_READY_TOPIC,
  EVENTS_COLLECTION,
  FIXED_INTERVAL,
  FIXED_LIMIT,
  FIXED_DAYS,
  type ProcessErrorSample,
  RunType,
  RsCloudFunctionName,
} from './webhooks-config';
import { persistWarning } from '../logging/warn';
import { writeWarningsSummary } from '../logging/warn';
import { RsPhase } from '../types/partner';

// Firebase Admin and Firestore are initialized in ../firebase-admin-init
// Shared constants and enums have been moved to ./webhooks-config

/**
 * Partner Data-Ready Subscriber (V2) — Orchestrator
 *
 * End-to-end data flow:
 * 1) Trigger: Partner publishes a message to PARTNER_DATA_READY_TOPIC (Pub/Sub).
 * 2) Resolution: We parse attributes + JSON payload, normalize runType, compute a stable event doc id,
 *    and mark the event as `processing` in EVENTS_COLLECTION for observability and idempotency.
 * 3) Pairs: We load registered baseline–target pairs from REGISTRY_COLLECTION.
 * 4) Bars: For each pair, we fetch DAILY bars for the last FIXED_DAYS and compute the phase series.
 *    - Phase PRE uses intraday (ip/ipc) when available; POST uses EOD (ac/cp).
 * 5) Write: We upsert unified series and latest snapshot for the pair under pairs/* via writeUnifiedSeries.
 * 6) Complete: We record final status (completed or completed_with_errors) and sampled error details.
 *
 * Idempotency:
 * - Event doc status is checked; terminal statuses are skipped to avoid duplicate work.
 * - Series writes are keyed by logical day and phase, enabling idempotent upserts.
 */

/**
 * Run a Promise-producing worker for each item with at most `limit` active workers.
 * Throttles IO-bound work (partner API + Firestore) to keep the function responsive.
 *
 * @param items The items to process
 * @param limit Maximum concurrency (>= 1)
 * @param worker Async worker invoked per item (t, idx)
 */
async function forEachWithConcurrency<T>(items: T[], limit: number, worker: (t: T, idx: number) => Promise<void>): Promise<void> {
  let i = 0;
  const starters = Array.from({ length: Math.min(limit, items.length) }, () => Promise.resolve());
  await Promise.all(
    starters.map(async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          await worker(items[idx], idx);
        } catch {
          // errors are handled at call sites
        }
      }
    })
  );
}

/**
 * Resolve runType, isHeartbeat, and runId from message and payload.
 */
function resolveRunContext(message: any, payload: Record<string, any>): {
  runType?: string;
  isHeartbeat: boolean;
  runId?: string;
} {
  const attrRunType = message?.attributes?.runType as string | undefined;
  const payloadRunType = (payload.runType as string | undefined) ?? (payload.run_type as string | undefined);
  const runType = attrRunType ?? payloadRunType;
  const isHeartbeatAttr = (message?.attributes?.heartbeat as string | undefined)?.toLowerCase() === 'true';
  const isHeartbeat = isHeartbeatAttr || runType === RunType.HEARTBEAT;
  const attrRunId = message?.attributes?.runId as string | undefined;
  const runId = attrRunId ?? (payload.runId as string | undefined) ?? (payload.run_id as string | undefined);
  return { runType, isHeartbeat, runId };
}

/**
 * Process a single baseline–target pair using live partner fetches.
 *
 * Steps:
 * - Fetch DAILY bars for baseline and target for the last `days`.
 * - Build a phase-aware aligned series (buildPhaseSeries).
 * - Upsert unified series + latest snapshot to pairs-data (writeUnifiedSeries).
 * - Record sampled errors with pair id on failures.
 *
 * @param baseline Baseline symbol (e.g., SPY)
 * @param target Target symbol (e.g., AAPL)
 * @param phase PRE for intraday or POST for end-of-day
 * @param days Window (calendar days)
 * @param accum Accumulators for success/failed counters and errorSamples
 * @param caches Baseline-only cache to avoid duplicate upstream fetches within a run
 * @param ctx Optional run context (runId, eventType, trigger) for logging
 */
async function processPairLive(
  baseline: string,
  target: string,
  phase: RsPhase,
  days: number,
  accum: { successPairs: number; failedPairs: number; errorSamples: ProcessErrorSample[] },
  caches?: { baselineBars: Map<string, any[]> },
  ctx?: { runId?: string; eventType?: string; trigger?: string }
): Promise<void> {
  const pairId = `${baseline}-${target}`;
  try {
    // Baseline-only cache to avoid duplicate upstream fetches within a run
    let baseBars: any[] | undefined = caches?.baselineBars?.get(baseline);
    if (!baseBars) {
      baseBars = await fetchDailyBarsRaw(baseline, days, FIXED_LIMIT);
      if (caches && caches.baselineBars) caches.baselineBars.set(baseline, baseBars);
    }
    const targetBars = await fetchDailyBarsRaw(target, days, FIXED_LIMIT);
    const series = buildPhaseSeries(baseBars, targetBars, phase, baseline, target, logger);
    if (series.length === 0) {
      accum.failedPairs++;
      if (accum.errorSamples.length < 10) accum.errorSamples.push({ pair: pairId, message: 'no_aligned_series' });
      // Persist a warning for UI visibility (best-effort)
      await persistWarning('no_aligned_series', { function: RsCloudFunctionName.PROCESS_PAIR_LIVE, pairId, baseline, target, phase, runId: ctx?.runId, eventType: ctx?.eventType, trigger: ctx?.trigger });
      return;
    }
    await writeUnifiedSeries(baseline, target, phase, series, baseBars, targetBars);
    accum.successPairs++;
  } catch (e: any) {
    accum.failedPairs++;
    const status = e?.response?.status as number | undefined;
    const msg = e?.message || String(e);
    if (accum.errorSamples.length < 10) {
      const sample: ProcessErrorSample = { pair: pairId, status, message: msg };
      if (e?.code !== undefined) sample.code = e.code;
      accum.errorSamples.push(sample);
    }
  }
}

/**
 * Pub/Sub subscriber for partner data-ready messages.
 *
 * High-level flow:
 * 1) Parse attributes/payload; compute a stable event doc id and mark the run
 *    as `processing` in `partner-events/*` (idempotent if terminal).
 * 2) Load registered baseline–target pairs from `pair-registry/*`.
 * 3) For each pair: fetch DAILY last-30 bars for baseline and target, compute
 *    RS on aligned timestamps, and write RS series and a latest snapshot under
 *    `pairs/*`.
 * 4) Record completion status and summary metrics back to the event doc.
 *
 * Idempotency:
 * - Terminal runs are skipped early using the event doc's `status`.
 * - Series writes use `t` as the document id for idempotent upserts.
 */
export const processDataReadyRunV2 = onMessagePublished(
  { topic: PARTNER_DATA_READY_TOPIC, region: 'us-central1' },
  async (event) => {
    /**
     * V2 handler for partner data-ready events. This function is idempotent and safe
     * to re-trigger: terminal statuses in EVENTS_COLLECTION are honored to avoid rework.
     */
    // Resolve phase from attributes or payload, default to POST if omitted
    const message = event.data.message as any;
    const attrPhase = (message?.attributes?.phase as string | undefined)?.toLowerCase();
    let payloadPhase: string | undefined;
    let parsedPayload: Record<string, any> | undefined;
    let rawString: string | undefined;
    try {
      rawString = typeof message?.data === 'string' ? Buffer.from(message.data, 'base64').toString('utf8') : '{}';
      parsedPayload = JSON.parse(rawString || '{}');
      payloadPhase = (parsedPayload?.phase as string | undefined)?.toLowerCase();
    } catch {
      // ignore
    }
    const phase: RsPhase = (attrPhase === RsPhase.PRE || attrPhase === RsPhase.POST) ? (attrPhase as RsPhase)
      : (payloadPhase === RsPhase.PRE || payloadPhase === RsPhase.POST) ? (payloadPhase as RsPhase)
      : RsPhase.POST;

    // Resolve run context and set up partner-events doc for observability/idempotency
    const { runType, isHeartbeat, runId } = resolveRunContext(message, parsedPayload || {});
    const messageId = message.messageId as string | undefined;
    const ptSegment = isHeartbeat ? formatPtSegment(message.publishTime as string | undefined) : undefined;
    const effectiveRunId = (runId && String(runId).trim()) || (isHeartbeat ? 'hb-no-runid' : undefined);
    // Persistable trigger source (manual | scheduled | heartbeat), prefer attribute over payload, lowercase
    const attrTrigger = (message?.attributes?.trigger as string | undefined)?.toLowerCase();
    const payloadTrigger = (parsedPayload?.trigger as string | undefined)?.toLowerCase();
    const trigger = attrTrigger || payloadTrigger;

    // Derive a robust runType if not provided by SA.
    // Priority:
    // - Heartbeat if flagged
    // - Weekly/Monthly post if intervals include those
    // - Daily pre/post based on phase (default Daily)
    let derivedRunType: string | undefined;
    if (isHeartbeat || trigger === 'heartbeat') {
      derivedRunType = RunType.HEARTBEAT;
    } else {
      const intervals: Array<string> = Array.isArray(parsedPayload?.intervals)
        ? (parsedPayload!.intervals as any[]).map((v) => String(v).toUpperCase())
        : [];
      const hasWeekly = intervals.includes('WEEKLY');
      const hasMonthly = intervals.includes('MONTHLY');
      const hasDaily = intervals.includes('DAILY') || intervals.length === 0; // default to DAILY when unspecified
      if (hasMonthly && phase === RsPhase.POST) derivedRunType = RunType.TS_MONTHLY_POST;
      else if (hasWeekly && phase === RsPhase.POST) derivedRunType = RunType.TS_WEEKLY_POST;
      else if (hasDaily && phase === RsPhase.PRE) derivedRunType = RunType.TS_DAILY_PRE;
      else if (hasDaily && phase === RsPhase.POST) derivedRunType = RunType.TS_DAILY_POST;
    }

    const eventTypeRaw = isHeartbeat ? RunType.HEARTBEAT : (runType as string | undefined) || derivedRunType || 'unknown';
    const eventType = toKebabRunType(eventTypeRaw) || 'unknown';

    // Receipt log for observability
    logger.info('V2 Received Data-Ready message', {
      messageId,
      attributes: message?.attributes,
      payloadPreview: typeof rawString === 'string' ? rawString.slice(0, 300) : undefined,
      runId,
      phase,
      trigger,
      runTypeProvided: runType,
      runTypeDerived: derivedRunType,
      eventType,
    });

    let eventRef: FirebaseFirestore.DocumentReference | undefined;
    let eventDocId: string | undefined;
    if (effectiveRunId) {
      eventDocId = computeEventDocId({
        messageId,
        isHeartbeat,
        ptSegment,
        eventType,
        runId: effectiveRunId,
      });
      eventRef = db.collection(EVENTS_COLLECTION).doc(eventDocId);

      // Skip if already terminal
      try {
        const existing = await eventRef.get();
        const existingStatus = existing.exists ? (existing.data()?.status as string | undefined) : undefined;
        if (existingStatus === 'completed' || existingStatus === 'failed' || existingStatus === 'completed_with_errors') {
          logger.info('processDataReadyRunV2 skipping terminal run', { docId: eventDocId, runId: effectiveRunId, status: existingStatus });
          try { await persistWarning('skipped_terminal_run', { function: RsCloudFunctionName.PROCESS_DATA_READY, docId: eventDocId, runId: effectiveRunId, status: existingStatus }); } catch {}
          return;
        }
      } catch {}

      await markProcessing(eventRef, {
        eventType,
        isHeartbeat,
        runId: effectiveRunId,
        messageId,
        publishTime: (message?.publishTime as string | undefined) ?? undefined,
        ptSegment,
      });

      // Persist phase and trigger early for observability
      try {
        const update: Record<string, unknown> = { phase };
        if (trigger) update['trigger'] = trigger;
        if (eventType) update['runType'] = eventType;
        await eventRef.set(update, { merge: true });
      } catch {}

      // Load registered pairs
      const pairs = await listRegisteredPairs();
      if (pairs.length === 0) {
        logger.info('processDataReadyRunV2 no registered pairs');
        if (eventRef) {
          await eventRef.set({ status: 'completed', endTime: FieldValue.serverTimestamp(), pairsProcessed: 0, pairsFailed: 0 }, { merge: true });
        }
        try { await persistWarning('no_registered_pairs', { function: RsCloudFunctionName.PROCESS_DATA_READY, runId: effectiveRunId, eventType }); } catch {}
        return;
      }

      const days = FIXED_DAYS;

      // Track summary
      let successPairs = 0;
      let failedPairs = 0;
      const errorSamples: ProcessErrorSample[] = [];
      logger.info('processDataReadyRunV2 starting pair processing', { count: pairs.length, phase, eventType, runId: effectiveRunId });
      const PAIR_CONCURRENCY = Number(process.env.PARTNER_PAIR_CONCURRENCY) || 3;
      const baselineBarsCache = new Map<string, any[]>();
      await forEachWithConcurrency(pairs, PAIR_CONCURRENCY, async ({ baseline, target }) => {
        await processPairLive(baseline, target, phase, days, { successPairs, failedPairs, errorSamples }, { baselineBars: baselineBarsCache }, { runId: effectiveRunId, eventType, trigger });
      });

      if (eventRef) {
        const finalStatus = failedPairs > 0 ? 'completed_with_errors' : 'completed';
        await eventRef.set({
          status: finalStatus,
          endTime: FieldValue.serverTimestamp(),
          pairsProcessed: successPairs,
          pairsFailed: failedPairs,
          intervalUsed: FIXED_INTERVAL,
          window: FIXED_LIMIT,
          phase,
          ...(trigger ? { trigger } : {}),
          runType: eventType,
          errorSamples,
        }, { merge: true });
      }
    } else if (!isHeartbeat) {
      // No runId and not a heartbeat: do not proceed
      logger.info('processDataReadyRunV2 missing runId and not a heartbeat; skipping');
      return;
    }
  }
);

import { onCall, onRequest } from 'firebase-functions/v2/https';

/**
 * Callable: recomputePairsRs
 * Recompute RS for specified pairs (or all registered under a baseline) for a configurable window.
 * Params: { baseline: string; symbols?: string[]; phase?: PRE|POST|'both'; days?: number; limit?: number; concurrency?: number; from?: string; to?: string; yearsBack?: number; missingOnly?: boolean }
 */
export const recomputePairsRs = onCall({ region: 'us-central1', timeoutSeconds: 540 }, async (req) => {
  try {
    const baselineRaw = String(req.data?.baseline || '').trim().toUpperCase();
    const symbolsRaw: string[] = Array.isArray(req.data?.symbols) ? req.data.symbols : [];
    const pairsRaw: Array<{ baseline: string; target: string }> = Array.isArray(req.data?.pairs) ? req.data.pairs : [];
    const phaseRaw = String(req.data?.phase || RsPhase.POST).toLowerCase();
    const days = Number(req.data?.days ?? FIXED_DAYS);
    const limit = Number(req.data?.limit ?? FIXED_LIMIT);
    const from: string | undefined = req.data?.from ? String(req.data.from) : undefined;
    const to: string | undefined = req.data?.to ? String(req.data.to) : undefined;
    const yearsBack: number | undefined = Number.isFinite(req.data?.yearsBack) ? Number(req.data.yearsBack) : undefined;
    const missingOnly: boolean = !!req.data?.missingOnly;
    const concurrency = Number(req.data?.concurrency ?? (Number(process.env.PARTNER_PAIR_CONCURRENCY) || 3));
    const delayMsBetweenPairs = Math.max(0, Number(req.data?.delayMsBetweenPairs ?? 0) || 0);
    if (!baselineRaw && pairsRaw.length === 0) return { ok: false, error: 'missing_baseline_or_pairs' };

    // Resolve pairs list
    let pairsList: Array<{ baseline: string; target: string }> = [];
    if (pairsRaw.length > 0) {
      pairsList = pairsRaw
        .map((p: any) => ({
          baseline: String(p?.baseline || '').trim().toUpperCase(),
          target: String(p?.target || '').trim().toUpperCase(),
        }))
        .filter((p) => p.baseline && p.target);
    } else {
      // Fallback: baseline + optional symbols subset
      let targets: string[] = [];
      if (symbolsRaw.length) {
        targets = symbolsRaw.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
      } else {
        const all = await listRegisteredPairs();
        targets = all.filter(p => p.baseline === baselineRaw).map(p => p.target);
      }
      if (targets.length === 0) return { ok: false, error: 'no_targets' };
      pairsList = targets.map(t => ({ baseline: baselineRaw, target: t }));
    }

    const doPhase = async (phase: RsPhase) => {
      const accum = { successPairs: 0, failedPairs: 0, errorSamples: [] as ProcessErrorSample[] };
      let skippedExisting = 0; // reserved for future use in callable path
      let writtenDays = 0;     // reserved for future use in callable path
      logger.info('recomputePairsRs starting pair processing', { count: pairsList.length, phase, concurrency, delayMsBetweenPairs });
      const baselineBarsCache = new Map<string, any[]>();
      await forEachWithConcurrency(pairsList, Math.max(1, concurrency), async ({ baseline, target }) => {
        await processPairLive(baseline, target, phase, days, accum, { baselineBars: baselineBarsCache });
        if (delayMsBetweenPairs > 0) {
          await new Promise((r) => setTimeout(r, delayMsBetweenPairs));
        }
      });

      return { successPairs: accum.successPairs, failedPairs: accum.failedPairs, skippedExisting, writtenDays, errorSamples: accum.errorSamples };
    };

    const phases: RsPhase[] = phaseRaw === 'both' ? [RsPhase.PRE, RsPhase.POST] : (phaseRaw === RsPhase.PRE ? [RsPhase.PRE] : [RsPhase.POST]);
    const results = [] as Array<{ phase: RsPhase; successPairs: number; failedPairs: number; skippedExisting: number; writtenDays: number; errorSamples: ProcessErrorSample[] }>;
    for (const ph of phases) {
      const r = await doPhase(ph);
      results.push({ phase: ph, ...r });
    }
    try { await writeWarningsSummary({ function: 'recomputePairsRs', baseline: baselineRaw || null, pairs: pairsList.length }); } catch {}
    return { ok: true, baseline: baselineRaw || null, pairs: pairsList.length, days, limit, from, to, yearsBack, missingOnly, results };
  } catch (e: any) {
    logger.error('recomputePairsRs_failed', { message: e?.message });
    return { ok: false, error: e?.message || 'internal_error' };
  }
});

/**
 * HTTP (admin): recomputeRegisteredBackfill
 * Backfill all registered pairs across all baselines. Protect with bearer ADMIN_BACKFILL_TOKEN.
 * Query/body: { phase?: PRE|POST|'both', days?: number, limit?: number, concurrency?: number, from?: string, to?: string, yearsBack?: number, missingOnly?: boolean }
 */
export const recomputeRegisteredBackfill = onRequest({ region: 'us-central1', timeoutSeconds: 540 }, async (req, res) => {
  const token = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
  const expected = (process.env.ADMIN_BACKFILL_TOKEN || '').trim();
  if (!expected || token !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  try {
    const phaseRaw = String((req.query.phase || req.body?.phase || RsPhase.POST)).toLowerCase();
    const days = Number(req.query.days || req.body?.days || FIXED_DAYS);
    const limit = Number(req.query.limit || req.body?.limit || FIXED_LIMIT);
    const from: string | undefined = (req.query.from as string) || req.body?.from;
    const to: string | undefined = (req.query.to as string) || req.body?.to;
    const yearsBack: number | undefined = req.query.yearsBack ? Number(req.query.yearsBack) : (Number.isFinite(req.body?.yearsBack) ? Number(req.body.yearsBack) : undefined);
    const missingOnly: boolean = String((req.query.missingOnly ?? req.body?.missingOnly ?? '')).toLowerCase() === 'true';
    const concurrency = Number(req.query.concurrency || req.body?.concurrency || (Number(process.env.PARTNER_PAIR_CONCURRENCY) || 3));

    const pairs = await listRegisteredPairs();
    const phases: RsPhase[] = phaseRaw === 'both' ? [RsPhase.PRE, RsPhase.POST] : (phaseRaw === RsPhase.PRE ? [RsPhase.PRE] : [RsPhase.POST]);
    const summary: any = { ok: true, totalPairs: pairs.length, days, limit, from, to, yearsBack, missingOnly, phases, results: [] };

    for (const ph of phases) {
      let successPairs = 0;
      let failedPairs = 0;
      let skippedExisting = 0;
      let writtenDays = 0;
      const errorSamples: ProcessErrorSample[] = [];
      const baselineBarsCache = new Map<string, any[]>();
      await forEachWithConcurrency(pairs, Math.max(1, concurrency), async ({ baseline, target }) => {
        try {
          const useRange = !!(from || to || Number.isFinite(yearsBack as number));
          let baseBars: any[] | undefined = baselineBarsCache.get(baseline);
          if (!baseBars) {
            baseBars = useRange
              ? await fetchDailyBarsRange(baseline, { from, to, yearsBack, days, limit, interval: FIXED_INTERVAL })
              : await fetchDailyBarsRaw(baseline, days, limit);
            baselineBarsCache.set(baseline, baseBars);
          }
          const targetBars = useRange
            ? await fetchDailyBarsRange(target, { from, to, yearsBack, days, limit, interval: FIXED_INTERVAL })
            : await fetchDailyBarsRaw(target, days, limit);
          const series = buildPhaseSeries(baseBars, targetBars, ph, baseline, target, logger);
          if (series.length === 0) {
            failedPairs++;
            if (errorSamples.length < 50) errorSamples.push({ pair: `${baseline}-${target}`, message: 'no_aligned_series' });
            try { await persistWarning('no_aligned_series', { function: RsCloudFunctionName.RECOMPUTE_BACKFILL, pairId: `${baseline}-${target}`, baseline, target, phase: ph }); } catch {}
            return;
          }
          let entries = series;
          if (missingOnly) {
            const pairId = `${baseline}-${target}`;
            const snap = await db.collection('pairs-data').doc(pairId).get();
            const dataArr: any[] = snap.exists && Array.isArray((snap.data() as any)?.data) ? (snap.data() as any).data : [];
            const existingDays = new Set<string>();
            for (const row of dataArr) {
              const day = String(row?.day || '');
              if (!day) continue;
              if (ph === RsPhase.POST && row?.post?.rs !== undefined) existingDays.add(day);
              if (ph === RsPhase.PRE && row?.pre?.rs !== undefined) existingDays.add(day);
            }
            const before = entries.length;
            entries = entries.filter(e => !existingDays.has(e.day));
            skippedExisting += (before - entries.length);
            if (entries.length === 0) { successPairs++; return; }
          }
          await writeUnifiedSeries(baseline, target, ph, entries, baseBars, targetBars);
          writtenDays += entries.length;
          successPairs++;
        } catch (e: any) {
          failedPairs++;
          if (errorSamples.length < 50) errorSamples.push({ pair: `${baseline}-${target}`, status: e?.response?.status, message: e?.message || String(e) });
        }
      });
      summary.results.push({ phase: ph, successPairs, failedPairs, skippedExisting, writtenDays, errorSamples });
    }

    res.status(200).json(summary);
  } catch (e: any) {
    logger.error('recomputeRegisteredBackfill_failed', { message: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'internal_error' });
  }
});

/**
 * Callable: diagnosePairDays
 * Diagnose why specific pair-days are missing (gray cells) and optionally repair by writing
 * only truly missing RS entries. No synthetic data is produced.
 *
 * Params:
 *  - baseline: string (required)
 *  - symbols: string[] (required)
 *  - phase?: RsPhase PRE|POST (default POST)
 *  - from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' OR yearsBack?: number OR dates?: string[] (YYYY-MM-DD)
 *  - autoFix?: boolean (default false) → if true, writes only computed-but-missing days
 */
export const diagnosePairDays = onCall({ region: 'us-central1', timeoutSeconds: 540 }, async (req) => {
  try {
    const baseline = String(req.data?.baseline || '').trim().toUpperCase();
    const symbols: string[] = Array.isArray(req.data?.symbols) ? req.data.symbols.map((s: any) => String(s).toUpperCase()) : [];
    const phase: RsPhase = (String(req.data?.phase || RsPhase.POST).toLowerCase() === RsPhase.PRE) ? RsPhase.PRE : RsPhase.POST;
    const from: string | undefined = req.data?.from ? String(req.data.from) : undefined;
    const to: string | undefined = req.data?.to ? String(req.data.to) : undefined;
    const yearsBack: number | undefined = Number.isFinite(req.data?.yearsBack) ? Number(req.data.yearsBack) : undefined;
    const datesArg: string[] = Array.isArray(req.data?.dates) ? req.data.dates.map((d: any) => String(d)) : [];
    const autoFix: boolean = !!req.data?.autoFix;

    if (!baseline || symbols.length === 0) {
      return { ok: false, error: 'missing_baseline_or_symbols' };
    }

    const results: any[] = [];

    // Helper to normalize day string
    const dayStr = (t: number | string | undefined): string | undefined => {
      if (typeof t === 'number' && Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
      if (typeof t === 'string' && t.length >= 10) return t.slice(0, 10);
      return undefined;
    };

    for (const target of symbols) {
      try {
        // Fetch bars for explicit window (or a modest default if none provided)
        const rangeOpts = {
          from,
          to,
          yearsBack,
          days: (!from && !to && !yearsBack && datesArg.length === 0) ? 40 : undefined,
          limit: (!from && !to && !yearsBack && datesArg.length === 0) ? 60 : undefined,
          interval: FIXED_INTERVAL,
        } as const;
        const [baseBars, targetBars] = await Promise.all([
          fetchDailyBarsRange(baseline, rangeOpts),
          fetchDailyBarsRange(target, rangeOpts),
        ]);

        // Build quick lookup of bars by day
        const baseDays = new Set<string>();
        const targDays = new Set<string>();
        for (const b of baseBars) { const d = dayStr((b as any).d || (b as any).t); if (d) baseDays.add(d); }
        for (const b of targetBars) { const d = dayStr((b as any).d || (b as any).t); if (d) targDays.add(d); }

        // Compute series for the window, then index by day
        const series = buildPhaseSeries(baseBars, targetBars, phase, baseline, target, logger);
        const computedDays = new Set<string>(series.map((p) => p.day));

        // Read existing stored phase days
        const pairId = `${baseline}-${target}`;
        const snap = await db.collection('pairs-data').doc(pairId).get();
        const dataArr: any[] = snap.exists && Array.isArray((snap.data() as any)?.data) ? (snap.data() as any).data : [];
        const storedDays = new Set<string>();
        for (const row of dataArr) {
          const d = String(row?.day || '');
          if (!d) continue;
          if (phase === RsPhase.POST && row?.post?.rs !== undefined) storedDays.add(d);
          if (phase === RsPhase.PRE && row?.pre?.rs !== undefined) storedDays.add(d);
        }

        // Establish candidate days to check
        const candidateDays = new Set<string>();
        if (datesArg.length > 0) {
          for (const d of datesArg) candidateDays.add(String(d).slice(0, 10));
        } else {
          // union of base and target bar days for the window
          for (const d of baseDays) candidateDays.add(d);
          for (const d of targDays) candidateDays.add(d);
        }

        // Classify per day
        const problems: Array<{ day: string; reason: string } > = [];
        const computedNotStored: string[] = [];
        let present = 0;
        for (const d of Array.from(candidateDays).sort()) {
          const hasBase = baseDays.has(d);
          const hasTarg = targDays.has(d);
          const isComputed = computedDays.has(d);
          const isStored = storedDays.has(d);

          if (isStored) { present++; continue; }
          if (!hasBase && !hasTarg) { problems.push({ day: d, reason: 'no_bars_both' }); continue; }
          if (!hasBase) { problems.push({ day: d, reason: 'missing_base_bar' }); continue; }
          if (!hasTarg) { problems.push({ day: d, reason: 'missing_target_bar' }); continue; }
          if (hasBase && hasTarg && !isComputed) { problems.push({ day: d, reason: 'compute_skipped' }); continue; }
          if (isComputed && !isStored) { problems.push({ day: d, reason: 'computed_but_not_stored' }); computedNotStored.push(d); continue; }
        }

        // Optionally repair: write only missing computed days
        let writtenDays = 0;
        if (autoFix && computedNotStored.length > 0) {
          const entries = series.filter((p) => computedNotStored.includes(p.day));
          if (entries.length > 0) {
            await writeUnifiedSeries(baseline, target, phase, entries, baseBars, targetBars);
            writtenDays = entries.length;
          }
        }

        results.push({
          pair: pairId,
          phase,
          window: { from: from ?? null, to: to ?? null, yearsBack: yearsBack ?? null },
          counts: {
            candidateDays: candidateDays.size,
            storedDays: storedDays.size,
            computedDays: computedDays.size,
            present,
            problems: problems.length,
            writtenDays,
          },
          problems,
        });
      } catch (e: any) {
        results.push({ pair: `${baseline}-${target}`, error: e?.message || String(e) });
      }
    }

    return { ok: true, results };
  } catch (e: any) {
    logger.error('diagnosePairDays_failed', { message: e?.message });
    return { ok: false, error: e?.message || 'internal_error' };
  }
});

/**
 * HTTP (admin): diagnosePairDaysAdmin
 * Same diagnostic as diagnosePairDays, but invokable via HTTP and protected by ADMIN_BACKFILL_TOKEN.
 */
export const diagnosePairDaysAdmin = onRequest({ region: 'us-central1', timeoutSeconds: 540 }, async (req, res) => {
  const token = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
  const expected = (process.env.ADMIN_BACKFILL_TOKEN || '').trim();
  if (!expected || token !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  try {
    const baseline = String((req.body?.baseline ?? req.query.baseline) || '').trim().toUpperCase();
    const symbolsRaw = (req.body?.symbols ?? req.query.symbols) as any;
    const symbols: string[] = Array.isArray(symbolsRaw)
      ? symbolsRaw.map((s: any) => String(s).toUpperCase())
      : String(symbolsRaw || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const phase: RsPhase = (String((req.body?.phase ?? req.query.phase) || RsPhase.POST).toLowerCase() === RsPhase.PRE) ? RsPhase.PRE : RsPhase.POST;
    const from: string | undefined = (req.body?.from ?? req.query.from) as string | undefined;
    const to: string | undefined = (req.body?.to ?? req.query.to) as string | undefined;
    const yearsBack: number | undefined = (req.body?.yearsBack ?? req.query.yearsBack) !== undefined ? Number(req.body?.yearsBack ?? req.query.yearsBack) : undefined;
    const datesArgRaw = (req.body?.dates ?? req.query.dates) as any;
    const datesArg: string[] = Array.isArray(datesArgRaw)
      ? datesArgRaw.map((d: any) => String(d))
      : String(datesArgRaw || '').split(',').map((d) => d.trim()).filter(Boolean);
    const autoFix: boolean = String((req.body?.autoFix ?? req.query.autoFix ?? '')).toLowerCase() === 'true';

    if (!baseline || symbols.length === 0) {
      res.status(400).json({ ok: false, error: 'missing_baseline_or_symbols' });
      return;
    }

    const callRes = await diagnosePairDays.run({
      data: { baseline, symbols, phase, from, to, yearsBack, dates: datesArg, autoFix },
      auth: undefined,
      instanceIdToken: undefined,
      rawRequest: undefined as any,
    } as any);

    res.status(200).json(callRes);
  } catch (e: any) {
    logger.error('diagnosePairDaysAdmin_failed', { message: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'internal_error' });
  }
});