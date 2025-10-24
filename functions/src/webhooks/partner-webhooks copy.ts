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
import { onRequest, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { db, FieldValue } from '../firebase-admin-init';
import { callPartnerTimeSeries, PartnerInterval } from '../partner-proxy';

// Firebase Admin and Firestore are initialized in ../firebase-admin-init

/**
 * Pub/Sub topic for partner data-ready notifications. This is the upstream
 * producer topic; our function subscribes and reacts as a consumer.
 */
const PARTNER_DATA_READY_TOPIC =
  process.env.FUNCTIONS_EMULATOR === 'true'
    ? 'projects/rel-str/topics/partner-data-ready'
    : 'projects/alpha-vantage-proxy-api/topics/partner-data-ready';

/**
 * Root collection for recording per-run status, metrics, and error samples
 * to aid observability and idempotency.
 */
const EVENTS_COLLECTION = 'partner-events';

/**
 * Collection containing the registry of baseline–target pairs we own. Each doc
 * is expected to have at least a baseline and target (or legacy `symbol` field
 * for the target). Symbols are normalized to uppercase.
 */
const REGISTRY_COLLECTION = 'pair-registry';

/**
 * SavantAPI tracked symbols collection name
 */
const TRACKED_SYMBOLS_COLLECTION = 'tracked-symbols';

/**
 * Days to retain a pair-registry entry after last member removes it
 */
const REGISTRY_RETENTION_DAYS = 30;

/**
 * Enumerates upstream run types of interest. We still parse non-DAILY run types
 * for telemetry, but the current pipeline is constrained to DAILY processing.
 * Run‑type values that we care about (time‑series data). Messages with any other
 * runType (e.g., non‑time‑series data) will be ignored.
 * Define an enum for the allowed run types – this gives us a clear, typed list
 * and makes future additions easier.
 */
export enum RunType {
  TS_DAILY_PRE = 'ts-daily-pre',
  TS_DAILY_POST = 'ts-daily-post',
  TS_WEEKLY_POST = 'ts-weekly-post',
  TS_MONTHLY_POST = 'ts-monthly-post',
  HEARTBEAT = 'heartbeat',
  RB_TEST = 'rb-test',
}

/**
 * Shared-aligned enum for interval
 */
export enum TimeSeriesInterval {
  INTRADAY = 'intraday',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

/**
 * Helper set to quickly validate if a run type is supported/recognized.
 */
const ALLOWED_RUN_TYPES = new Set<string>(Object.values(RunType));

/**
 * Fixed processing constraints.
 * - FIXED_INTERVAL: Only DAILY data is fetched.
 * - FIXED_LIMIT: Only the last 30 bars are requested (descending server-side,
 *   returned in ascending order after sorting).
 *   Note: this is temporary until all actual RS processing logic is implemented
 */
const FIXED_INTERVAL: PartnerInterval = 'DAILY';
const FIXED_LIMIT = 30; // last 30 bars only
// Number of calendar days to fetch when building the daily window (can be tuned)
const FIXED_DAYS = 30;

/**
 * Compact shape for a single OHLCV bar element used in RS calculations.
 * We only require epoch time `t` (ms) and adjusted close `c` from the partner.
 */
type SeriesBar = { t: number; c: number };

/**
 * Shape of documents in the pair registry.
 * - baseline: Required baseline like SPY.
 * - target: Required target like AAPL. If absent, legacy `symbol` is used.
 */
type PairRegistryDoc = {
  baseline?: string; // e.g., SPY
  target?: string;   // e.g., AAPL
  symbol?: string;   // fallback field name for target
};

/**
 * Normalized baseline–target key used through the pipeline.
 */
type PairKey = { baseline: string; target: string };

/**
 * A single RS data point aligned by timestamp across baseline and target.
 * - rs = targetClose / baseClose
 */
type RsPoint = { t: number; rs: number; baseClose: number; targetClose: number };

/**
 * Derive a stable UTC YYYY-MM-DD key from an epoch-millis timestamp.
 */
function dayKeyUTC(t: number): string {
  const d = new Date(t);
  const yyyy = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${MM}-${dd}`;
}

/**
 * Normalize an input ticker string by trimming and uppercasing. Returns
 * undefined for empty/invalid inputs.
 */
function normalizeSymbol(v?: string): string | undefined {
  if (!v || typeof v !== 'string') return undefined;
  return v.trim().toUpperCase();
}

/**
 * Read the baseline–target pairs from the registry and return a de-duplicated
 * list of normalized `PairKey` entries.
 *
 * Idempotency: duplicates are removed using an in-memory Set on
 * `${baseline}__${target}`.
 */
async function listRegisteredPairs(): Promise<PairKey[]> {
  const snap = await db.collection(REGISTRY_COLLECTION).get();
  const set = new Set<string>();
  const out: PairKey[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() as PairRegistryDoc;
    const baseline = normalizeSymbol(d.baseline);
    const target = normalizeSymbol(d.target || d.symbol);
    if (!baseline || !target) continue;
    const id = `${baseline}-${target}`;
    if (!set.has(id)) {
      set.add(id);
      out.push({ baseline, target });
    }
  }
  return out;
}

/**
 * Run a worker function over `items` with a maximum concurrency of `limit`.
 * Designed for IO-bound tasks (API calls + Firestore) to prevent excessive
 * fan-out while keeping the pipeline responsive.
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
 * Compute a short RS series by aligning baseline and target by UTC day.
 * If no daily intersection exists, return an empty array.
 *
 * rs = targetClose / baseClose
 */
function computeRsSeries(baseBars: SeriesBar[], targetBars: SeriesBar[]): RsPoint[] {
  // Align by UTC day rather than exact milliseconds to tolerate minute/timezone differences on daily bars.
  const baseByDay = new Map<string, SeriesBar>();
  for (const b of baseBars) baseByDay.set(dayKeyUTC(b.t), b);
  const out: RsPoint[] = [];
  for (const t of targetBars) {
    const key = dayKeyUTC(t.t);
    const base = baseByDay.get(key);
    if (base && base.c > 0) {
      const rs = t.c / base.c;
      // Use the later of the two timestamps to represent the day for sorting/ids
      const tEff = Math.max(t.t, base.t);
      out.push({ t: tEff, rs, baseClose: base.c, targetClose: t.c });
    }
  }
  // Ensure ascending order by representative timestamp
  out.sort((a, b) => a.t - b.t);
  return out;
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
 * Format PT timestamp segment YYMMDD-HHMMSS for heartbeat doc IDs.
 */
function formatPtSegment(publishTimeIso?: string): string | undefined {
  const pubIso = publishTimeIso ?? new Date().toISOString();
  const pubDate = new Date(pubIso);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(pubDate);
  const parts = Object.fromEntries(fmt.map(p => [p.type, p.value]));
  const yyyy = parts.year; const MM = parts.month; const dd = parts.day;
  const HH = parts.hour; const mm = parts.minute; const ss = parts.second;
  const yy = String(yyyy).slice(-2);
  return `${yy}${MM}${dd}-${HH}${mm}${ss}`;
}

/**
 * Compute the event document ID given message and run context.
 */
function computeEventDocId(params: {
  messageId?: string;
  isHeartbeat: boolean;
  ptSegment?: string;
  eventType: string;
  runId: string;
}): string {
  const { messageId, isHeartbeat, ptSegment, eventType, runId } = params;
  return isHeartbeat && messageId
    ? `heartbeat-${ptSegment ?? '000000-000000'}-${messageId}`
    : `${eventType}__${runId}`;
}

/**
 * Mark the event document as processing with common metadata.
 */
async function markProcessing(eventRef: FirebaseFirestore.DocumentReference, meta: {
  eventType: string;
  isHeartbeat: boolean;
  runId: string;
  messageId?: string;
  publishTime?: string;
  ptSegment?: string;
}): Promise<void> {
  const data: Record<string, unknown> = {
    status: 'processing',
    startTime: FieldValue.serverTimestamp(),
    runType: meta.eventType,
    isCanary: meta.isHeartbeat,
    runId: meta.runId,
    messageId: meta.messageId,
    intervalUsed: FIXED_INTERVAL,
    window: FIXED_LIMIT,
  };
  if (meta.publishTime) data.publishTime = meta.publishTime;
  if (meta.ptSegment) data.ptPublishTime = meta.ptSegment;
  await eventRef.set(data, { merge: true });
}

/**
 * Process all registered pairs with modest concurrency. For each pair, fetch
 * baseline and target daily ranges (using FIXED_DAYS), compute the RS series,
 * and persist results. Returns summary counters and sampled errors.
 */
async function processPairs(pairs: PairKey[], phase: Phase): Promise<{
  successPairs: number;
  failedPairs: number;
  errorSamples: Array<{ pair: string; message: string; status?: number; code?: string }>;
}> {
  let successPairs = 0;
  let failedPairs = 0;
  const errorSamples: Array<{ pair: string; message: string; status?: number; code?: string }> = [];

  // 1) Build unique symbol set (baseline and targets) to avoid duplicate upstream fetches
  const symbolSet = new Set<string>();
  for (const { baseline, target } of pairs) {
    if (baseline) symbolSet.add(baseline);
    if (target) symbolSet.add(target);
  }
  const uniqueSymbols = Array.from(symbolSet.values());

  // 2) Fetch bars per unique symbol once, with bounded concurrency
  const symbolBars = new Map<string, PartnerBar[]>();
  const SYM_CONCURRENCY = 8; // modest parallelism; tune or make env-driven if needed
  await forEachWithConcurrency(uniqueSymbols, SYM_CONCURRENCY, async (sym) => {
    try {
      const bars = await fetchDailyBarsRaw(sym, FIXED_DAYS);
      symbolBars.set(sym, bars);
    } catch (e: any) {
      logger.error('symbol_fetch_failed', { symbol: sym, message: e?.message, status: e?.response?.status });
    }
  });

  // 3) Process pairs with bounded concurrency, reusing the cached bars
  await forEachWithConcurrency(pairs, 3, async ({ baseline, target }) => {
    const pairId = `${baseline}-${target}`;
    try {
      const baseBars = symbolBars.get(baseline) || [];
      const targetBars = symbolBars.get(target) || [];
      if (baseBars.length === 0 || targetBars.length === 0) {
        failedPairs++;
        const msg = baseBars.length === 0 && targetBars.length === 0
          ? 'missing_bars_baseline_and_target'
          : (baseBars.length === 0 ? 'missing_bars_baseline' : 'missing_bars_target');
        if (errorSamples.length < 10) errorSamples.push({ pair: pairId, message: msg });
        logger.warn('process_pair_missing_bars', { pairId, baseline, target, baseBars: baseBars.length, targetBars: targetBars.length });
        return;
      }

      // Convert PartnerBar[] -> SeriesBar[] for RS diagnostics
      const baseSeries: SeriesBar[] = baseBars
        .map((b) => ({ t: Number(b.t), c: Number(b.c) }))
        .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.c));
      const targetSeries: SeriesBar[] = targetBars
        .map((b) => ({ t: Number(b.t), c: Number(b.c) }))
        .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.c));
      const rsSeries = computeRsSeries(baseSeries, targetSeries);

      // Safely compute last-day strings to satisfy TS (avoid new Date(undefined))
      const baseLastT = baseBars.length > 0 ? baseBars[baseBars.length - 1]!.t : undefined;
      const targetLastT = targetBars.length > 0 ? targetBars[targetBars.length - 1]!.t : undefined;
      const baseLastDay = baseLastT !== undefined ? new Date(baseLastT).toISOString().slice(0, 10) : undefined;
      const targetLastDay = targetLastT !== undefined ? new Date(targetLastT).toISOString().slice(0, 10) : undefined;

      logger.info(`Pair diagnostics ${pairId} rsPoints=${rsSeries.length}`, {
        pairId,
        baseBars: baseBars.length,
        targetBars: targetBars.length,
        rsPoints: rsSeries.length,
        baseFirstT: baseBars[0]?.t,
        baseLastT,
        targetFirstT: targetBars[0]?.t,
        targetLastT,
        baseLastDay,
        targetLastDay,
      });
      if (rsSeries.length === 0) {
        // Record a sampled error but do not throw; continue with other pairs
        failedPairs++;
        const msg = 'no_intersection_daily_or_empty_bars';
        if (errorSamples.length < 10) {
          errorSamples.push({ pair: pairId, message: msg });
        }
        return;
      }
      const latestPoint = rsSeries[rsSeries.length - 1];
      logger.info(`rs_write_start ${pairId} phase=${phase} points=${rsSeries.length} latestDay=${new Date(latestPoint.t).toISOString().slice(0, 10)} rs=${latestPoint.rs.toFixed(4)}`, {
        pairId,
        points: rsSeries.length,
        path: `pairs/${pairId}`,
        latest: {
          t: latestPoint.t,
          day: new Date(latestPoint.t).toISOString().slice(0, 10),
          rs: latestPoint.rs,
          baseClose: latestPoint.baseClose,
          targetClose: latestPoint.targetClose,
        },
      });
      // V2 pairs-data writer uses phase-aware series; reuse raw bars for change calc
      await writeUnifiedSeries(baseline, target, phase, rsSeries as any, baseBars, targetBars);
      logger.info(`rs_write_done ${pairId} phase=${phase} points=${rsSeries.length} latestDay=${new Date(latestPoint.t).toISOString().slice(0, 10)} rs=${latestPoint.rs.toFixed(4)} base=${latestPoint.baseClose} target=${latestPoint.targetClose}`, {
        pairId,
        phase,
        points: rsSeries.length,
        latest: {
          t: latestPoint.t,
          day: new Date(latestPoint.t).toISOString().slice(0, 10),
          rs: latestPoint.rs,
          baseClose: latestPoint.baseClose,
          targetClose: latestPoint.targetClose,
        },
      });
      successPairs++;
    } catch (e: any) {
      failedPairs++;
      const status = e?.response?.status as number | undefined;
      const msg = e?.message || String(e);
      logger.error('Pair processing failed', { pairId, status, msg });
      if (errorSamples.length < 10) {
        const sample: Record<string, unknown> = { pair: pairId, status, message: msg };
        if (e?.code !== undefined) sample.code = e.code;
        errorSamples.push(sample as { pair: string; message: string; status?: number; code?: string });
      }
    }
  });

  return { successPairs, failedPairs, errorSamples };
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
export const processDataReadyRun = onMessagePublished(
  // Data‑Ready events are published to the consumer‑agnostic topic defined above
  { topic: PARTNER_DATA_READY_TOPIC, region: 'us-central1' },
  async (event) => {
    let resolvedRunId: string | undefined; // set early so catch can reference safely
    let eventDocId: string | undefined; // for error handling writes
    try {
      const message = event.data.message;

      // Decode base64 Pub/Sub data safely and parse JSON
      const dataBase64 = typeof message.data === 'string' ? message.data : '';
      const rawData = dataBase64 ? Buffer.from(dataBase64, 'base64').toString('utf8') : '{}';
      let payload: Record<string, any> = {};
      try {
        payload = JSON.parse(rawData);
      } catch (parseErr: any) {
        logger.error('Invalid Pub/Sub JSON payload', { rawData, error: parseErr?.message });
        throw new Error('Invalid JSON in Pub/Sub message');
      }

      // Receipt log for observability
      logger.info('Received Data-Ready message', {
        messageId: message.messageId,
        attributes: message.attributes,
        payloadPreview: typeof rawData === 'string' ? rawData.slice(0, 200) : undefined,
      });

      // Resolve run context (type, heartbeat flag, and run id)
      const { runType, isHeartbeat, runId } = resolveRunContext(message, payload);

      if (!runType && !isHeartbeat) {
        logger.info('Skipping Data‑Ready message with missing runType and not marked as heartbeat', {
          attributes: message.attributes,
        });
        return;
      }
      if (!isHeartbeat && runType && !ALLOWED_RUN_TYPES.has(runType)) {
        logger.info(`Skipping Data‑Ready message with unsupported runType: ${runType}`);
        return;
      }

      // Resolve run id
      resolvedRunId = runId;
      if (!resolvedRunId || typeof resolvedRunId !== 'string' || resolvedRunId.trim().length === 0) {
        if (isHeartbeat) {
          // Record heartbeat without requiring a runId, then return
          const eventTypeHb = RunType.HEARTBEAT;
          const messageIdHb = message.messageId as string | undefined;
          const ptSegmentHb = formatPtSegment(message.publishTime as string | undefined);
          const eventDocIdHb = computeEventDocId({
            messageId: messageIdHb,
            isHeartbeat: true,
            ptSegment: ptSegmentHb,
            eventType: eventTypeHb,
            runId: 'hb-no-runid',
          });
          const hbRef = db.collection(EVENTS_COLLECTION).doc(eventDocIdHb);
          const data: Record<string, unknown> = {
            status: 'heartbeat',
            isCanary: true,
            runType: eventTypeHb,
            messageId: messageIdHb,
            intervalUsed: FIXED_INTERVAL,
            window: FIXED_LIMIT,
          };
          const pubTime = message.publishTime as string | undefined;
          if (pubTime) data.publishTime = pubTime;
          if (ptSegmentHb) data.ptPublishTime = ptSegmentHb;
          await hbRef.set(data, { merge: true });
          logger.info('Recorded heartbeat without runId', { docId: eventDocIdHb });
          return;
        }
        logger.error('Missing or invalid runId in message; skipping update to Firestore', {
          attributes: message.attributes,
          payload,
        });
        return; // Do not attempt to write to Firestore with an invalid path
      }

      // Compute event type and doc id (heartbeat id includes a PT segment)
      const eventType = isHeartbeat ? RunType.HEARTBEAT : (runType as string);
      const messageId = message.messageId as string | undefined;
      const ptSegment = isHeartbeat ? formatPtSegment(message.publishTime as string | undefined) : undefined;
      eventDocId = computeEventDocId({
        messageId,
        isHeartbeat,
        ptSegment,
        eventType,
        runId: resolvedRunId,
      });
      const eventRef = db.collection(EVENTS_COLLECTION).doc(eventDocId);

      // Idempotency: skip if terminal
      const existing = await eventRef.get();
      const existingStatus = existing.exists ? (existing.data()?.status as string | undefined) : undefined;
      if (existingStatus === 'completed' || existingStatus === 'failed' || existingStatus === 'completed_with_errors') {
        logger.info('Skipping already terminal run', { docId: eventDocId, runId: resolvedRunId, status: existingStatus });
        return;
      }

      // Mark processing
      await markProcessing(eventRef, {
        eventType,
        isHeartbeat,
        runId: resolvedRunId,
        messageId,
        publishTime: (message.publishTime as string | undefined) ?? undefined,
        ptSegment,
      });

      // Start-of-run visual separator
      logger.info('');
      logger.info(`============= START RUN ${resolvedRunId} ==================`);
      logger.info('');

      // Load registered pairs
      const pairs = await listRegisteredPairs();
      logger.info('Processing pairs for data-ready run (DAILY, last 30)', { count: pairs.length });

      const { successPairs, failedPairs, errorSamples } = await processPairs(pairs, 'post');

      await eventRef.set(
        {
          status: failedPairs > 0 ? 'completed_with_errors' : 'completed',
          endTime: FieldValue.serverTimestamp(),
          pairsProcessed: successPairs,
          pairsFailed: failedPairs,
          intervalUsed: FIXED_INTERVAL,
          window: FIXED_LIMIT,
          errorSamples,
        },
        { merge: true }
      );

      logger.info(`Processed run ${resolvedRunId} successfully`);
      // End-of-run visual separator
      logger.info('');
      logger.info(`============= END RUN ${resolvedRunId} ==================`);
      logger.info('');
    } catch (error: any) {
      logger.error('Pub/Sub processing error', error);
      if (eventDocId) {
        await db
          .collection(EVENTS_COLLECTION)
          .doc(eventDocId)
          .set(
            {
              status: 'failed',
              error: error?.message ?? String(error),
              endTime: FieldValue.serverTimestamp(),
              runId: resolvedRunId,
            },
            { merge: true }
          );
      }
    }
  }
);

/**
 * One-off helper to seed `pair-registry` with a fixed list of baseline–target pairs.
 * Invoke once, then remove/disable. IDs are deterministic: `${BASELINE}-${TARGET}`.
 *
 * Pairs requested:
 * - QQQ baseline with AAPL, GOOGL, TSLA targets
 * - SPY baseline with PFE, WMT, XOM, XPH targets
 */
export const seedPairRegistryManual = onRequest({ region: 'us-central1', timeoutSeconds: 60 }, async (_req, res) => {
  try {
    const pairs: Array<{ baseline: string; target: string }> = [
      { baseline: 'QQQ', target: 'AAPL' },
      { baseline: 'QQQ', target: 'GOOGL' },
      { baseline: 'QQQ', target: 'TSLA' },
      { baseline: 'SPY', target: 'PFE' },
      { baseline: 'SPY', target: 'WMT' },
      { baseline: 'SPY', target: 'XOM' },
      { baseline: 'SPY', target: 'XPH' },
    ];

    const batch = db.batch();
    for (const p of pairs) {
      const baseline = (p.baseline || '').trim().toUpperCase();
      const target = (p.target || '').trim().toUpperCase();
      if (!baseline || !target) continue;
      const id = `${baseline}-${target}`;
      const ref = db.collection(REGISTRY_COLLECTION).doc(id);
      batch.set(ref, {
        baseline,
        target,
        createdAt: FieldValue.serverTimestamp(),
        source: 'manual-seed',
      }, { merge: true });
    }
    await batch.commit();
    res.status(200).json({ ok: true, count: pairs.length });
  } catch (e: any) {
    logger.error('seedPairRegistryManual failed', { message: e?.message, code: e?.code });
    res.status(500).json({ ok: false, error: e?.message || 'seed_failed' });
  }
});

/********************
 * V2 Dual-Phase RS Pipeline (Pre/Post)
 * - Computes RS rank using 5-day rolling window of percent changes
 * - Writes to Firestore under pairs/{BASE}_{SYMBOL}.{phase} with { latest, series, seriesMeta, seriesUpdatedAt }
 * - Phase: "pre" uses intraday (ipc/ip) when available; "post" uses EOD (cp/ac)
 ********************/

type Phase = 'pre' | 'post';

type PartnerBar = {
  d?: string;   // YYYY-MM-DD
  t?: number;   // epoch ms
  ac?: number;  // adjusted close (EOD)
  c?: number;   // close
  pc?: number;  // prior close
  cp?: number;  // percent change EOD
  ip?: number;  // intraday price
  ipc?: number; // intraday percent change
  it?: string;  // intraday time e.g. "15:30"
};

// Generate comparison matrices for a 5-length window: 00000 .. 11111
function genMatrices5(): string[] {
  const out: string[] = [];
  for (let i = 0; i < 32; i++) out.push(i.toString(2).padStart(5, '0'));
  return out;
}
const MATRICES_5 = genMatrices5();

// Calculate rank for a 5-value window of subject vs baseline percent changes.
function calculateRankWindow(subject: number[], baseline: number[]): number {
  let outcomes: Array<[string, number]> = [];
  for (const m of MATRICES_5) {
    let sum = 0;
    for (let j = 0; j < 5; j++) sum += (m[j] === '1' ? subject[j] : baseline[j]) || 0;
    outcomes.push([m, Number(sum.toFixed(4))]);
  }
  outcomes.sort((a, b) => a[1] - b[1]);
  const idx = outcomes.findIndex((e) => e[0] === '11111');
  return idx >= 0 ? (idx + 1) / outcomes.length : 0;
}

function dowLabelUTC(dayStr: string): string {
  const d = new Date(dayStr + 'T00:00:00.000Z');
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
  return labels[d.getUTCDay()];
}

/**
 * Phase series entry (aligned per-day output of buildPhaseSeries).
 * Represents a single aligned trading day across baseline and target, with
 * computed RS rank (5-day window) and the phase-specific prices/percent-changes.
 */
interface PhaseSeriesPoint {
  day: string;
  dow: string;   // day-of-week label (UTC)
  t: number;
  rank: number;
  baseCp: number;
  targetCp: number;
  baseClose: number;
  targetClose: number;
  it?: string;
}

/**
 * Build aligned percent-change arrays and compute rolling 5-day RS rank per-day.
 *
 * @param baselineBars - Partner DAILY bars for the baseline symbol.
 * @param targetBars - Partner DAILY bars for the target symbol.
 * @param phase - 'pre' (intraday) or 'post' (end-of-day).
 * @returns Array of PhaseSeriesPoint, one per aligned trading day (after warmup).
 */
function buildPhaseSeries(
  baselineBars: PartnerBar[],
  targetBars: PartnerBar[],
  phase: Phase
): PhaseSeriesPoint[] {
  // Map by day for quick alignment
  const baseByDay = new Map<string, PartnerBar>();
  for (const b of baselineBars) if (b?.d) baseByDay.set(b.d!, b);
  const aligned: Array<{ day: string; base: PartnerBar; target: PartnerBar }> = [];
  for (const t of targetBars) {
    if (!t?.d) continue;
    const base = baseByDay.get(t.d);
    if (!base) continue;
    // Skip weekends explicitly (SA may not filter them)
    const dw = dowLabelUTC(t.d);
    if (dw === 'Sat' || dw === 'Sun') continue;
    // Require phase-appropriate fields to avoid zeros
    if (phase === 'pre') {
      const hasIntraday = Number(t.ip) > 0 && Number(base?.ip) > 0;
      if (!hasIntraday) continue;
    } else {
      const hasClose = (Number(t.ac) > 0 || Number(t.c) > 0) && (Number(base?.ac) > 0 || Number(base?.c) > 0);
      if (!hasClose) continue;
    }
    aligned.push({ day: t.d, base, target: t });
  }

  const outDays: string[] = [];
  const outTimes: (string | undefined)[] = [];
  const outDows: string[] = [];
  const baseCp: number[] = [];
  const targetCp: number[] = [];
  const baseClose: number[] = [];
  const targetClose: number[] = [];
  const outT: number[] = [];

  for (const { day, base, target } of aligned) {
    // Phase-specific cp and close
    const bCp = phase === 'post'
      ? (Number(base.cp) || 0)
      : (Number(base.ipc) || (Number(base.ip) && Number(base.pc) ? ((Number(base.ip) - Number(base.pc)) / Number(base.pc)) * 100 : 0));
    const tCp = phase === 'post'
      ? (Number(target.cp) || 0)
      : (Number(target.ipc) || (Number(target.ip) && Number(target.pc) ? ((Number(target.ip) - Number(target.pc)) / Number(target.pc)) * 100 : 0));

    const bClose = phase === 'post' ? (Number(base.ac) || Number(base.c) || 0) : (Number(base.ip) || 0);
    const tClose = phase === 'post' ? (Number(target.ac) || Number(target.c) || 0) : (Number(target.ip) || 0);

    // Sanity guards
    if (!Number.isFinite(bCp) || !Number.isFinite(tCp)) continue;
    if (!Number.isFinite(bClose) || !Number.isFinite(tClose)) continue;
    if (bClose <= 0 || tClose <= 0) continue;

    outDays.push(day);
    outTimes.push(phase === 'pre' ? (target.it || base.it) : undefined);
    outDows.push(dowLabelUTC(day));
    baseCp.push(Number(bCp));
    targetCp.push(Number(tCp));
    baseClose.push(bClose);
    targetClose.push(tClose);
    outT.push(Number(target.t || base.t || 0));
  }

  const out: PhaseSeriesPoint[] = [];
  for (let i = 4; i < outDays.length; i++) {
    const sub = [targetCp[i], targetCp[i - 1], targetCp[i - 2], targetCp[i - 3], targetCp[i - 4]];
    const bas = [baseCp[i], baseCp[i - 1], baseCp[i - 2], baseCp[i - 3], baseCp[i - 4]];
    const rank = calculateRankWindow(sub, bas);
    out.push({
      day: outDays[i],
      dow: outDows[i],
      t: outT[i],
      rank,
      baseCp: baseCp[i],
      targetCp: targetCp[i],
      baseClose: baseClose[i],
      targetClose: targetClose[i],
      it: outTimes[i],
    });
  }
  return out;
}

async function fetchDailyBarsRaw(symbol: string, days: number): Promise<PartnerBar[]> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const toIso = to.toISOString().slice(0, 10);
  const fromIso = from.toISOString().slice(0, 10);
  const data = (await callPartnerTimeSeries({ symbol, interval: FIXED_INTERVAL, from: fromIso, to: toIso, limit: FIXED_LIMIT })) as any;
  const bars: any[] = Array.isArray(data?.bars) ? data.bars : [];
  const norm: PartnerBar[] = bars
    .map((b: any) => ({
      d: typeof b?.d === 'string' ? b.d : (typeof b?.t === 'number' ? new Date(b.t).toISOString().slice(0, 10) : undefined),
      t: Number(b?.t),
      ac: Number(b?.ac),
      c: Number(b?.c),
      pc: Number(b?.pc),
      cp: Number(b?.cp),
      ip: Number(b?.ip),
      ipc: Number(b?.ipc),
      it: typeof b?.it === 'string' ? b.it : undefined,
    }))
    .filter((b: PartnerBar) => !!b.d && Number.isFinite(b.t))
    .sort((a, b) => (a.t! - b.t!));
  return norm;
}

/**
 * Write unified series to Firestore in the new pairs-data schema.
 * Upserts the per-day element for this phase, recomputes latest, trims to meta.window,
 * and sets lastUpdatedAt.
 *
 * Pre phase computes change/percentChange versus the prior day's post-close adj close.
 * Post phase computes versus the prior day's post-close as well.
 *
 * @param baseline - Baseline symbol.
 * @param target - Target symbol.
 * @param phase - 'pre' (intraday) or 'post' (end-of-day).
 * @param entries - PhaseSeriesPoint[] to write.
 * @param baselineBars - Baseline bars for computing prior-day post-close.
 * @param targetBars - Target bars for computing prior-day post-close.
 */
async function writeUnifiedSeries(
  baseline: string,
  target: string,
  phase: Phase,
  entries: PhaseSeriesPoint[],
  baselineBars: PartnerBar[],
  targetBars: PartnerBar[]
): Promise<void> {
  if (entries.length === 0) return;
  const pairId = `${baseline}-${target}`;
  const pairRef = db.collection('pairs-data').doc(pairId);

  // Load existing doc
  const snap = await pairRef.get();
  const existing = (snap.exists ? (snap.data() as any) : {}) || {};
  const existingData: Array<any> = Array.isArray(existing.data) ? existing.data : [];
  const existingMeta: any = (existing.meta as any) || {};

  // Prepare meta (single object)
  const meta = {
    baseline,
    symbol: target,
    interval: FIXED_INTERVAL,
    window: Number.isFinite(existingMeta?.window) ? Number(existingMeta.window) : 30,
  };

  // Quick lookup maps by day for bars to compute prior-day post-close
  const baseIndexByDay = new Map<string, number>();
  for (let i = 0; i < baselineBars.length; i++) {
    const d = baselineBars[i]?.d;
    if (d) baseIndexByDay.set(d, i);
  }
  const targetIndexByDay = new Map<string, number>();
  for (let i = 0; i < targetBars.length; i++) {
    const d = targetBars[i]?.d;
    if (d) targetIndexByDay.set(d, i);
  }

  const isWeekend = (dayStr?: string) => {
    if (!dayStr) return false;
    const dw = dowLabelUTC(dayStr);
    return dw === 'Sat' || dw === 'Sun';
  };

  function findPrevTradingBar(bars: PartnerBar[], idx?: number): PartnerBar | undefined {
    if (idx === undefined || idx <= 0) return undefined;
    let j = idx - 1;
    while (j >= 0) {
      const d = bars[j]?.d;
      if (d && !isWeekend(d)) return bars[j];
      j--;
    }
    return undefined;
  }

  // Build a day -> entry map from existing data for upsert
  const byDay = new Map<string, any>();
  for (const d of existingData) if (d?.day) byDay.set(d.day, { ...d });

  // Upsert each new entry
  for (const e of entries) {
    const dayObj = byDay.get(e.day) || { day: e.day, dow: e.dow };

    // Compute RS from closes
    const rs = e.baseClose > 0 ? e.targetClose / e.baseClose : undefined;

    if (phase === 'pre') {
      // Prior day post-close prices (adjusted close preferred, fallback to close)
      const bi = baseIndexByDay.get(e.day);
      const ti = targetIndexByDay.get(e.day);
      const prevBase = findPrevTradingBar(baselineBars, bi);
      const prevTarget = findPrevTradingBar(targetBars, ti);
      const prevBaseClose = Number(prevBase?.ac || prevBase?.c || 0);
      const prevTargetClose = Number(prevTarget?.ac || prevTarget?.c || 0);
      const baseChange = Number.isFinite(prevBaseClose) && prevBaseClose > 0 ? e.baseClose - prevBaseClose : 0;
      const targetChange = Number.isFinite(prevTargetClose) && prevTargetClose > 0 ? e.targetClose - prevTargetClose : 0;
      const basePct = Number.isFinite(prevBaseClose) && prevBaseClose > 0 ? (baseChange / prevBaseClose) * 100 : 0;
      const targetPct = Number.isFinite(prevTargetClose) && prevTargetClose > 0 ? (targetChange / prevTargetClose) * 100 : 0;

      dayObj.pre = {
        time: e.it,
        t: e.t,
        base: { price: e.baseClose, change: Number(baseChange.toFixed(6)), percentChange: Number(basePct.toFixed(6)) },
        target: { price: e.targetClose, change: Number(targetChange.toFixed(6)), percentChange: Number(targetPct.toFixed(6)) },
        rs: Number((rs ?? 0).toFixed(6)),
        source: 'intraday',
      };
    } else {
      // Post-close: compute vs prior day post-close
      const bi = baseIndexByDay.get(e.day);
      const ti = targetIndexByDay.get(e.day);
      const prevBase = findPrevTradingBar(baselineBars, bi);
      const prevTarget = findPrevTradingBar(targetBars, ti);
      const prevBaseClose = Number(prevBase?.ac || prevBase?.c || 0);
      const prevTargetClose = Number(prevTarget?.ac || prevTarget?.c || 0);
      const baseChange = Number.isFinite(prevBaseClose) && prevBaseClose > 0 ? e.baseClose - prevBaseClose : 0;
      const targetChange = Number.isFinite(prevTargetClose) && prevTargetClose > 0 ? e.targetClose - prevTargetClose : 0;
      const basePct = Number.isFinite(prevBaseClose) && prevBaseClose > 0 ? (baseChange / prevBaseClose) * 100 : 0;
      const targetPct = Number.isFinite(prevTargetClose) && prevTargetClose > 0 ? (targetChange / prevTargetClose) * 100 : 0;

      dayObj.post = {
        t: e.t,
        base: { price: e.baseClose, change: Number(baseChange.toFixed(6)), percentChange: Number(basePct.toFixed(6)) },
        target: { price: e.targetClose, change: Number(targetChange.toFixed(6)), percentChange: Number(targetPct.toFixed(6)) },
        rs: Number((rs ?? 0).toFixed(6)),
        source: 'adjustedClose',
      };
    }

    byDay.set(e.day, dayObj);
  }

  // Merge, sort, and enforce window retention
  let merged = Array.from(byDay.values()).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  if (merged.length > meta.window) merged = merged.slice(merged.length - meta.window);

  const latest = merged[merged.length - 1];

  await pairRef.set(
    {
      meta,
      lastUpdatedAt: FieldValue.serverTimestamp(),
      latest,
      data: merged,
    },
    { merge: true }
  );

  logger.info(`pairs-data_write_done ${pairId} phase=${phase} days=${merged.length} latestDay=${latest?.day}`);
}

/**
 * Convert any incoming runType to kebab-case for storage and doc IDs.
 */
function toKebabRunType(rt?: string): string | undefined {
  if (!rt) return undefined;
  return String(rt).replace(/_/g, '-');
}

export const processDataReadyRunV2 = onMessagePublished(
  { topic: PARTNER_DATA_READY_TOPIC, region: 'us-central1' },
  async (event) => {
    // Resolve phase from attributes or payload, default to 'post' if omitted
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
    const phase: Phase = (attrPhase === 'pre' || attrPhase === 'post') ? (attrPhase as Phase)
      : (payloadPhase === 'pre' || payloadPhase === 'post') ? (payloadPhase as Phase)
      : 'post';

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
      if (hasMonthly && phase === 'post') derivedRunType = RunType.TS_MONTHLY_POST;
      else if (hasWeekly && phase === 'post') derivedRunType = RunType.TS_WEEKLY_POST;
      else if (hasDaily && phase === 'pre') derivedRunType = RunType.TS_DAILY_PRE;
      else if (hasDaily && phase === 'post') derivedRunType = RunType.TS_DAILY_POST;
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
          logger.info('processDataReadyRunV2 skipping terminal run', { docId: eventDocId, status: existingStatus });
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
        return;
      }

      const days = FIXED_DAYS;

      // Track summary
      let successPairs = 0;
      let failedPairs = 0;
      const errorSamples: Array<{ pair: string; message: string; status?: number; code?: string }> = [];

      logger.info('processDataReadyRunV2 starting pair processing', { count: pairs.length, phase, eventType, runId: effectiveRunId });
      await forEachWithConcurrency(pairs, 3, async ({ baseline, target }) => {
        const pairId = `${baseline}-${target}`;
        try {
          const [baseBars, targetBars] = await Promise.all([
            fetchDailyBarsRaw(baseline, days),
            fetchDailyBarsRaw(target, days),
          ]);
          const series = buildPhaseSeries(baseBars, targetBars, phase);
          if (series.length === 0) {
            logger.info(`processDataReadyRunV2 no aligned series for ${pairId} phase=${phase}`);
            failedPairs++;
            if (errorSamples.length < 10) errorSamples.push({ pair: pairId, message: 'no_aligned_series' });
            return;
          }
          // Unified writer (no retention trimming)
          await writeUnifiedSeries(baseline, target, phase, series, baseBars, targetBars);
          successPairs++;
        } catch (e: any) {
          failedPairs++;
          const status = e?.response?.status as number | undefined;
          const msg = e?.message || String(e);
          logger.error('processDataReadyRunV2 pair failed', { pairId, phase, message: msg, code: e?.code, status });
          if (errorSamples.length < 10) errorSamples.push({ pair: pairId, message: msg, status, code: e?.code });
        }
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

/**
 * UnregisterPairs callable
 * Deletes entries under `pair-registry/{BASELINE}-{TARGET}` for provided symbols.
 * Request: { listId: string, baseline: string, symbols: string[] }
 * Response: { unregistered: string[] }
 */
export const unregisterPairs = onCall({ region: 'us-central1' }, async (req) => {
  const listId = (req.data?.listId || '').trim();
  const baseline = normalizeSymbol(req.data?.baseline);
  const symbols = Array.isArray(req.data?.symbols) ? req.data.symbols : [];
  const uid = req.auth?.uid || 'anon';
  if (!baseline || !listId) {
    logger.warn('unregisterPairs missing baseline or listId');
    return { unregistered: [] };
  }
  const retentionMs = REGISTRY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const memberKey = `uid:${uid}/list:${listId}`;
  const unregistered: string[] = [];
  for (const s of symbols) {
    const target = normalizeSymbol(String(s));
    if (!target) continue;
    const id = `${baseline}-${target}`;
    const ref = db.collection(REGISTRY_COLLECTION).doc(id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = (snap.data() as any) || {};
      const members: string[] = Array.isArray(data.members) ? data.members : [];
      const hadMember = members.includes(memberKey);
      const newMembers = hadMember ? members.filter((m) => m !== memberKey) : members;
      const oldRefCount: number = Number.isFinite(data.refCount) ? Number(data.refCount) : members.length;
      const newRefCount = hadMember ? Math.max(0, oldRefCount - 1) : oldRefCount;
      const update: Record<string, unknown> = {
        members: newMembers,
        refCount: newRefCount,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (newRefCount === 0) update['pendingDeleteAt'] = new Date(Date.now() + retentionMs).toISOString();
      tx.set(ref, update, { merge: true });
    });
    unregistered.push(id);
  }
  logger.info('unregisterPairs completed', { count: unregistered.length, baseline, listId });
  return { unregistered };
});

/**
 * validateAndRegisterPairs callable
 * Validates baseline/targets against tracked-symbols and registers pair-registry membership with refCount.
 * Request: { listId: string, baseline: string, symbols: string[] }
 * Response: { registered: string[], rejected: Array<{ symbol: string; reason: string }>, baselineHint?: { nonStandard: boolean } }
 */
export const validateAndRegisterPairs = onCall({ region: 'us-central1' }, async (req) => {
  const listId = (req.data?.listId || '').trim();
  const baseline = normalizeSymbol(req.data?.baseline);
  const symbols = Array.isArray(req.data?.symbols) ? req.data.symbols.map((x: any) => String(x)) : [];
  const uid = req.auth?.uid || 'anon';
  if (!baseline || !listId) {
    logger.warn('validateAndRegisterPairs missing baseline or listId');
    return { registered: [], rejected: [{ symbol: baseline || 'unknown', reason: 'missing_baseline_or_listId' }] };
  }

  const readTracked = async (sym: string) => {
    const ref = db.collection(TRACKED_SYMBOLS_COLLECTION).doc(sym);
    const snap = await ref.get();
    return snap.exists ? (snap.data() as any) : undefined;
  };

  // Baseline must be supported (no need for isBaseline === true). Provide a UI hint if not an ETF/index.
  const baselineDoc = await readTracked(baseline);
  const baselineSupported = !!baselineDoc?.supported;
  const baselineHint = { nonStandard: baselineSupported && !baselineDoc?.isBaseline };
  if (!baselineSupported) {
    return { registered: [], rejected: [{ symbol: baseline, reason: 'baseline_not_supported' }], baselineHint };
  }

  const rejected: Array<{ symbol: string; reason: string }> = [];
  const validTargets: string[] = [];
  for (const raw of symbols) {
    const target = normalizeSymbol(String(raw));
    if (!target) continue;
    const doc = await readTracked(target);
    if (!doc?.supported) {
      rejected.push({ symbol: target, reason: 'target_not_supported' });
      continue;
    }
    validTargets.push(target);
  }

  const memberKey = `uid:${uid}/list:${listId}`;
  const registered: string[] = [];
  for (const target of validTargets) {
    const id = `${baseline}-${target}`;
    const ref = db.collection(REGISTRY_COLLECTION).doc(id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const exists = snap.exists;
      const data = (exists ? (snap.data() as any) : {}) || {};
      const members: string[] = Array.isArray(data.members) ? data.members : [];
      const alreadyMember = members.includes(memberKey);
      const newMembers = alreadyMember ? members : [...members, memberKey];
      const oldRefCount: number = Number.isFinite(data.refCount) ? Number(data.refCount) : members.length;
      const newRefCount = alreadyMember ? oldRefCount : oldRefCount + 1;
      const update: Record<string, unknown> = {
        baseline,
        target,
        members: newMembers,
        refCount: newRefCount,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (!exists) update['createdAt'] = FieldValue.serverTimestamp();
      if (data?.pendingDeleteAt) update['pendingDeleteAt'] = FieldValue.delete();
      tx.set(ref, update, { merge: true });
    });
    registered.push(id);
  }

  logger.info('validateAndRegisterPairs completed', { baseline, listId, registered: registered.length, rejected: rejected.length });
  return { registered, rejected, baselineHint };
});