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
import { onRequest } from 'firebase-functions/v2/https';
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
 * Enumerates upstream run types of interest. We still parse non-DAILY run types
 * for telemetry, but the current pipeline is constrained to DAILY processing.
 * Run‑type values that we care about (time‑series data). Messages with any other
 * runType (e.g., non‑time‑series data) will be ignored.
 * Define an enum for the allowed run types – this gives us a clear, typed list
 * and makes future additions easier.
 */
export enum RunType {
  TS_DAILY_PRE = 'ts_daily_pre',
  TS_DAILY_POST = 'ts_daily_post',
  TS_WEEKLY_POST = 'ts_weekly_post',
  TS_MONTHLY_POST = 'ts_monthly_post',
  HEARTBEAT = 'heartbeat',
  RB_TEST = 'rb-test',
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
 * Fetch the last `days` DAILY bars for `symbol` from the Partner API and return a
 * normalized, ascending `SeriesBar[]` for RS use. Any malformed points are
 * filtered out. Only `t` and `c` are retained to keep memory overhead minimal.
 */
async function fetchDailyRange(symbol: string, days: number): Promise<SeriesBar[]> {
  // Query explicit last N calendar days via from/to (UTC) and keep limit as a safety.
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const toIso = to.toISOString().slice(0, 10);   // YYYY-MM-DD
  const fromIso = from.toISOString().slice(0, 10);
  const data = (await callPartnerTimeSeries({
    symbol,
    interval: FIXED_INTERVAL,
    from: fromIso,
    to: toIso,
    limit: FIXED_LIMIT,
  })) as any;
  // Expected shape per docs: { bars: [{ t, c, ... }], ... }
  const bars = Array.isArray(data?.bars) ? data.bars : [];
  // Lightweight diagnostics about upstream response
  if (bars.length > 0) {
    const firstT = Number(bars[0]?.t);
    const lastT = Number(bars[bars.length - 1]?.t);
    const firstDay = new Date(firstT).toISOString().slice(0, 10);
    const lastDay = new Date(lastT).toISOString().slice(0, 10);
    const firstC = Number(bars[0]?.c);
    const lastC = Number(bars[bars.length - 1]?.c);
    logger.info(`partner_timeseries_response ${symbol} bars=${bars.length} first=${firstDay}(${firstC}) last=${lastDay}(${lastC})`, {
      symbol,
      interval: FIXED_INTERVAL,
      from: fromIso,
      to: toIso,
      limit: FIXED_LIMIT,
      bars: bars.length,
      firstT,
      lastT,
      firstDay,
      lastDay,
      firstC,
      lastC,
    });
  } else {
    logger.info(`partner_timeseries_response_empty ${symbol}`, {
      symbol,
      interval: FIXED_INTERVAL,
      from: fromIso,
      to: toIso,
      limit: FIXED_LIMIT,
      bars: 0,
    });
  }
  return bars
    .map((b: any) => ({ t: Number(b?.t), c: Number(b?.c) }))
    .filter((b: SeriesBar) => Number.isFinite(b.t) && Number.isFinite(b.c))
    .sort((a: SeriesBar, b: SeriesBar) => a.t - b.t);
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
 * Persist RS series to Firestore under `pairs/{BASELINE}-{TARGET}`.
 * - Series points are written to `rs/{t}` using batched writes.
 * - Latest snapshot is updated atomically on the pair doc.
 *
 * Notes on limits:
 * - Batches are chunked to stay well within Firestore write limits.
 * - Doc ID uses epoch milliseconds `t` for idempotent upserts.
 */
async function writePairRs(baseline: string, target: string, points: RsPoint[]): Promise<void> {
  if (points.length === 0) return;
  const pairId = `${baseline}-${target}`;
  const pairRef = db.collection('pairs').doc(pairId);

  // No longer writing one-doc-per-day under rs/*; we persist a compact array on the pair doc instead.

  // Additionally persist a compact array series on the pair doc itself for single-document reads.
  // Note: Keep the array small (<= FIXED_LIMIT) to stay well under the 1MB doc limit.
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
  const series = points.map(p => {
    const d = new Date(p.t);
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
      .toISOString()
      .slice(0, 10); // YYYY-MM-DD (UTC)
    const dow = DOW[d.getUTCDay()];
    return { t: p.t, day, dow, rs: p.rs, baseClose: p.baseClose, targetClose: p.targetClose };
  });
  const latest = points[points.length - 1];
  const latestDate = new Date(latest.t);
  const latestDay = new Date(Date.UTC(latestDate.getUTCFullYear(), latestDate.getUTCMonth(), latestDate.getUTCDate()))
    .toISOString()
    .slice(0, 10);
  const latestDow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][latestDate.getUTCDay()];
  await pairRef.set(
    {
      series,
      seriesMeta: { interval: FIXED_INTERVAL, window: FIXED_LIMIT },
      seriesUpdatedAt: FieldValue.serverTimestamp(),
      latest: {
        t: latest.t,
        day: latestDay,
        dow: latestDow,
        rs: latest.rs,
        baseClose: latest.baseClose,
        targetClose: latest.targetClose,
        interval: FIXED_INTERVAL,
        window: FIXED_LIMIT,
        updatedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
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
async function processPairs(pairs: PairKey[]): Promise<{
  successPairs: number;
  failedPairs: number;
  errorSamples: Array<{ pair: string; message: string; status?: number; code?: string }>;
}> {
  let successPairs = 0;
  let failedPairs = 0;
  const errorSamples: Array<{ pair: string; message: string; status?: number; code?: string }> = [];

  await forEachWithConcurrency(pairs, 3, async ({ baseline, target }) => {
    const pairId = `${baseline}-${target}`;
    try {
      const [baseBars, targetBars] = await Promise.all([
        fetchDailyRange(baseline, FIXED_DAYS),
        fetchDailyRange(target, FIXED_DAYS),
      ]);
      const rsSeries = computeRsSeries(baseBars, targetBars);
      logger.info(`Pair diagnostics ${pairId} rsPoints=${rsSeries.length}`, {
        pairId,
        baseBars: baseBars.length,
        targetBars: targetBars.length,
        rsPoints: rsSeries.length,
        baseFirstT: baseBars[0]?.t,
        baseLastT: baseBars[baseBars.length - 1]?.t,
        targetFirstT: targetBars[0]?.t,
        targetLastT: targetBars[targetBars.length - 1]?.t,
        baseLastDay: baseBars[baseBars.length - 1]?.t ? new Date(baseBars[baseBars.length - 1]!.t).toISOString().slice(0,10) : undefined,
        targetLastDay: targetBars[targetBars.length - 1]?.t ? new Date(targetBars[targetBars.length - 1]!.t).toISOString().slice(0,10) : undefined,
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
      logger.info(`rs_write_start ${pairId} points=${rsSeries.length} latestDay=${new Date(latestPoint.t).toISOString().slice(0, 10)} rs=${latestPoint.rs.toFixed(4)}`, {
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
      await writePairRs(baseline, target, rsSeries);
      logger.info(`rs_write_done ${pairId} points=${rsSeries.length} latestDay=${new Date(latestPoint.t).toISOString().slice(0, 10)} rs=${latestPoint.rs.toFixed(4)} base=${latestPoint.baseClose} target=${latestPoint.targetClose}`, {
        pairId,
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
      eventDocId = computeEventDocId({ messageId, isHeartbeat, ptSegment, eventType, runId: resolvedRunId });

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

      const { successPairs, failedPairs, errorSamples } = await processPairs(pairs);

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