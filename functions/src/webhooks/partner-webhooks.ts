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
import { detectRsEvents } from './rs-signals-engine';
import { applyRsEventsForPair, type RsWriteEvent } from './rs-events-consumer';
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
  APP_COLLECTION,
  REFRESH_STATUS_DOC,
  RS_OPEN_LONG_THRESHOLD,
  RS_CLOSE_LONG_THRESHOLD,
  RS_OPEN_SHORT_THRESHOLD,
  RS_CLOSE_SHORT_THRESHOLD,
  POSITIONS_COLLECTION,
  OPEN_BUCKET_ID,
  ITEMS_SUBCOLLECTION,
  RsEventKind,
  type RsSample,
  type RsThresholds,
} from './webhooks-config';
import { updateOpenPositionsForPair, upsertDailyHoldsForPair, finalizeClosedPositionsForPair, appendOpenPositionsTimelineForPair } from './positions-manager';
import { RsDirection } from '../types/signal.types';
import { RsPhase } from '../types/partner';
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

// Compute the timezone offset (in minutes) between UTC and a given IANA zone at a specific UTC date.
function getTzOffsetMinutesAt(utcDate: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  } as any);
  const parts = fmt.formatToParts(utcDate);
  const val = (t: string) => Number(parts.find((p) => p.type === t)?.value || '0');
  const y = val('year');
  const m = val('month');
  const d = val('day');
  const hh = val('hour');
  const mm = val('minute');
  const ss = val('second');
  const localAsUTC = Date.UTC(y, m - 1, d, hh, mm, ss);
  const diffMs = localAsUTC - utcDate.getTime();
  return Math.round(diffMs / 60000);
}

// Parse partner-provided local ET strings like '2025-11-19T16:30 ET' into a Firestore Timestamp.
function parseEtLocalStringToTimestamp(s: string): admin.firestore.Timestamp | undefined {
  try {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})\s*ET$/i);
    if (!m) return undefined;
    const y = Number(m[1]);
    const mon = Number(m[2]);
    const d = Number(m[3]);
    const hh = Number(m[4]);
    const mm = Number(m[5]);
    const utcGuess = new Date(Date.UTC(y, mon - 1, d, hh, mm, 0));
    const etOffsetMin = getTzOffsetMinutesAt(utcGuess, 'America/New_York');
    const etAsUtc = new Date(utcGuess.getTime() + etOffsetMin * 60_000);
    return admin.firestore.Timestamp.fromDate(etAsUtc);
  } catch {
    return undefined;
  }
}

