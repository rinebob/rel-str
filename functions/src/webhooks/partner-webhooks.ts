/**
 * Partner Data-Ready Subscriber and RS Writer
 *
 * Listens to partner "data-ready" Pub/Sub notifications and, for each registered
 * baseline–target pair, fetches recent OHLCV bars and builds phase-aware series
 * (PRE using intraday, POST using EOD). Canonical RS (rsNorm, rsRaw) is computed
 * centrally in writeUnifiedSeries using the 5-day/32-matrix window logic and
 * persisted into pairs-data archives (archive-YYYY, archive-weekly-YYYY,
 * archive-monthly-YYYY). Live readers must treat those archive rsRaw/rsNorm
 * values as the single source of truth for RS, not recompute RS from price
 * ratios.
 *
 * This file currently implements a **symbol-driven** ingestion path
 * (processDataReadyRunV2 + processSymbolsReady). See
 * docs/planning/UNIFIED_INGESTION_ENGINE.md for the target **run-driven**
 * TS_UNIVERSE-based ingestion engine. Future work should add a TS_UNIVERSE
 * subscriber here that delegates to runUnifiedIngestion and gradually retire
 * the symbol-driven pipeline once parity is validated.
 */
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { admin, db, FieldValue } from '../firebase-admin-init';
import { fetchDailyBarsRange, fetchAndCacheSymbolSeries } from './symbol-fetch';
import { buildPhaseSeries } from './rs-series';
import { writeUnifiedSeries } from './pairs-writer';
import { listRegisteredPairs } from './registry';
import { applyRsEventsForPair } from './rs-events-consumer';
import { toKebabRunType, formatPtSegment, computeEventDocId, markProcessing } from './partner-events';
import {
  PARTNER_DATA_READY_TOPIC,
  PARTNER_SYMBOLS_READY_TOPIC,
  EVENTS_COLLECTION,
  FIXED_INTERVAL,
  FIXED_LIMIT,
  FIXED_DAYS,
  USE_SYMBOL_DRIVEN_PIPELINE,
  type ProcessErrorSample,
  RunType,
  RsCloudFunctionName,
  APP_COLLECTION,
  REFRESH_STATUS_DOC,
  RS_OPEN_LONG_THRESHOLD,
  RS_CLOSE_LONG_THRESHOLD,
  RS_OPEN_SHORT_THRESHOLD,
  RS_CLOSE_SHORT_THRESHOLD,
  type PhaseSeriesPoint,
  ARCHIVE_COLLECTION_PREFIX,
  PAIRS_COLLECTION,
  SYMBOL_DATA_COLLECTION,
} from './webhooks-config';
import { updateOpenPositionsForPair, appendOpenPositionsTimelineForPair } from './positions-manager';
import { Interval, RsSource } from '../types/signal.types';
import { upsertSignalsActivityForPair, upsertSignalsActivityRoot } from './signals-activity-writer';
import { runCanonicalRsEngineForPair, type PhaseSeriesPointWithMetrics } from './rs-canonical-engine';
import type { ActivityEvent } from '../types/signal.types';
import { RsPhase } from '../types/partner';
import { persistWarning } from '../logging/warn';

// Firebase Admin and Firestore are initialized in ../firebase-admin-init
// Shared constants and enums have been moved to ./webhooks-config

interface CurrentPricePayload {
  price: number;
  date: string; // 'YYYY-MM-DD'
  time: string; // 'HH:mm'
}

export async function upsertSymbolCurrentPrice(symbol: string, payload: CurrentPricePayload): Promise<void> {
  const symbolId = symbol.trim().toUpperCase();
  const symbolDocRef = db.collection(SYMBOL_DATA_COLLECTION).doc(symbolId);

  await symbolDocRef.set(
    {
      currentPrice: {
        price: payload.price,
        date: payload.date,
        time: payload.time,
      },
    },
    { merge: true },
  );
}

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

async function loadArchiveRsForDay(
  pairId: string,
  day: string,
  phase: RsPhase,
): Promise<{ rsRaw: number; rsNorm: number; prevRsRaw: number; prevRsNorm: number } | undefined> {
  const y = String(day).slice(0, 4);
  const yy = y.slice(2);
  const yymmdd = `${yy}${day.slice(5, 7)}${day.slice(8, 10)}`;

  const archiveCol = `${ARCHIVE_COLLECTION_PREFIX}${y}`;
  const pairRef = db.collection(PAIRS_COLLECTION).doc(pairId).collection(archiveCol);

  // Today
  const todaySnap = await pairRef.doc(yymmdd).get();
  if (!todaySnap.exists) return undefined;
  const todayData = todaySnap.data() as any;
  const todayBranch = phase === RsPhase.PRE ? todayData?.pre : todayData?.post;
  if (!todayBranch) return undefined;
  const rsRaw = Number(todayBranch.rsRaw);
  const rsNorm = Number(todayBranch.rsNorm);
  if (!Number.isFinite(rsRaw) || !Number.isFinite(rsNorm)) return undefined;

  // Previous trading day in the same archive-{YYYY} shard
  const prevQuery = await pairRef
    .where('day', '<', day)
    .orderBy('day', 'desc')
    .limit(1)
    .get();

  if (prevQuery.empty) return undefined;
  const prevData = prevQuery.docs[0].data() as any;
  const prevBranch = phase === RsPhase.PRE ? prevData?.pre : prevData?.post;
  if (!prevBranch) return undefined;

  const prevRsRaw = Number(prevBranch.rsRaw);
  const prevRsNorm = Number(prevBranch.rsNorm);
  if (!Number.isFinite(prevRsRaw) || !Number.isFinite(prevRsNorm)) return undefined;

  return { rsRaw, rsNorm, prevRsRaw, prevRsNorm };
}

