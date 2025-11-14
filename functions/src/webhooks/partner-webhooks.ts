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
import { admin, db, FieldValue } from '../firebase-admin-init';
import { fetchDailyBarsRaw } from './symbol-fetch';
import { buildPhaseSeries } from './rs-series';
import { writeUnifiedSeries } from './pairs-writer';
import { rebuildSignalsDailyMirrorImpl } from '../rs-signal-history.callables';
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
  POSITIONS_COLLECTION,
  PAIRS_COLLECTION,
  SIGNALS_DAILY_COLLECTION,
  APP_COLLECTION,
  REFRESH_STATUS_DOC,
} from './webhooks-config';
import { upsertPairSignalsDaily, upsertRootPosition } from './hot-archive';
import { RsPhase } from '../types/partner';
import { RsPositionStatus } from '../types/rs-signal-history';
import { persistWarning } from '../logging/warn';

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
export async function forEachWithConcurrency<T>(items: T[], limit: number, worker: (t: T, idx: number) => Promise<void>): Promise<void> {
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

function toTimestampOrUndefined(v: any): admin.firestore.Timestamp | undefined {
  try {
    if (!v) return undefined;
    if (typeof v?.toDate === 'function') return v as admin.firestore.Timestamp;
    const d = new Date(v);
    if (!isNaN(d.getTime())) return admin.firestore.Timestamp.fromDate(d);
  } catch {}
  return undefined;
}

async function upsertRefreshStatus(patch: { runStatus?: string; endTimeUTC?: any; nextRefreshAtUTC?: any }): Promise<void> {
  await db.collection(APP_COLLECTION).doc(REFRESH_STATUS_DOC).set(patch as Record<string, any>, { merge: true });
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
export async function processPairLive(
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

    // Update OPEN positions' current snapshot using the computed latest series point (PRE and POST)
    try {
      const latest = series[series.length - 1];
      const latestDay = latest?.day as string | undefined;
      const latestTargetClose = Number(latest?.targetClose);
      if (latestDay && Number.isFinite(latestTargetClose) && latestTargetClose > 0) {
        await updateOpenPositionsForPair(pairId, latestDay, latestTargetClose);
        await upsertDailyHoldsForPair(pairId, latestDay);
        try { await rebuildSignalsDailyMirrorImpl({ day: latestDay, pairs: [pairId] }); } catch {}
      }
      // On POST, also finalize CLOSED positions for latestDay so positions docs have exit Δ/%
      if (phase === RsPhase.POST && latestDay) {
        try {
          await finalizeClosedPositionsForPair(pairId, latestDay);
        } catch (e:any) {
          logger.warn('finalizeClosedPositionsForPair failed', { pairId, latestDay, message: e?.message });
        }
      }
    } catch (e:any) {
      logger.warn('updateOpenPositionsForPair failed', { pairId, message: e?.message });
    }
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
 * Update all OPEN positions for the specified pair with current daily snapshot fields.
 * Uses target close for latestDay and computes side-aware deltas vs entryPrice.
 */
async function updateOpenPositionsForPair(pairId: string, latestDay: string, latestTargetClose: number): Promise<void> {
  const snap = await db.collection(POSITIONS_COLLECTION)
    .where('pair', '==', pairId)
    .where('status', '==', RsPositionStatus.OPEN)
    .get();
  if (snap.empty) return;
  for (const d of snap.docs) {
    const v = d.data() as any;
    const side = String(v?.side || '').toUpperCase(); // 'LONG' | 'SHORT'
    const entryPx = Number(v?.entryPrice);
    if (!Number.isFinite(entryPx)) continue;
    const curPx = Number(latestTargetClose);
    const change = side === 'SHORT' ? Number(entryPx - curPx) : Number(curPx - entryPx);
    const pct = entryPx !== 0 ? Number((change / entryPx) * 100) : undefined;
    const patch = {
      currentPrice: curPx,
      currentChange: change,
      currentPctChange: pct,
      lastUpdateDay: latestDay,
    } as any;
    await upsertRootPosition(d.id, latestDay, RsPositionStatus.OPEN, patch);
  }
  logger.info('updateOpenPositionsForPair committed', { pairId, latestDay, docsUpdated: snap.size });
}

/**
 * Upsert daily holds for a pair for the given day based on currently OPEN positions.
 * Writes pairs-data/{pair}/signals-daily/{day}.holds = [{ positionId, direction }, ...]
 */
async function upsertDailyHoldsForPair(pairId: string, day: string): Promise<void> {
  const snap = await db.collection(POSITIONS_COLLECTION)
    .where('pair', '==', pairId)
    .where('status', '==', RsPositionStatus.OPEN)
    .get();
  const holds: Array<{ positionId: string; direction?: string }> = [];
  for (const d of snap.docs) {
    const v = d.data() as any;
    const id = String(d.id);
    const dir = String(v?.side || '').toUpperCase(); // 'LONG' | 'SHORT'
    if (!id) continue;
    holds.push({ positionId: id, direction: dir });
  }
  await upsertPairSignalsDaily(pairId, day, { holds });
}

/**
 * Finalize CLOSED positions for a pair on a specific day.
 * Reads pairs-data/{pair}/signals-daily/{day}.newCloses and signals/{positionId} for prices,
 * then writes exitPrice/exitDay/exitIso and netPnL/percentReturn to positions/{positionId}.
 */
async function finalizeClosedPositionsForPair(pairId: string, day: string): Promise<void> {
  const dailyRef = db.collection(PAIRS_COLLECTION).doc(pairId).collection(SIGNALS_DAILY_COLLECTION).doc(day);
  const dailySnap = await dailyRef.get();
  if (!dailySnap.exists) return;
  const data = (dailySnap.data() as any) || {};
  const closes: Array<{ positionId: string; direction?: string }> = Array.isArray(data?.newCloses) ? data.newCloses : [];
  if (!closes.length) return;

  let ops = 0;
  for (const c of closes) {
    const id = String((c as any)?.positionId || '').trim();
    if (!id) continue;

    // Read per-position signals doc for precise open/close prices
    const sigRef = db.collection(PAIRS_COLLECTION).doc(pairId).collection('signals').doc(id);
    const sigSnap = await sigRef.get();
    if (!sigSnap.exists) continue;
    const s = (sigSnap.data() as any) || {};
    const opened = (s?.opened || {}) as any;
    const closed = (s?.closed || {}) as any;
    const side = String(s?.direction || (c as any)?.direction || '').toUpperCase();

    const entryPx = Number(opened?.openPrice);
    const exitPx = Number(closed?.closePrice);
    if (!Number.isFinite(entryPx) || !Number.isFinite(exitPx)) continue;

    const delta = side === 'SHORT' ? Number(entryPx - exitPx) : Number(exitPx - entryPx);
    const pct = entryPx !== 0 ? Number(((delta / entryPx) * 100).toFixed(6)) : 0;

    const patch = {
      exitPrice: exitPx,
      exitDay: day,
      exitIso: new Date(day + 'T00:00:00Z').toISOString(),
      netPnL: delta,
      percentReturn: pct,
      status: RsPositionStatus.CLOSED,
    } as any;
    await upsertRootPosition(id, day, RsPositionStatus.CLOSED, patch);
    ops++;
  }
  logger.info('finalizeClosedPositionsForPair committed', { pairId, day, docsUpdated: ops });
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
        publishTime: message?.publishTime as string | undefined,
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

      if (!isHeartbeat) {
        // On BEGIN, mark processing and clear next update time so UI shows 'in progress' and hides next
        await upsertRefreshStatus({ runStatus: 'processing', nextRefreshAtUTC: null });
      }

      // Persist phase, trigger, and payload status early for observability
      try {
        const update: Record<string, unknown> = { phase };
        if (trigger) update['trigger'] = trigger;
        if (eventType) update['runType'] = eventType;
        // UI hint: SA may send { status: 'begin' | 'end' }
        if (parsedPayload && typeof parsedPayload.status === 'string') update['payloadStatus'] = String(parsedPayload.status).toLowerCase();
        // Record provided next refresh hint on the event doc for observability (canonical: nextRefreshAt)
        const nr = (parsedPayload as any)?.nextRefreshAt;
        if (nr) update['nextRefreshAt'] = String(nr);
        else if ((parsedPayload as any)?.nextFetchAt) {
          // Temporary advisory: legacy field seen but ignored for canonical write
          logger.warn('nextFetchAt provided without nextRefreshAt; ignoring legacy field');
        }
        await eventRef.set(update, { merge: true });
      } catch {}

      // Manual runId handling: ignore any run whose id contains 'manual'
      try {
        const isManual = !isHeartbeat && typeof effectiveRunId === 'string' && effectiveRunId.toLowerCase().includes('manual');
        if (isManual) {
          logger.info('processDataReadyRunV2 skipped manual run', { runId: effectiveRunId });
          try { await persistWarning('skipped_manual_run', { function: RsCloudFunctionName.PROCESS_DATA_READY, runId: effectiveRunId, eventType }); } catch {}
          if (eventRef) {
            await eventRef.set({ status: 'skipped_manual_run', runId: effectiveRunId, phase, trigger, eventType, endTime: FieldValue.serverTimestamp() }, { merge: true });
          }
          return;
        }
      } catch {}

      // Checkpoint early-exit for POST only: if day already completed, record a report and skip work
      try {
        if (!isHeartbeat && phase === RsPhase.POST) {
          // Prefer payload-provided marketDate; fallback left for later derivation if needed
          const payloadMarketDate = (parsedPayload as any)?.marketDate as string | undefined;
          if (payloadMarketDate) {
            const cpRef = db.collection(APP_COLLECTION).doc('rs-checkpoints').collection('days').doc(payloadMarketDate);
            const cpSnap = await cpRef.get();
            if (cpSnap.exists && (cpSnap.data() as any)?.completed === true) {
              logger.info('processDataReadyRunV2 skipped due to checkpoint', { marketDate: payloadMarketDate, runId: effectiveRunId });
              try { await persistWarning('skipped_due_to_checkpoint', { function: RsCloudFunctionName.PROCESS_DATA_READY, runId: effectiveRunId, marketDate: payloadMarketDate, eventType }); } catch {}
              if (eventRef) {
                await eventRef.set({ status: 'skipped_due_to_checkpoint', marketDate: payloadMarketDate, runId: effectiveRunId, phase, trigger, eventType, endTime: FieldValue.serverTimestamp() }, { merge: true });
              }
              // Maintain header consistency: mark as completed and clear nextRefreshAtUTC (avoid stale value)
              await upsertRefreshStatus({ runStatus: 'completed', endTimeUTC: FieldValue.serverTimestamp(), nextRefreshAtUTC: null });
              return;
            }
          }
        }
      } catch {}

      // Load registered pairs
      const pairs = await listRegisteredPairs();
      if (pairs.length === 0) {
        logger.info('processDataReadyRunV2 no registered pairs');
        if (eventRef) {
          await eventRef.set({ status: 'completed', endTime: FieldValue.serverTimestamp(), pairsProcessed: 0, pairsFailed: 0 }, { merge: true });
        }
        try { await persistWarning('no_registered_pairs', { function: RsCloudFunctionName.PROCESS_DATA_READY, runId: effectiveRunId, eventType }); } catch {}
        if (!isHeartbeat) {
          const nextSrc: any = (parsedPayload as any)?.nextRefreshAt;
          const nextTs = toTimestampOrUndefined(nextSrc);
          await upsertRefreshStatus({ runStatus: 'completed', endTimeUTC: FieldValue.serverTimestamp(), ...(nextTs ? { nextRefreshAtUTC: nextTs } : { nextRefreshAtUTC: null }) });
        }
        return;
      }

      const days = FIXED_DAYS;

      // Track summary
      const counters = { successPairs: 0, failedPairs: 0, errorSamples: [] as ProcessErrorSample[] };
      logger.info('processDataReadyRunV2 starting pair processing', { count: pairs.length, phase, eventType, runId: effectiveRunId });
      const PAIR_CONCURRENCY = Number(process.env.PARTNER_PAIR_CONCURRENCY) || 3;
      const baselineBarsCache = new Map<string, any[]>();
      await forEachWithConcurrency(pairs, PAIR_CONCURRENCY, async ({ baseline, target }) => {
        await processPairLive(baseline, target, phase, days, counters, { baselineBars: baselineBarsCache }, { runId: effectiveRunId, eventType, trigger });
      });

      if (eventRef) {
        const finalStatus = counters.failedPairs > 0 ? 'completed_with_errors' : 'completed';
        await eventRef.set({
          status: finalStatus,
          endTime: FieldValue.serverTimestamp(),
          pairsProcessed: counters.successPairs,
          pairsFailed: counters.failedPairs,
          intervalUsed: FIXED_INTERVAL,
          window: FIXED_LIMIT,
          phase,
          ...(trigger ? { trigger } : {}),
          runType: eventType,
          errorSamples: counters.errorSamples,
          // Persist SA-provided nextRefreshAt if available so FE can avoid computing
          ...(() => {
            const nr = (parsedPayload as any)?.nextRefreshAt;
            return nr ? { nextRefreshAt: String(nr) } : {};
          })(),
          // Persist optional marketDate/counts/timing/remainingSymbols for observability when provided
          ...(() => {
            const md = (parsedPayload as any)?.marketDate as string | undefined;
            const counts = (parsedPayload as any)?.counts as any | undefined;
            const timing = (parsedPayload as any)?.timing as any | undefined;
            const rem = (parsedPayload as any)?.remainingSymbols as any[] | undefined;
            const sample = Array.isArray(rem) ? rem.slice(0, 20) : undefined;
            const patch: Record<string, any> = {};
            if (md) patch.marketDate = md;
            if (counts) patch.counts = counts;
            if (timing && timing.finalizedAtUTC) patch['timing'] = { finalizedAtUTC: timing.finalizedAtUTC };
            if (sample) patch.remainingSymbols = sample;
            return patch;
          })(),
        }, { merge: true });
      }
      if (!isHeartbeat) {
        const nextSrc: any = (parsedPayload as any)?.nextRefreshAt;
        const nextTs = toTimestampOrUndefined(nextSrc);
        await upsertRefreshStatus({ runStatus: 'completed', endTimeUTC: FieldValue.serverTimestamp(), ...(nextTs ? { nextRefreshAtUTC: nextTs } : { nextRefreshAtUTC: null }) });
      }

      // Conservative checkpoint write for POST only when partner indicates full finalization and our run had no failures
      try {
        if (!isHeartbeat && phase === RsPhase.POST) {
          const md = (parsedPayload as any)?.marketDate as string | undefined;
          const counts = (parsedPayload as any)?.counts as any | undefined;
          const timing = (parsedPayload as any)?.timing as any | undefined;
          const pendingZero = typeof counts?.pendingCount === 'number' ? counts.pendingCount === 0 : false;
          const finalizedSeen = !!timing?.finalizedAtUTC;
          const allOk = counters.failedPairs === 0 && pairs.length === (counters.successPairs + counters.failedPairs);
          if (md && finalizedSeen && pendingZero && allOk) {
            const cpRef = db.collection(APP_COLLECTION).doc('rs-checkpoints').collection('days').doc(md);
            await cpRef.set({ completed: true, runId: effectiveRunId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
            logger.info('processDataReadyRunV2 checkpoint written', { marketDate: md, runId: effectiveRunId });
          } else {
            logger.info('processDataReadyRunV2 checkpoint not written (criteria not met)', { marketDate: md, finalizedSeen, pendingZero, failedPairs: counters.failedPairs });
          }
        }
      } catch {}
    } else if (!isHeartbeat) {
      // No runId and not a heartbeat: do not proceed
      logger.info('processDataReadyRunV2 missing runId and not a heartbeat; skipping');
      return;
    }
  }
);