function toTimestampOrUndefined(v: any): admin.firestore.Timestamp | undefined {
  try {
    if (!v) return undefined;
    if (typeof v?.toDate === 'function') return v as admin.firestore.Timestamp;

    if (typeof v === 'string') {
      const etTs = parseEtLocalStringToTimestamp(v);
      if (etTs) return etTs;
    }

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
      const latestDay = String(latest?.day || '').trim();
      const latestTargetClose = Number(latest?.targetClose);
      const latestRs = Number((latest as any)?.rs);

      if (!latestDay || !/\d{4}-\d{2}-\d{2}/.test(latestDay)) {
        throw new Error(`latestDay missing/invalid for pair=${pairId}`);
      }
      if (!Number.isFinite(latestTargetClose) || latestTargetClose <= 0) {
        throw new Error(`latestTargetClose missing/invalid for pair=${pairId} day=${latestDay}`);
      }
      if (!Number.isFinite(latestRs)) {
        throw new Error(`latest RS missing/invalid for pair=${pairId} day=${latestDay}`);
      }

      await updateOpenPositionsForPair(pairId, latestDay, latestTargetClose, latestRs);
      // On POST, detect OPEN/CLOSE signals using RS engine and write canonical opens + positions
      if (phase === RsPhase.POST && series.length >= 2) {
        const prev = series[series.length - 2] as any;
        const rsYesterday = Number(prev?.rs);
        if (Number.isFinite(rsYesterday) && Number.isFinite(latestRs)) {
          const samples: RsSample[] = [
            {
              day: String(prev?.day || '').trim(),
              rsNorm: rsYesterday,
              rsRaw: Number((prev as any)?.rsRaw ?? rsYesterday),
            },
            {
              day: latestDay,
              rsNorm: latestRs,
              rsRaw: Number((latest as any)?.rsRaw ?? latestRs),
            },
          ];

          const thresholds: RsThresholds = {
            openLong: RS_OPEN_LONG_THRESHOLD,
            closeLong: RS_CLOSE_LONG_THRESHOLD,
            openShort: RS_OPEN_SHORT_THRESHOLD,
            closeShort: RS_CLOSE_SHORT_THRESHOLD,
          };

          const events = detectRsEvents(samples, thresholds);
          const latestEvents = events.filter((e) => e.day === latestDay);
          const openEvent = latestEvents.find((e) => e.kind === RsEventKind.OPEN);
          const closeEvent = latestEvents.find((e) => e.kind === RsEventKind.CLOSE);

          const openDir = openEvent?.direction;
          if (openDir === RsDirection.LONG || openDir === RsDirection.SHORT) {
            const d = new Date(`${latestDay}T00:00:00Z`);
            const openWrite: RsWriteEvent = {
              kind: 'OPEN',
              pair: pairId,
              baseline,
              symbol: target,
              day: latestDay,
              timestamp: d.getTime(),
              direction: openDir,
              rsYesterday,
              rsToday: latestRs,
              price: latestTargetClose,
            };
            try {
              await applyRsEventsForPair([openWrite]);
            } catch (e: any) {
              logger.warn('live_open_signal_failed', { pairId, baseline, target, latestDay, message: e?.message });
            }
          }

          // Detect CLOSE signals and finalize existing positions
          const closeDir = closeEvent?.direction;
          if (closeDir === RsDirection.LONG || closeDir === RsDirection.SHORT) {
            try {
              // Find the currently open position for this pair/direction
              const openSnap = await db
                .collection(POSITIONS_COLLECTION).doc(OPEN_BUCKET_ID)
                .collection(ITEMS_SUBCOLLECTION)
                .where('pair', '==', pairId)
                .where('direction', '==', closeDir)
                .limit(1)
                .get();

              if (!openSnap.empty) {
                const doc = openSnap.docs[0];
                const positionId = doc.id;
                const d = new Date(`${latestDay}T00:00:00Z`);

                const closeWrite: RsWriteEvent = {
                  kind: 'CLOSE',
                  pair: pairId,
                  baseline,
                  symbol: target,
                  day: latestDay,
                  timestamp: d.getTime(),
                  direction: closeDir,
                  rsYesterday,
                  rsToday: latestRs,
                  price: latestTargetClose,
                  positionId,
                };

                try {
                  await applyRsEventsForPair([closeWrite]);
                } catch (e: any) {
                  logger.warn('live_close_signal_write_failed', { pairId, positionId, latestDay, message: e?.message });
                }
              } else {
                logger.warn('live_close_signal_no_open_position', { pairId, direction: closeDir, latestDay });
              }
            } catch (e: any) {
              logger.warn('live_close_signal_lookup_failed', { pairId, latestDay, message: e?.message });
            }
          }
        }
      }
      // Append timeline updates for all open positions for this pair
      try {
        await appendOpenPositionsTimelineForPair(
          pairId,
          latestDay,
          latestTargetClose,
          latestRs,
          phase === RsPhase.PRE ? 'pre' : 'post',
        );
      } catch {
        // best-effort only; do not fail the run on timeline append issues
      }
      await upsertDailyHoldsForPair(pairId, latestDay);
      try { await rebuildSignalsDailyMirrorImpl({ day: latestDay, pairs: [pairId] }); } catch {}
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

// Moved: updateOpenPositionsForPair, upsertDailyHoldsForPair, finalizeClosedPositionsForPair

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
          // Ensure header reflects a completed state and does not stay stuck in 'processing'
          await upsertRefreshStatus({ runStatus: 'completed', endTimeUTC: FieldValue.serverTimestamp(), nextRefreshAtUTC: null });
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
          await upsertRefreshStatus({
            runStatus: 'completed',
            endTimeUTC: FieldValue.serverTimestamp(),
            ...(nextTs ? { nextRefreshAtUTC: nextTs } : { nextRefreshAtUTC: null }),
          });
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
        await upsertRefreshStatus({
          runStatus: 'completed',
          endTimeUTC: FieldValue.serverTimestamp(),
          ...(nextTs ? { nextRefreshAtUTC: nextTs } : { nextRefreshAtUTC: null }),
        });
      }

      // Immediate post-close verification: diagnose+auto-fix across all registered pairs for last 3 days
      // Orchestrated loop with limited retries/backoff, to converge without a separate daily safety net.
      try {
        if (!isHeartbeat && phase === RsPhase.POST) {
          const md = (parsedPayload as any)?.marketDate as string | undefined;
          // Determine window [fromDay, toDay] covering md and prior 2 days (UTC calendar)
          const toDate = md ? new Date(md + 'T00:00:00Z') : new Date();
          const fromDate = new Date(toDate.getTime() - 2 * 24 * 60 * 60 * 1000);
          const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
          const fromDay = ymd(fromDate);
          const toDay = ymd(toDate);

          const project = (process.env.GCLOUD_PROJECT || ((): string | undefined => {
            try { return JSON.parse(String(process.env.FIREBASE_CONFIG || '{}')).projectId; } catch { return undefined; }
          })()) || 'rel-str';
          const isEmu = String(process.env.FUNCTIONS_EMULATOR || '').toLowerCase() === 'true';
          const baseUrl = isEmu
            ? `http://127.0.0.1:5002/${project}/us-central1`
            : `https://us-central1-${project}.cloudfunctions.net`;
          const adminToken = String(process.env.ADMIN_BACKFILL_TOKEN || '').trim();

          const maxAttempts = Math.max(1, Number(process.env.POST_VERIFY_ATTEMPTS || 2));
          const backoffSecs = Math.max(0, Number(process.env.POST_VERIFY_BACKOFF_SECS || 60));

          let attempt = 0;
          let remaining = Number.POSITIVE_INFINITY;
          let lastDiag: any = undefined;
          let okResp = false;
          for (; attempt < maxAttempts; attempt++) {
            const resp = await fetch(`${baseUrl}/diagnoseRegisteredRangeAdmin`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
              },
              body: JSON.stringify({ phase: RsPhase.POST, from: fromDay, to: toDay, autoFix: true }),
            });
            const txt = await resp.text();
            let diag: any = undefined;
            try { diag = JSON.parse(txt); } catch { diag = { raw: txt }; }
            okResp = resp.ok && diag?.ok !== false;
            lastDiag = diag;

            const results = Array.isArray(diag?.results) ? diag.results : [];
            remaining = results.reduce((acc: number, r: any) => acc + (Number(r?.remainingPairs) || 0), 0);

            logger.info('post_close_verifier_attempt', { attempt: attempt + 1, maxAttempts, fromDay, toDay, remaining });
            if (remaining <= 0) break;
            if (attempt < maxAttempts - 1 && backoffSecs > 0) {
              await new Promise((r) => setTimeout(r, backoffSecs * 1000));
            }
          }

          // Persist explicit warning if unresolved issues remain
          if (remaining > 0) {
            const results = Array.isArray(lastDiag?.results) ? lastDiag.results : [];
            await persistWarning('post_close_verifier_remaining_problems', {
              function: RsCloudFunctionName.PROCESS_DATA_READY,
              marketDate: md || toDay,
              from: fromDay,
              to: toDay,
              baselines: results.length,
              remainingPairs: remaining,
              reasons: results.slice(0, 10).map((r: any) => ({ baseline: r?.baseline, reasons: r?.reasons }))
            });
          }

          // Annotate the partner-event doc with verification summary
          if (eventRef) {
            await eventRef.set({
              postCloseVerify: {
                window: { from: fromDay, to: toDay },
                ok: okResp && remaining <= 0,
                remainingPairs: Math.max(0, remaining || 0),
                attempts: attempt,
              }
            }, { merge: true });
          }
        }
      } catch (e:any) {
        logger.warn('post_close_verifier_failed', { message: e?.message });
        try { await persistWarning('post_close_verifier_failed', { function: RsCloudFunctionName.PROCESS_DATA_READY, message: e?.message }); } catch {}
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