/**
 * Resolve runType, isHeartbeat, and runId from message and payload.
 */
function resolveRunContext(message: any, payload: Record<string, any>): {
  runType?: string;
  isHeartbeat: boolean;
  runId?: string;
} {
  const attrs: any = (message?.attributes as any) || {};

  const parseInlineAttrs = (raw: string | undefined): { runType?: string; runId?: string; trigger?: string; heartbeat?: string } => {
    if (!raw || typeof raw !== 'string') return {};
    const out: { runType?: string; runId?: string; trigger?: string; heartbeat?: string } = {};
    const parts = raw.split(/\s+/).filter(Boolean);
    for (const part of parts) {
      const idx = part.indexOf('=');
      if (idx <= 0) continue;
      const key = part.slice(0, idx);
      const value = part.slice(idx + 1);
      if (!value) continue;
      if (key === 'runType') out.runType = value;
      else if (key === 'runId') out.runId = value;
      else if (key === 'trigger') out.trigger = value;
      else if (key === 'heartbeat') out.heartbeat = value;
    }
    return out;
  };

  const inlineFromPhase = parseInlineAttrs(attrs.phase as string | undefined);

  const attrRunType = (attrs.runType as string | undefined) ?? inlineFromPhase.runType;
  const payloadRunType = (payload.runType as string | undefined) ?? (payload.run_type as string | undefined);
  const runType = attrRunType ?? payloadRunType;

  const heartbeatRaw = (attrs.heartbeat as string | undefined) ?? inlineFromPhase.heartbeat;
  const isHeartbeatAttr = (heartbeatRaw || '').toLowerCase() === 'true';
  const isHeartbeat = isHeartbeatAttr || runType === RunType.HEARTBEAT;

  const attrRunId = (attrs.runId as string | undefined) ?? inlineFromPhase.runId;
  const runId = attrRunId ?? (payload.runId as string | undefined) ?? (payload.run_id as string | undefined);

  return { runType, isHeartbeat, runId };
}

function normalizeInterval(raw: any): Interval | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.toUpperCase();
  if (v === Interval.DAILY || v === Interval.WEEKLY || v === Interval.MONTHLY) return v as Interval;
  return undefined;
}

async function runSymbolsReadyCore(
  marketDate: string,
  runId: string | undefined,
  symbols: string[],
  interval: Interval,
): Promise<void> {
  const days = FIXED_DAYS;
  const symbolCount = symbols.length;
  logger.info('==========================================================');
  logger.info(
    `processSymbolsReady_start marketDate=${marketDate} runId=${runId || 'n/a'} symbols=${symbolCount}`,
    { marketDate, runId, symbolCount },
  );

    // Load registered pairs once per message and build a target->baselines map so that
    // when a symbol becomes ready we can compute RS for all pairs where it is the target.
  const registeredPairs = await listRegisteredPairs();
  const targetToBaselines = new Map<string, string[]>();
  for (const { baseline, target } of registeredPairs) {
    const t = String(target || '').trim().toUpperCase();
    const b = String(baseline || '').trim().toUpperCase();
    if (!t || !b) continue;
    const existing = targetToBaselines.get(t) || [];
    existing.push(b);
    targetToBaselines.set(t, existing);
  }

  const SYMBOL_CONCURRENCY = Number(process.env.PARTNER_SYMBOL_CONCURRENCY || 5);

  await forEachWithConcurrency(symbols, Math.max(1, SYMBOL_CONCURRENCY), async (sym) => {
    try {
      logger.info('==========================');
      logger.info(
        `PROCESSING SYMBOL: ${sym} marketDate=${marketDate} runId=${runId || 'n/a'}`,
        { symbol: sym, marketDate, runId },
      );
      logger.info('==========================');

      const cacheDoc = await fetchAndCacheSymbolSeries(marketDate, sym, days, runId, interval as any);

        // Best-effort currentPrice update from latest DAILY bar in cache
      try {
        const dailyBars = cacheDoc.dailyBars || [];
        if (Array.isArray(dailyBars) && dailyBars.length > 0) {
          let lastBar = dailyBars[dailyBars.length - 1] as any;
            // Prefer the last bar with a defined day label if possible
          for (let i = dailyBars.length - 1; i >= 0; i--) {
            const b = dailyBars[i] as any;
            if (b?.d) { lastBar = b; break; }
          }

          const day = String(lastBar?.d || '');
          const ts = Number(lastBar?.t);
          const close = Number(lastBar?.ac ?? lastBar?.c ?? 0);

          if (day && Number.isFinite(ts) && Number.isFinite(close) && close > 0) {
            const iso = new Date(ts).toISOString();
            const date = iso.slice(0, 10);
            const time = iso.slice(11, 16);

            await upsertSymbolCurrentPrice(sym, { price: close, date, time });
          }
        }
      } catch (e: any) {
        logger.warn(
          `processSymbolsReady_current_price_failed symbol=${sym} marketDate=${marketDate} msg=${e?.message || 'unknown'}`,
          {
            symbol: sym,
            marketDate,
            message: e?.message,
          },
        );
      }

        // === Incremental RS computation for pairs where this symbol is the target ===
      const baselines = targetToBaselines.get(sym) || [];
      if (baselines.length === 0) {
        return;
      }

      const dailyTargetBars = interval === Interval.DAILY ? cacheDoc.dailyBars || [] : [];
      const weeklyTargetBars = interval === Interval.WEEKLY ? cacheDoc.weeklyBars || [] : [];
      const monthlyTargetBars = interval === Interval.MONTHLY ? cacheDoc.monthlyBars || [] : [];

      for (const baseline of baselines) {
        try {
          const baselineSnap = await db
            .collection('rs-symbol-cache')
            .doc(marketDate)
            .collection('symbols')
            .doc(baseline)
            .get();

          if (!baselineSnap.exists) {
            logger.warn(
              `processSymbolsReady_missing_baseline_cache baseline=${baseline} target=${sym} marketDate=${marketDate}`,
              { baseline, target: sym, marketDate },
            );
            continue;
          }

          const baselineDoc = baselineSnap.data() as any;
          const dailyBaseBars = (baselineDoc?.dailyBars as any[]) || [];
          const weeklyBaseBars = (baselineDoc?.weeklyBars as any[]) || [];
          const monthlyBaseBars = (baselineDoc?.monthlyBars as any[]) || [];

          if (interval === Interval.DAILY) {
            logger.info(
              `PROCESSING INTERVAL: DAILY baseline=${baseline} target=${sym} marketDate=${marketDate}`,
              { interval: 'DAILY', baseline, target: sym, marketDate },
            );
            try {
              const dailySeries = buildPhaseSeries(dailyBaseBars, dailyTargetBars, RsPhase.POST, baseline, sym, logger);
              if (dailySeries.length > 0) {
                await writeUnifiedSeries(baseline, sym, RsPhase.POST, dailySeries, dailyBaseBars, dailyTargetBars, Interval.DAILY);
              }
            } catch (e: any) {
              logger.warn(
                `processSymbolsReady_daily_rs_failed baseline=${baseline} target=${sym} marketDate=${marketDate} msg=${e?.message || 'unknown'}`,
                { baseline, target: sym, marketDate, message: e?.message },
              );
            }
          }

          if (interval === Interval.WEEKLY) {
            logger.info(
              `PROCESSING INTERVAL: WEEKLY baseline=${baseline} target=${sym} marketDate=${marketDate}`,
              { interval: 'WEEKLY', baseline, target: sym, marketDate },
            );
            try {
              if (weeklyBaseBars.length > 0 && weeklyTargetBars.length > 0) {
                const weeklySeries = buildPhaseSeries(weeklyBaseBars, weeklyTargetBars, RsPhase.POST, baseline, sym, logger);
                if (weeklySeries.length > 0) {
                  const windowToDay = weeklySeries.length > 0
                    ? String(weeklySeries[weeklySeries.length - 1].day).slice(0, 10)
                    : undefined;
                  await writeUnifiedSeries(baseline, sym, RsPhase.POST, weeklySeries, weeklyBaseBars, weeklyTargetBars, Interval.WEEKLY, windowToDay);
                }
              }
            } catch (e: any) {
              logger.warn(
                `processSymbolsReady_weekly_rs_failed baseline=${baseline} target=${sym} marketDate=${marketDate} msg=${e?.message || 'unknown'}`,
                { baseline, target: sym, marketDate, message: e?.message },
              );
            }
          }

          if (interval === Interval.MONTHLY) {
            logger.info(
              `PROCESSING INTERVAL: MONTHLY baseline=${baseline} target=${sym} marketDate=${marketDate}`,
              { interval: 'MONTHLY', baseline, target: sym, marketDate },
            );
            try {
              if (monthlyBaseBars.length > 0 && monthlyTargetBars.length > 0) {
                const monthlySeries = buildPhaseSeries(monthlyBaseBars, monthlyTargetBars, RsPhase.POST, baseline, sym, logger);
                if (monthlySeries.length > 0) {
                  const windowToDay = monthlySeries.length > 0
                    ? String(monthlySeries[monthlySeries.length - 1].day).slice(0, 10)
                    : undefined;
                  await writeUnifiedSeries(baseline, sym, RsPhase.POST, monthlySeries, monthlyBaseBars, monthlyTargetBars, Interval.MONTHLY, windowToDay);
                }
              }
            } catch (e: any) {
              logger.warn(
                `processSymbolsReady_monthly_rs_failed baseline=${baseline} target=${sym} marketDate=${marketDate} msg=${e?.message || 'unknown'}`,
                { baseline, target: sym, marketDate, message: e?.message },
              );
            }
          }
        } catch (e: any) {
          logger.warn(
            `processSymbolsReady_pair_rs_failed baseline=${baseline} target=${sym} marketDate=${marketDate} msg=${e?.message || 'unknown'}`,
            { baseline, target: sym, marketDate, message: e?.message },
          );
        }
      }
    } catch (e: any) {
      logger.warn(
        `processSymbolsReady_symbol_failed symbol=${sym} marketDate=${marketDate} msg=${e?.message || 'unknown'}`,
        {
          symbol: sym,
          marketDate,
          message: e?.message,
        },
      );
    }
  });

  logger.info(
    `processSymbolsReady_done marketDate=${marketDate} runId=${runId || 'n/a'} symbols=${symbolCount}`,
    { marketDate, runId, symbolCount },
  );
  logger.info('==========================================================');
}
/**
 * Partner Symbols-Ready Subscriber (DISABLED)
 *
 * This subscriber previously consumed the partner-symbols-ready topic and drove a
 * symbol-driven RS ingestion pipeline. That path caused sync/ordering issues and
 * we have reverted to the partner-data-ready run-driven pipeline.
 *
 * The handler remains deployed for potential future reuse, but when
 * USE_SYMBOL_DRIVEN_PIPELINE is false it will return early without performing
 * any work. Canonical RS ingestion is now exclusively driven by
 * partner-data-ready messages.
 */
export const processSymbolsReady = onMessagePublished(
  { topic: PARTNER_SYMBOLS_READY_TOPIC, region: 'us-central1' },
  async (event) => {
    const message = event.data.message as any;

    let rawString: string | undefined;
    let payload: any = {};
    if (message?.json && typeof message.json === 'object') {
      payload = message.json;
      try {
        rawString = JSON.stringify(message.json);
      } catch {
        rawString = undefined;
      }
    } else {
      try {
        rawString = typeof message?.data === 'string'
          ? Buffer.from(message.data, 'base64').toString('utf8')
          : '{}';
        payload = JSON.parse(rawString || '{}');
      } catch {
        payload = {};
      }
    }

    const attrs: any = (message?.attributes as any) || {};
    const marketDate: string | undefined =
      (payload.marketDate as string | undefined)
      || (attrs.marketDate as string | undefined);
    const runId: string | undefined =
      (attrs.runId as string | undefined)
      || (payload.runId as string | undefined)
      || (payload.run_id as string | undefined);

    const symbols: string[] = Array.isArray(payload.symbols)
      ? (payload.symbols as any[]).map((s) => String(s).trim().toUpperCase()).filter((s) => !!s)
      : [];

    const reason: string | undefined =
      (payload.reason as string | undefined)
      || (attrs.reason as string | undefined);

    const rawInterval: string | undefined =
      (payload.interval as string | undefined)
      || (attrs.interval as string | undefined);
    const interval = normalizeInterval(rawInterval);

    // When USE_SYMBOL_DRIVEN_PIPELINE is false, keep this subscriber parked and
    // rely solely on the partner-data-ready run-driven pipeline.
    if (!USE_SYMBOL_DRIVEN_PIPELINE) {
      logger.info('processSymbolsReady_disabled_by_use_symbol_driven_pipeline_flag', {
        marketDate: marketDate || 'unknown',
        interval: interval || 'unknown',
        symbols,
        symbolCount: symbols.length,
      });
      return;
    }

    if (symbols.length === 0) {
      logger.error(
        `psr_verbose_received_missing_symbol marketDate=${marketDate || 'unknown'}`,
        {
          marketDate: marketDate || 'unknown',
          reason: reason || 'unknown',
          rawPayload: payload,
          attributes: attrs,
        },
      );
    } else {
      const symbolsStr = symbols.join(',');

      logger.info(
        `psr_verbose_received symbols=${symbolsStr} marketDate=${marketDate || 'unknown'} interval=${interval || 'unknown'}`,
        {
          marketDate: marketDate || 'unknown',
          reason: reason || 'unknown',
          interval: interval || 'unknown',
          symbols,
          symbolCount: symbols.length,
          version: (payload.version as string | undefined) || (attrs.version as string | undefined),
          attributes: attrs,
        },
      );
    }

    if (!interval) {
      logger.warn(
        `processSymbolsReady_invalid_interval interval=${rawInterval || 'missing'} symbols=${symbols.join(',')}`,
        {
          rawInterval,
          marketDate,
          symbolsCount: symbols.length,
          attributes: message?.attributes,
        },
      );
      return;
    }

    if (!marketDate || symbols.length === 0) {
      logger.warn(
        `processSymbolsReady_invalid_payload marketDate=${marketDate || 'missing'} symbolsCount=${symbols.length}`,
        {
          marketDate,
          symbolsCount: symbols.length,
          attributes: message?.attributes,
        },
      );
      return;
    }

    await runSymbolsReadyCore(marketDate, runId, symbols, interval as Interval);
  },
);

export const processSymbolsReadyHttpTest = onRequest({ region: 'us-central1' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Only POST is allowed');
    return;
  }

  const body: any = req.body || {};
  const marketDate = typeof body.marketDate === 'string' ? body.marketDate : undefined;
  const runId = typeof body.runId === 'string' ? body.runId : undefined;
  const rawInterval = typeof body.interval === 'string' ? body.interval : undefined;
  const interval = normalizeInterval(rawInterval);
  const symbolsRaw = Array.isArray(body.symbols) ? body.symbols : [];
  const symbols = symbolsRaw.map((s: any) => String(s).trim().toUpperCase()).filter((s: string) => !!s);

  if (!interval || !marketDate || symbols.length === 0) {
    res.status(400).json({
      error: 'invalid_payload',
      marketDate,
      interval: rawInterval || null,
      symbolsCount: symbols.length,
    });
    return;
  }

  try {
    await runSymbolsReadyCore(marketDate, runId, symbols, interval);
    res.status(200).json({
      ok: true,
      marketDate,
      runId: runId || null,
      symbolsCount: symbols.length,
    });
  } catch (e: any) {
    logger.error('processSymbolsReadyHttpTest_failed', {
      marketDate,
      runId,
      symbolsCount: symbols.length,
      message: e?.message,
    });
    res.status(500).json({
      error: 'internal_error',
      message: e?.message || String(e),
    });
  }
});

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
    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - (Math.max(1, days) - 1) * 24 * 60 * 60 * 1000);
    const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const from = ymd(fromDate);
    const to = ymd(toDate);

    // Baseline-only cache to avoid duplicate upstream fetches within a run
    let baseBars = caches?.baselineBars?.get(baseline);
    if (!baseBars) {
      baseBars = await fetchDailyBarsRange(baseline, { from, to, interval: FIXED_INTERVAL });
      if (caches && caches.baselineBars) caches.baselineBars.set(baseline, baseBars);
    }
    const targetBars = await fetchDailyBarsRange(target, { from, to, interval: FIXED_INTERVAL });
    const series = buildPhaseSeries(baseBars, targetBars, phase, baseline, target, logger);
    if (series.length === 0) {
      accum.failedPairs++;
      if (accum.errorSamples.length < 10) accum.errorSamples.push({ pair: pairId, message: 'no_aligned_series' });
      // Persist a warning for UI visibility (best-effort)
      await persistWarning('no_aligned_series', { function: RsCloudFunctionName.PROCESS_PAIR_LIVE, pairId, baseline, target, phase, runId: ctx?.runId, eventType: ctx?.eventType, trigger: ctx?.trigger });
      return;
    }
    await writeUnifiedSeries(baseline, target, phase, series, baseBars, targetBars, Interval.DAILY);

    // Best-effort: upsert latest target price into symbol-data/{TARGET}.currentPrice
    try {
      if (Array.isArray(targetBars) && targetBars.length > 0) {
        const lastBar = targetBars[targetBars.length - 1] as any;
        const day = String(lastBar?.d || '');
        const ts = Number(lastBar?.t);
        const close = Number(lastBar?.ac ?? lastBar?.c ?? 0);

        if (day && Number.isFinite(ts) && Number.isFinite(close) && close > 0) {
          const iso = new Date(ts).toISOString();
          const date = iso.slice(0, 10); // 'YYYY-MM-DD'
          const time = iso.slice(11, 16); // 'HH:mm'

          await upsertSymbolCurrentPrice(target, {
            price: close,
            date,
            time,
          });
        }
      }
    } catch (e: any) {
      logger.warn('symbol_data_current_price_upsert_failed', {
        target,
        message: e?.message,
      });
    }

    // Weekly and Monthly series: fetch from partner using corresponding intervals.
    // We do this for both PRE and POST to keep intraday updates flowing for all intervals.
    let weeklySeries: PhaseSeriesPoint[] = [];
    let monthlySeries: PhaseSeriesPoint[] = [];

    try {
      const baseWeekly = await fetchDailyBarsRange(baseline, { from, to, interval: Interval.WEEKLY });
      const targetWeekly = await fetchDailyBarsRange(target, { from, to, interval: Interval.WEEKLY });
      weeklySeries = buildPhaseSeries(baseWeekly, targetWeekly, phase, baseline, target, logger);
      if (weeklySeries.length > 0) {
        const windowToDay = series.length > 0 ? String(series[series.length - 1].day).slice(0, 10) : undefined;
        await writeUnifiedSeries(baseline, target, phase, weeklySeries, baseWeekly, targetWeekly, Interval.WEEKLY, windowToDay);
      }
    } catch (e: any) {
      logger.warn('weekly_series_write_failed', { pairId, baseline, target, phase, message: e?.message });
    }

    try {
      const baseMonthly = await fetchDailyBarsRange(baseline, { from, to, interval: Interval.MONTHLY });
      const targetMonthly = await fetchDailyBarsRange(target, { from, to, interval: Interval.MONTHLY });
      monthlySeries = buildPhaseSeries(baseMonthly, targetMonthly, phase, baseline, target, logger);
      if (monthlySeries.length > 0) {
        const windowToDay = series.length > 0 ? String(series[series.length - 1].day).slice(0, 10) : undefined;
        await writeUnifiedSeries(baseline, target, phase, monthlySeries, baseMonthly, targetMonthly, Interval.MONTHLY, windowToDay);
      }
    } catch (e: any) {
      logger.warn('monthly_series_write_failed', { pairId, baseline, target, phase, message: e?.message });
    }

    let engineActivity: ActivityEvent[] = [];
    if (phase === RsPhase.POST) {
      try {
        const dailyDecorated = series as unknown as PhaseSeriesPointWithMetrics[];
        const weeklyDecorated = weeklySeries.length > 0
          ? (weeklySeries as unknown as PhaseSeriesPointWithMetrics[])
          : [];
        const monthlyDecorated = monthlySeries.length > 0
          ? (monthlySeries as unknown as PhaseSeriesPointWithMetrics[])
          : [];
        const engineThresholds = {
          daily: {
            openLong: RS_OPEN_LONG_THRESHOLD,
            closeLong: RS_CLOSE_LONG_THRESHOLD,
            openShort: RS_OPEN_SHORT_THRESHOLD,
            closeShort: RS_CLOSE_SHORT_THRESHOLD,
          },
          weekly: {
            openLong: RS_OPEN_LONG_THRESHOLD,
            closeLong: RS_CLOSE_LONG_THRESHOLD,
            openShort: RS_OPEN_SHORT_THRESHOLD,
            closeShort: RS_CLOSE_SHORT_THRESHOLD,
          },
          monthly: {
            openLong: RS_OPEN_LONG_THRESHOLD,
            closeLong: RS_CLOSE_LONG_THRESHOLD,
            openShort: RS_OPEN_SHORT_THRESHOLD,
            closeShort: RS_CLOSE_SHORT_THRESHOLD,
          },
        };

        const { writes, activity } = await runCanonicalRsEngineForPair(
          pairId,
          baseline,
          target,
          logger,
          {
            daily: dailyDecorated,
            weekly: weeklyDecorated,
            monthly: monthlyDecorated,
          },
          engineThresholds,
        );

        if (writes.length > 0) {
          await applyRsEventsForPair(writes);
        }

        engineActivity = activity;
      } catch (e: any) {
        logger.warn('canonical_engine_daily_failed', { pairId, baseline, target, phase, message: e?.message });
      }
    }

    // Signals Activity (preview, multi-interval) sourced from the canonical engine.
    try {
      const allEvents = phase === RsPhase.POST ? engineActivity : [];

      if (allEvents.length > 0) {
        const latest = series[series.length - 1];
        const latestDay = String(latest?.day || '').trim();

        if (latestDay) {
          await upsertSignalsActivityForPair(pairId, latestDay, allEvents);
          await upsertSignalsActivityRoot(latestDay, allEvents);
        }
      }
    } catch (e: any) {
      logger.warn('signals_activity_write_failed', { pairId, baseline, target, phase, message: e?.message });
    }

    // Update OPEN positions' current snapshot using canonical RS from archive (PRE and POST)
    try {
      const latest = series[series.length - 1];
      const latestDay = String(latest?.day || '').trim();
      const latestTargetClose = Number(latest?.targetClose);

      if (!Number.isFinite(latestTargetClose) || latestTargetClose <= 0) {
        throw new Error(`latest target price missing/invalid for pair=${pairId} day=${latestDay}`);
      }

      if (!latestDay || !/\d{4}-\d{2}-\d{2}/.test(latestDay)) {
        throw new Error(`latestDay missing/invalid for pair=${pairId}`);
      }
      const metrics = await loadArchiveRsForDay(pairId, latestDay, phase);
      if (!metrics || !Number.isFinite(metrics.rsRaw)) {
        throw new Error(`latest canonical RS missing/invalid for pair=${pairId} day=${latestDay} phase=${phase}`);
      }

      await updateOpenPositionsForPair(pairId, latestDay, latestTargetClose, metrics.rsRaw);

      // Realtime timeline update for all open positions in this pair, using canonical
      // rsRaw/rsNorm and previous-day rsRaw/rsNorm from archives so that per-position
      // timelines match canonical/backfill.
      try {
        await appendOpenPositionsTimelineForPair(
          pairId,
          latestDay,
          latestTargetClose,
          metrics.rsRaw,
          metrics.rsNorm,
          metrics.prevRsRaw,
          metrics.prevRsNorm,
          phase === RsPhase.PRE ? RsSource.PRE : RsSource.POST,
        );
      } catch {
        // best-effort only; do not fail the run on timeline append issues
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
      } catch (e: any) {
        logger.error('processDataReadyRunV2_eventDoc_read_failed', { docId: eventDocId, runId: effectiveRunId, message: e?.message });
      }

      try {
        await markProcessing(eventRef, {
          eventType,
          isHeartbeat,
          runId: effectiveRunId,
          messageId,
          publishTime: (message?.publishTime as string | undefined) ?? undefined,
          ptSegment,
        });
        logger.info('processDataReadyRunV2_event_marked_processing', { docId: eventDocId, runId: effectiveRunId });
      } catch (e: any) {
        logger.error('processDataReadyRunV2_markProcessing_failed', { docId: eventDocId, runId: effectiveRunId, message: e?.message });
      }

      if (!isHeartbeat) {
        // On BEGIN, mark processing and clear next update time so UI shows 'in progress' and hides next
        await upsertRefreshStatus({ runStatus: 'processing', nextRefreshAtUTC: null });
      }

      // Persist phase, trigger, payload status, SA-provided counts, and any
      // next-refresh hint for observability. This keeps the partner-events doc
      // aligned with the partner's canonical data-ready contract (runType in
      // attributes; marketDate, status, finalizedCountTotal, pendingCount in
      // the JSON body; optional successes/failures attributes).
      try {
        const update: Record<string, unknown> = { phase };
        if (trigger) update['trigger'] = trigger;
        if (eventType) update['runType'] = eventType;
        // UI hint: SA may send { status: 'begin' | 'end' }
        if (parsedPayload && typeof parsedPayload.status === 'string') update['payloadStatus'] = String(parsedPayload.status).toLowerCase();
        // Mirror marketDate from payload or attributes when present.
        const rawPayload: any = parsedPayload as any;
        const attrs: any = (message?.attributes as any) || {};
        const mdPayload = rawPayload?.marketDate as string | undefined;
        const mdAttr = attrs?.marketDate as string | undefined;
        if (mdPayload || mdAttr) {
          update['marketDate'] = mdPayload || mdAttr;
        }

        // Persist upstream counts when provided. These are informational and
        // do not affect RS logic.
        const finalizedCountTotal = typeof rawPayload?.finalizedCountTotal === 'number'
          ? rawPayload.finalizedCountTotal
          : undefined;
        const pendingCount = typeof rawPayload?.pendingCount === 'number'
          ? rawPayload.pendingCount
          : undefined;
        const successesAttr = attrs?.successes as string | undefined;
        const failuresAttr = attrs?.failures as string | undefined;
        if (typeof finalizedCountTotal === 'number') update['finalizedCountTotal'] = finalizedCountTotal;
        if (typeof pendingCount === 'number') update['pendingCount'] = pendingCount;
        if (successesAttr !== undefined) {
          const n = Number(successesAttr);
          if (Number.isFinite(n)) update['upstreamSuccesses'] = n;
        }
        if (failuresAttr !== undefined) {
          const n = Number(failuresAttr);
          if (Number.isFinite(n)) update['upstreamFailures'] = n;
        }

        // Record provided next refresh hint on the event doc for observability.
        const nr = rawPayload?.nextRefreshAt
          ?? rawPayload?.nextRefreshAtUTC
          ?? rawPayload?.NextRefreshAt
          ?? attrs?.NextRefreshAt
          ?? attrs?.nextRefreshAtUTC
          ?? attrs?.nextRefreshAt;
        if (nr) {
          update['nextRefreshAt'] = String(nr);
        }
        await eventRef.set(update, { merge: true });
      } catch {}

      // Explicit test run handling: ignore runs whose trigger is 'test' (case-insensitive).
      // This replaces the older heuristic that skipped any runId containing
      // 'manual', so that legitimate manual runs are fully processed while
      // dedicated plumbing tests can still be sent without triggering RS work.
      try {
        const isTestRun = !isHeartbeat && typeof trigger === 'string' && trigger.toLowerCase() === 'test';
        if (isTestRun) {
          logger.info('processDataReadyRunV2 skipped test run', { runId: effectiveRunId, trigger, eventType: eventTypeRaw });
          try {
            await persistWarning('skipped_test_run', {
              function: RsCloudFunctionName.PROCESS_DATA_READY,
              runId: effectiveRunId,
              eventType: eventTypeRaw,
              trigger,
            });
          } catch {}
          if (eventRef) {
            try {
              await eventRef.set({
                status: 'skipped_test_run',
                runId: effectiveRunId,
                phase,
                trigger,
                eventType,
                endTime: FieldValue.serverTimestamp(),
              }, { merge: true });
              logger.info('processDataReadyRunV2_event_marked_skipped_test_run', { docId: eventDocId, runId: effectiveRunId, trigger });
            } catch (e: any) {
              logger.error('processDataReadyRunV2_event_set_skipped_test_run_failed', { docId: eventDocId, runId: effectiveRunId, message: e?.message });
            }
          } else {
            logger.error('processDataReadyRunV2_eventRef_missing_for_test_run', { runId: effectiveRunId, trigger });
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

      // If symbol-driven pipeline is enabled, treat this handler as a
      // lightweight finalizer and skip the heavy pair-centric fetch loop.
      if (USE_SYMBOL_DRIVEN_PIPELINE) {
        const preview = typeof rawString === 'string' ? rawString.slice(0, 200) : undefined;
        logger.info(
          `processDataReadyRunV2 symbol-driven finalizer enabled; skipping pair fetch loop runId=${effectiveRunId || 'n/a'} phase=${phase} eventType=${eventType}`,
          {
            runId: effectiveRunId,
            phase,
            eventType,
            payloadPreview: preview,
          },
        );

        if (eventRef) {
          await eventRef.set({
            status: 'completed',
            endTime: FieldValue.serverTimestamp(),
            pairsProcessed: 0,
            pairsFailed: 0,
            phase,
            ...(trigger ? { trigger } : {}),
            runType: eventType,
          }, { merge: true });
        }

        if (!isHeartbeat) {
          const rawPayload: any = parsedPayload as any;
          const attrs: any = (message?.attributes as any) || {};
          const nextSrc: any = rawPayload?.nextRefreshAt
            ?? rawPayload?.nextRefreshAtUTC
            ?? rawPayload?.NextRefreshAt
            ?? attrs?.NextRefreshAt
            ?? attrs?.nextRefreshAtUTC
            ?? attrs?.nextRefreshAt;
          const nextTs = toTimestampOrUndefined(nextSrc);
          await upsertRefreshStatus({
            runStatus: 'completed',
            endTimeUTC: FieldValue.serverTimestamp(),
            ...(nextTs ? { nextRefreshAtUTC: nextTs } : { nextRefreshAtUTC: null }),
          });
        }
        return;
      }

      // Load registered pairs
      const pairs = await listRegisteredPairs();
      if (pairs.length === 0) {
        logger.info('processDataReadyRunV2 no registered pairs');
        if (eventRef) {
          await eventRef.set({ status: 'completed', endTime: FieldValue.serverTimestamp(), pairsProcessed: 0, pairsFailed: 0 }, { merge: true });
        }
        try { await persistWarning('no_registered_pairs', { function: RsCloudFunctionName.PROCESS_DATA_READY, runId: effectiveRunId, eventType }); } catch {}
        if (!isHeartbeat) {
          const rawPayload: any = parsedPayload as any;
          const attrs: any = (message?.attributes as any) || {};
          const nextSrc: any = rawPayload?.nextRefreshAt
            ?? rawPayload?.nextRefreshAtUTC
            ?? rawPayload?.NextRefreshAt
            ?? attrs?.NextRefreshAt
            ?? attrs?.nextRefreshAtUTC
            ?? attrs?.nextRefreshAt;
          const nextTs = toTimestampOrUndefined(nextSrc);
          await upsertRefreshStatus({
            runStatus: 'completed',
            endTimeUTC: FieldValue.serverTimestamp(),
            ...(nextTs ? { nextRefreshAtUTC: nextTs } : { nextRefreshAtUTC: null }),
          });
        }
        return;
      }

      // Optional debug filter: when DEBUG_PAIR_ID is set, restrict processing to that pair only.
      const debugPairIdRaw = String(process.env.DEBUG_PAIR_ID || '').trim().toUpperCase();
      const effectivePairs = debugPairIdRaw
        ? (() => {
            const filtered = pairs.filter((p) => `${p.baseline}-${p.target}`.toUpperCase() === debugPairIdRaw);
            return filtered.length > 0 ? filtered : pairs;
          })()
        : pairs;

      const days = FIXED_DAYS;

      // Track summary
      const counters = { successPairs: 0, failedPairs: 0, errorSamples: [] as ProcessErrorSample[] };

      // Persist high-level run metadata on the partner-events doc so that
      // realtime runs mirror the backfill run summary shape (pairCount,
      // intervals, expectedJobs, etc.). We always process DAILY/WEEKLY/MONTHLY
      // via processPairLive in this path, so intervals is fixed here.
      const runIntervals: string[] = ['DAILY', 'WEEKLY', 'MONTHLY'];
      if (eventRef && effectiveRunId) {
        try {
          await eventRef.set({
            runId: effectiveRunId,
            phase,
            pairCount: pairs.length,
            intervals: runIntervals,
            expectedJobs: pairs.length * runIntervals.length,
            updatedAt: FieldValue.serverTimestamp(),
          } as Record<string, unknown>, { merge: true });
        } catch {}
      }
      logger.info('processDataReadyRunV2 starting pair processing', { count: effectivePairs.length, totalRegistered: pairs.length, phase, eventType, runId: effectiveRunId, debugPairId: debugPairIdRaw || null });
      const PAIR_CONCURRENCY = Number(process.env.PARTNER_PAIR_CONCURRENCY) || 3;
      const baselineBarsCache = new Map<string, any[]>();
      await forEachWithConcurrency(effectivePairs, PAIR_CONCURRENCY, async ({ baseline, target }) => {
        const beforeSuccess = counters.successPairs;
        const beforeFailed = counters.failedPairs;

        await processPairLive(baseline, target, phase, days, counters, { baselineBars: baselineBarsCache }, { runId: effectiveRunId, eventType, trigger });

        // Best-effort live progress update on the partner-events doc so that
        // successJobs/permanentFailureJobs reflect incremental processing.
        if (eventRef) {
          try {
            const deltaSuccess = counters.successPairs - beforeSuccess;
            const deltaFailed = counters.failedPairs - beforeFailed;
            const patch: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
            if (deltaSuccess > 0) patch.successJobs = FieldValue.increment(deltaSuccess);
            if (deltaFailed > 0) patch.permanentFailureJobs = FieldValue.increment(deltaFailed);
            if (deltaSuccess > 0 || deltaFailed > 0) {
              await eventRef.update(patch);
            }
          } catch (e: any) {
            logger.warn('processDataReadyRunV2_event_progress_update_failed', { runId: effectiveRunId, message: e?.message });
          }
        }
      });

      if (eventRef) {
        const finalStatus = counters.failedPairs > 0 ? 'completed_with_errors' : 'completed';

        // Backfill-style aggregate status for dashboards
        const backfillStyleStatus = counters.failedPairs === 0
          ? 'COMPLETE'
          : (counters.successPairs > 0 ? 'PARTIAL' : 'FAILED');

        await eventRef.set({
          status: finalStatus,
          runStatus: backfillStyleStatus,
          runCompletedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          runId: effectiveRunId,
          pairCount: pairs.length,
          intervals: runIntervals,
          expectedJobs: pairs.length * runIntervals.length,
          successJobs: counters.successPairs,
          permanentFailureJobs: counters.failedPairs,
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
        const rawPayload: any = parsedPayload as any;
        const attrs: any = (message?.attributes as any) || {};
        const nextSrc: any = rawPayload?.nextRefreshAt
          ?? rawPayload?.nextRefreshAtUTC
          ?? rawPayload?.NextRefreshAt
          ?? attrs?.NextRefreshAt
          ?? attrs?.nextRefreshAtUTC
          ?? attrs?.nextRefreshAt;
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

          let attempt = 0;
          let remaining = Number.POSITIVE_INFINITY;
          let lastDiag: any = undefined;
          let okResp = false;

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
