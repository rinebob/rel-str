import { onCall } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../firebase-admin-init';
import { getFunctions } from 'firebase-admin/functions';
import {
  PAIRS_COLLECTION,
  ARCHIVE_COLLECTION_PREFIX,
  REGISTRY_COLLECTION,
  HEATMAP_SNAPSHOTS_COLLECTION,
} from '../../webhooks/webhooks-config';
import { Interval } from '../../types/signal.types';

/**
 * @deprecated V1 viewport schema - use HeatmapSnapshotV2 for new implementations.
 * Retained for backward compatibility only.
 */
interface HeatmapSnapshotViewportV1 {
  baseline: string;
  timeframe: string;
  updatedAt: FirebaseFirestore.Timestamp;
  pairs: string[];
  dates: string[];
  /**
   * Raw RS values per pair. Firestore does not allow nested arrays, so we
   * wrap each row in an object instead of using number[][] directly.
   * The index of each row in this array corresponds to the index in `pairs`.
   */
  rows: Array<{
    pair: string;
    values: number[];
  }>;
  version: 1;
}

/**
 * V2 schema for historical/current shards.
 * Replaces the viewport concept with time-sharded documents.
 */
interface HeatmapSnapshotV2 {
  baseline: string;
  timeframe: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  updatedAt: FirebaseFirestore.Timestamp;
  dateRange: {
    from: string; // ISO date, inclusive
    to: string;   // ISO date, inclusive
  };
  pairs: string[];
  dates: string[];
  rows: Array<{
    pair: string;
    values: number[];
  }>;
  version: 2;
  shardType: 'historical' | 'current';
  shardId: string; // e.g., '2026-H1', '2025-2026', '2023-2026'
}

async function loadDailyRsRawSeriesForPair(
  pairId: string,
  fromStr: string,
  toStr: string,
): Promise<Array<{ day: string; rsRaw: number }>> {
  const out: Array<{ day: string; rsRaw: number }> = [];
  const pairRef = db.collection(PAIRS_COLLECTION).doc(pairId);

  const fromYear = Number(fromStr.slice(0, 4));
  const toYear = Number(toStr.slice(0, 4));

  for (let y = fromYear; y <= toYear; y++) {
    const yearStr = String(y);
    const archiveCol = `${ARCHIVE_COLLECTION_PREFIX}${yearStr}`;
    const daysCol = pairRef.collection(archiveCol);

    const yearFrom = `${yearStr}-01-01`;
    const yearTo = `${yearStr}-12-31`;
    const lower = fromStr > yearFrom ? fromStr : yearFrom;
    const upper = toStr < yearTo ? toStr : yearTo;

    const q = daysCol
      .where('day', '>=', lower)
      .where('day', '<=', upper)
      .orderBy('day', 'asc');

    const snap = await q.get();
    for (const doc of snap.docs) {
      const d = (doc.data() as any) || {};
      const day: string = String(d?.day || '');
      if (!day || day < fromStr || day > toStr) continue;
      const post = d.post as any;
      const rsRaw = Number(post?.rsRaw);
      if (!Number.isFinite(rsRaw)) continue;
      out.push({ day: day.slice(0, 10), rsRaw });
    }
  }

  out.sort((a, b) => a.day.localeCompare(b.day));
  return out;
}

/**
 * Build a DAILY viewport snapshot matrix for a given baseline using RS archive data.
 *
 * @deprecated Use generateHistoricalShard() for v2 shards instead.
 * This function is retained for backward compatibility with existing viewport docs.
 *
 * - Universe: all pair-registry docs whose id starts with `${baseline}-`.
 * - Date window: last ~120 calendar days from today, then compressed to the
 *   last 60 distinct trading days with data.
 * - Metric: rsRaw from archive POST records; matrix is [pairIndex][dateIndex].
 */
async function generateDailyViewportSnapshotForBaseline(baseline: string): Promise<HeatmapSnapshotViewportV1> {
  const upperTimeframe = 'DAILY';
  const today = new Date();
  const toStr = today.toISOString().slice(0, 10);
  const fromDate = new Date(today.getTime() - 120 * 24 * 60 * 60 * 1000);
  const fromStr = fromDate.toISOString().slice(0, 10);

  const registrySnap = await db.collection(REGISTRY_COLLECTION).get();
  const pairs: string[] = [];
  registrySnap.forEach((doc) => {
    const id = doc.id || '';
    if (id.startsWith(`${baseline}-`)) {
      pairs.push(id);
    }
  });

  pairs.sort();

  const perPair: Record<string, Array<{ day: string; rsRaw: number }>> = {};
  const daySet = new Set<string>();

  for (const pairId of pairs) {
    try {
      const series = await loadDailyRsRawSeriesForPair(pairId, fromStr, toStr);
      perPair[pairId] = series;
      for (const s of series) {
        daySet.add(s.day);
      }
    } catch (e: any) {
      logger.warn('viewport_snapshot_pair_failed', { pairId, message: e?.message });
      perPair[pairId] = [];
    }
  }

  const allDays = Array.from(daySet.values()).sort((a, b) => a.localeCompare(b));
  const viewportDays = allDays.slice(Math.max(0, allDays.length - 60));

  const rows: Array<{ pair: string; values: number[] }> = [];
  for (const pairId of pairs) {
    const series = perPair[pairId] || [];
    const byDay = new Map<string, number>();
    for (const s of series) byDay.set(s.day, s.rsRaw);
    const row: number[] = [];
    for (const d of viewportDays) {
      const v = byDay.get(d);
      row.push(Number.isFinite(v as number) ? (v as number) : 0);
    }
    rows.push({ pair: pairId, values: row });
  }

  // Invariant: every row must have exactly one value per date in the viewport.
  for (const r of rows) {
    if (r.values.length !== viewportDays.length) {
      throw new Error(
        `heatmap viewport invariant violated for baseline=${baseline} pair=${r.pair}: ` +
          `values.length=${r.values.length} dates.length=${viewportDays.length}`,
      );
    }
  }

  return {
    baseline,
    timeframe: upperTimeframe,
    updatedAt: Timestamp.now(),
    pairs,
    dates: viewportDays,
    rows,
    version: 1,
  };
}

function getWeekBucketKey(dayStr: string): string {
  const d = new Date(dayStr + 'T00:00:00Z');
  const dayOfWeek = d.getUTCDay();
  const offset = (dayOfWeek + 6) % 7;
  const monday = new Date(d.getTime() - offset * 24 * 60 * 60 * 1000);
  return monday.toISOString().slice(0, 10);
}

function getMonthBucketKey(dayStr: string): string {
  const year = Number(dayStr.slice(0, 4));
  const month = Number(dayStr.slice(5, 7)) - 1;
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  return firstOfMonth.toISOString().slice(0, 10);
}

/**
 * @deprecated Use generateHistoricalShard() for v2 shards instead.
 * This function is retained for backward compatibility with existing viewport docs.
 */
async function generateWeeklyOrMonthlyViewportSnapshotForBaseline(
  baseline: string,
  timeframe: 'WEEKLY' | 'MONTHLY',
): Promise<HeatmapSnapshotViewportV1> {
  const today = new Date();
  const toStr = today.toISOString().slice(0, 10);
  const lookbackDays = timeframe === 'WEEKLY' ? 365 : 730;
  const fromDate = new Date(today.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const fromStr = fromDate.toISOString().slice(0, 10);

  const registrySnap = await db.collection(REGISTRY_COLLECTION).get();
  const pairs: string[] = [];
  registrySnap.forEach((doc) => {
    const id = doc.id || '';
    if (id.startsWith(`${baseline}-`)) {
      pairs.push(id);
    }
  });

  pairs.sort();

  const perPair: Record<string, Array<{ day: string; rsRaw: number }>> = {};
  const bucketSet = new Set<string>();

  for (const pairId of pairs) {
    try {
      const series = await loadDailyRsRawSeriesForPair(pairId, fromStr, toStr);
      perPair[pairId] = series;
      for (const s of series) {
        const bucketKey = timeframe === 'WEEKLY' ? getWeekBucketKey(s.day) : getMonthBucketKey(s.day);
        bucketSet.add(bucketKey);
      }
    } catch (e: any) {
      logger.warn('viewport_snapshot_pair_failed', { pairId, message: e?.message });
      perPair[pairId] = [];
    }
  }

  const allBuckets = Array.from(bucketSet.values()).sort((a, b) => a.localeCompare(b));
  const maxBuckets = timeframe === 'WEEKLY' ? 26 : 24;
  const viewportBuckets = allBuckets.slice(Math.max(0, allBuckets.length - maxBuckets));

  const rows: Array<{ pair: string; values: number[] }> = [];
  for (const pairId of pairs) {
    const series = perPair[pairId] || [];
    const byBucket = new Map<string, { day: string; value: number }>();
    for (const s of series) {
      const bucketKey = timeframe === 'WEEKLY' ? getWeekBucketKey(s.day) : getMonthBucketKey(s.day);
      const existing = byBucket.get(bucketKey);
      if (!existing || s.day > existing.day) {
        byBucket.set(bucketKey, { day: s.day, value: s.rsRaw });
      }
    }
    const row: number[] = [];
    for (const b of viewportBuckets) {
      const entry = byBucket.get(b);
      row.push(entry && Number.isFinite(entry.value) ? entry.value : 0);
    }
    rows.push({ pair: pairId, values: row });
  }

  for (const r of rows) {
    if (r.values.length !== viewportBuckets.length) {
      throw new Error(
        `heatmap viewport invariant violated for baseline=${baseline} pair=${r.pair}: ` +
          `values.length=${r.values.length} dates.length=${viewportBuckets.length}`,
      );
    }
  }

  return {
    baseline,
    timeframe,
    updatedAt: Timestamp.now(),
    pairs,
    dates: viewportBuckets,
    rows,
    version: 1,
  };
}

/**
 * Generate a v2 historical or current shard for a given baseline and date range.
 * Supports DAILY, WEEKLY, and MONTHLY timeframes.
 */
async function generateHistoricalShard(
  baseline: string,
  timeframe: 'DAILY' | 'WEEKLY' | 'MONTHLY',
  dateRange: { from: string; to: string },
  shardType: 'historical' | 'current',
  shardId: string,
): Promise<HeatmapSnapshotV2> {
  const startTime = Date.now();
  const { from, to } = dateRange;

  logger.info('generateHistoricalShard_start', {
    baseline,
    timeframe,
    shardType,
    shardId,
    dateRange: { from, to },
  });

  // Get pairs for this baseline from registry
  const registryStartTime = Date.now();
  const registrySnap = await db.collection(REGISTRY_COLLECTION).get();
  const pairs: string[] = [];
  registrySnap.forEach((doc) => {
    const id = doc.id || '';
    if (id.startsWith(`${baseline}-`)) {
      pairs.push(id);
    }
  });
  pairs.sort();

  const registryDuration = Date.now() - registryStartTime;
  logger.info('generateHistoricalShard_registry_loaded', {
    baseline,
    pairCount: pairs.length,
    durationMs: registryDuration,
  });

  // Load RS data for all pairs in the date range
  const dataLoadStartTime = Date.now();
  const perPair: Record<string, Array<{ day: string; rsRaw: number }>> = {};
  const dateSet = new Set<string>();
  let failedPairs = 0;
  let totalDataPoints = 0;

  for (const pairId of pairs) {
    try {
      const series = await loadDailyRsRawSeriesForPair(pairId, from, to);
      perPair[pairId] = series;
      totalDataPoints += series.length;
      for (const s of series) {
        if (timeframe === 'DAILY') {
          dateSet.add(s.day);
        } else if (timeframe === 'WEEKLY') {
          dateSet.add(getWeekBucketKey(s.day));
        } else {
          dateSet.add(getMonthBucketKey(s.day));
        }
      }
    } catch (e: any) {
      failedPairs++;
      logger.warn('generateHistoricalShard_pair_load_failed', { 
        baseline,
        pairId, 
        from, 
        to, 
        message: e?.message 
      });
      perPair[pairId] = [];
    }
  }

  const dataLoadDuration = Date.now() - dataLoadStartTime;
  logger.info('generateHistoricalShard_data_loaded', {
    baseline,
    timeframe,
    pairCount: pairs.length,
    failedPairs,
    totalDataPoints,
    durationMs: dataLoadDuration,
  });

  // Get all dates/buckets in sorted order
  const allDates = Array.from(dateSet.values()).sort((a, b) => a.localeCompare(b));

  // Build rows for each pair
  const rows: Array<{ pair: string; values: number[] }> = [];
  
  if (timeframe === 'DAILY') {
    for (const pairId of pairs) {
      const series = perPair[pairId] || [];
      const byDay = new Map<string, number>();
      for (const s of series) byDay.set(s.day, s.rsRaw);
      const row: number[] = [];
      for (const d of allDates) {
        const v = byDay.get(d);
        row.push(Number.isFinite(v as number) ? (v as number) : 0);
      }
      rows.push({ pair: pairId, values: row });
    }
  } else {
    // WEEKLY or MONTHLY - aggregate by bucket
    for (const pairId of pairs) {
      const series = perPair[pairId] || [];
      const byBucket = new Map<string, { day: string; value: number }>();
      for (const s of series) {
        const bucketKey = timeframe === 'WEEKLY' ? getWeekBucketKey(s.day) : getMonthBucketKey(s.day);
        const existing = byBucket.get(bucketKey);
        if (!existing || s.day > existing.day) {
          byBucket.set(bucketKey, { day: s.day, value: s.rsRaw });
        }
      }
      const row: number[] = [];
      for (const b of allDates) {
        const entry = byBucket.get(b);
        row.push(entry && Number.isFinite(entry.value) ? entry.value : 0);
      }
      rows.push({ pair: pairId, values: row });
    }
  }

  // Validate row lengths
  for (const r of rows) {
    if (r.values.length !== allDates.length) {
      throw new Error(
        `Historical shard invariant violated for baseline=${baseline} pair=${r.pair}: ` +
          `values.length=${r.values.length} dates.length=${allDates.length}`,
      );
    }
  }

  // Estimate document size (rough approximation)
  const estimatedSize = JSON.stringify({ pairs, dates: allDates, rows }).length;
  const estimatedSizeKB = Math.round(estimatedSize / 1024);
  const totalDuration = Date.now() - startTime;
  
  logger.info('generateHistoricalShard_complete', {
    baseline,
    timeframe,
    shardId,
    shardType,
    dateRange,
    pairs: pairs.length,
    dates: allDates.length,
    estimatedSizeKB,
    totalDurationMs: totalDuration,
    failedPairs,
    totalDataPoints,
  });

  // Warn if approaching Firestore limit
  if (estimatedSize > 900000) {
    logger.warn('historical_shard_size_warning', {
      baseline,
      timeframe,
      shardId,
      estimatedSizeKB,
      message: 'Shard size approaching 1MB Firestore limit',
    });
  }

  return {
    baseline,
    timeframe,
    updatedAt: Timestamp.now(),
    dateRange,
    pairs,
    dates: allDates,
    rows,
    version: 2,
    shardType,
    shardId,
  };
}

/**
 * Generate document ID for historical/current shards.
 */
function getShardDocId(
  baseline: string,
  timeframe: string,
  snapshotType: 'historical' | 'current' | 'viewport',
  params: { year?: number; half?: number; yearStart?: number; yearEnd?: number },
): string {
  if (snapshotType === 'viewport') {
    return `${baseline}-${timeframe}-viewport`;
  }

  if (timeframe === 'DAILY') {
    const { year, half } = params;
    if (!year || !half) {
      throw new Error('DAILY shards require year and half parameters');
    }
    return `${baseline}-DAILY-hist-${year}-H${half}`;
  }

  const { yearStart, yearEnd } = params;
  if (!yearStart || !yearEnd) {
    throw new Error(`${timeframe} shards require yearStart and yearEnd parameters`);
  }
  return `${baseline}-${timeframe}-hist-${yearStart}-${yearEnd}`;
}

/**
 * Generate shard ID for metadata.
 */
function getShardId(
  timeframe: string,
  params: { year?: number; half?: number; yearStart?: number; yearEnd?: number },
): string {
  if (timeframe === 'DAILY') {
    const { year, half } = params;
    return `${year}-H${half}`;
  }
  const { yearStart, yearEnd } = params;
  return `${yearStart}-${yearEnd}`;
}

/**
 * Calculate date range for a historical shard.
 */
function getShardDateRange(
  timeframe: string,
  snapshotType: 'historical' | 'current',
  params: { year?: number; half?: number; yearStart?: number; yearEnd?: number },
): { from: string; to: string } {
  if (timeframe === 'DAILY') {
    const { year, half } = params;
    if (!year || !half) {
      throw new Error('DAILY shards require year and half parameters');
    }

    if (half === 1) {
      const from = `${year}-01-01`;
      const to = snapshotType === 'current' ? new Date().toISOString().slice(0, 10) : `${year}-06-30`;
      return { from, to };
    } else {
      const from = `${year}-07-01`;
      const to = snapshotType === 'current' ? new Date().toISOString().slice(0, 10) : `${year}-12-31`;
      return { from, to };
    }
  }

  const { yearStart, yearEnd } = params;
  if (!yearStart || !yearEnd) {
    throw new Error(`${timeframe} shards require yearStart and yearEnd parameters`);
  }

  const from = `${yearStart}-01-01`;
  const to = snapshotType === 'current' ? new Date().toISOString().slice(0, 10) : `${yearEnd}-12-31`;
  return { from, to };
}

/**
 * Trigger heatmap snapshot updates for affected baselines after RS pipeline completion.
 * 
 * This function is called by the RS pipeline when a realtime run completes successfully.
 * It enqueues Cloud Tasks to update current shards for all affected baselines.
 * 
 * @param interval The interval that was updated (DAILY, WEEKLY, or MONTHLY)
 * @param baselines Array of baseline symbols that were updated (e.g., ['SPY', 'QQQ'])
 */
export async function triggerHeatmapUpdatesForBaselines(
  interval: Interval,
  baselines: string[],
): Promise<void> {
  const triggerStartTime = Date.now();

  if (!baselines || baselines.length === 0) {
    logger.info('triggerHeatmapUpdatesForBaselines_no_baselines', { interval });
    return;
  }

  const timeframe = interval === Interval.DAILY ? 'DAILY' 
    : interval === Interval.WEEKLY ? 'WEEKLY' 
    : interval === Interval.MONTHLY ? 'MONTHLY' 
    : null;

  if (!timeframe) {
    logger.warn('triggerHeatmapUpdatesForBaselines_unsupported_interval', { interval });
    return;
  }

  logger.info('triggerHeatmapUpdatesForBaselines_start', {
    interval,
    timeframe,
    baselineCount: baselines.length,
    baselines: baselines.join(', '),
  });

  const queue = getFunctions().taskQueue('updateHeatmapSnapshotTask');
  const today = new Date();
  const year = today.getFullYear();
  const half = today.getMonth() < 6 ? 1 : 2;

  let enqueuedCount = 0;
  let failedCount = 0;
  const failedBaselines: string[] = [];

  for (const baseline of baselines) {
    try {
      let params: any = { baseline, timeframe, snapshotType: 'current' };

      if (timeframe === 'DAILY') {
        params.year = year;
        params.half = half;
      } else if (timeframe === 'WEEKLY') {
        params.yearStart = year;
        params.yearEnd = year + 1;
      } else if (timeframe === 'MONTHLY') {
        params.yearStart = year - 3;
        params.yearEnd = year;
      }

      await queue.enqueue(params);
      enqueuedCount++;
      logger.info('triggerHeatmapUpdatesForBaselines_enqueued', {
        baseline,
        timeframe,
        shardType: 'current',
        params,
      });
    } catch (e: any) {
      failedCount++;
      failedBaselines.push(baseline);
      logger.error('triggerHeatmapUpdatesForBaselines_enqueue_failed', {
        baseline,
        timeframe,
        message: e?.message,
        stack: e?.stack,
      });
    }
  }

  const totalDuration = Date.now() - triggerStartTime;

  logger.info('triggerHeatmapUpdatesForBaselines_complete', {
    interval,
    timeframe,
    totalBaselines: baselines.length,
    enqueuedCount,
    failedCount,
    failedBaselines: failedBaselines.length > 0 ? failedBaselines.join(', ') : 'none',
    durationMs: totalDuration,
  });
}

/**
 * Admin-only callable to rebuild heatmap snapshots.
 *
 * - Supports DAILY, WEEKLY, and MONTHLY timeframes.
 * - Supports both viewport (v1, deprecated) and historical/current shards (v2).
 * - For v2 shards, writes `heatmap-snapshots/{baseline}-{timeframe}-hist-{shardId}`.
 */
export const rebuildHeatmapSnapshotAdmin = onCall({ region: 'us-central1', timeoutSeconds: 540 }, async (req) => {
  const baseline = String(req.data?.baseline || '').trim().toUpperCase();
  const timeframe = String(req.data?.timeframe || 'DAILY').trim().toUpperCase();
  const snapshotType = (req.data?.snapshotType || 'viewport') as 'historical' | 'current' | 'viewport';
  
  // V2 shard parameters
  const year = req.data?.year ? Number(req.data.year) : undefined;
  const half = req.data?.half ? Number(req.data.half) : undefined;
  const yearStart = req.data?.yearStart ? Number(req.data.yearStart) : undefined;
  const yearEnd = req.data?.yearEnd ? Number(req.data.yearEnd) : undefined;

  if (!baseline) {
    logger.warn('rebuildHeatmapSnapshotAdmin_missing_baseline');
    return { ok: false, message: 'Missing baseline' };
  }

  if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(timeframe)) {
    logger.warn('rebuildHeatmapSnapshotAdmin_unsupported_timeframe', { timeframe });
    return { ok: false, message: 'Only DAILY, WEEKLY, and MONTHLY timeframes are supported' };
  }

  try {
    // Handle v1 viewport (deprecated) for backward compatibility
    if (snapshotType === 'viewport') {
      const snapshot =
        timeframe === 'DAILY'
          ? await generateDailyViewportSnapshotForBaseline(baseline)
          : await generateWeeklyOrMonthlyViewportSnapshotForBaseline(baseline, timeframe as 'WEEKLY' | 'MONTHLY');
      const docId = `${baseline}-${timeframe}-viewport`;
      await db.collection(HEATMAP_SNAPSHOTS_COLLECTION).doc(docId).set(snapshot, { merge: false });
      logger.info('rebuildHeatmapSnapshotAdmin_success_v1', {
        baseline,
        timeframe,
        pairs: snapshot.pairs.length,
        dates: snapshot.dates.length,
      });
      return { ok: true, baseline, timeframe, pairs: snapshot.pairs.length, dates: snapshot.dates.length };
    }

    // Handle v2 historical/current shards
    const params = { year, half, yearStart, yearEnd };
    const docId = getShardDocId(baseline, timeframe, snapshotType, params);
    const shardId = getShardId(timeframe, params);
    const dateRange = getShardDateRange(timeframe, snapshotType, params);

    logger.info('rebuildHeatmapSnapshotAdmin_generating_v2', {
      baseline,
      timeframe,
      snapshotType,
      shardId,
      dateRange,
    });

    // Generate the v2 shard
    const snapshot = await generateHistoricalShard(
      baseline,
      timeframe as 'DAILY' | 'WEEKLY' | 'MONTHLY',
      dateRange,
      snapshotType,
      shardId,
    );

    // Write to Firestore
    await db.collection(HEATMAP_SNAPSHOTS_COLLECTION).doc(docId).set(snapshot, { merge: false });

    logger.info('rebuildHeatmapSnapshotAdmin_success_v2', {
      baseline,
      timeframe,
      snapshotType,
      shardId,
      docId,
      pairs: snapshot.pairs.length,
      dates: snapshot.dates.length,
      estimatedSizeKB: Math.round(JSON.stringify(snapshot).length / 1024),
    });

    return {
      ok: true,
      baseline,
      timeframe,
      snapshotType,
      shardId,
      docId,
      pairs: snapshot.pairs.length,
      dates: snapshot.dates.length,
      dateRange: snapshot.dateRange,
    };
  } catch (e: any) {
    logger.error('rebuildHeatmapSnapshotAdmin_failed', { baseline, timeframe, snapshotType, message: e?.message });
    return { ok: false, baseline, timeframe, snapshotType, message: e?.message };
  }
});

/**
 * Cloud Task worker to update heatmap snapshots.
 * 
 * This task is enqueued by the RS pipeline after realtime runs complete.
 * It rebuilds the current shard for a specific baseline and timeframe.
 */
export const updateHeatmapSnapshotTask = onTaskDispatched(
  {
    retryConfig: {
      maxAttempts: 3,
      minBackoffSeconds: 60,
      maxBackoffSeconds: 300,
    },
    rateLimits: {
      maxConcurrentDispatches: 5,
      maxDispatchesPerSecond: 0.5,
    },
    memory: '512MiB',
    timeoutSeconds: 540,
  },
  async (req) => {
    const taskStartTime = Date.now();
    const { baseline, timeframe, snapshotType, year, half, yearStart, yearEnd } = req.data as any;

    logger.info('updateHeatmapSnapshotTask_start', {
      baseline,
      timeframe,
      snapshotType,
      year,
      half,
      yearStart,
      yearEnd,
      attemptNumber: req.retryCount ?? 0,
    });

    try {
      // Determine shard parameters
      const params = { year, half, yearStart, yearEnd };
      const docId = getShardDocId(baseline, timeframe, snapshotType, params);
      const shardId = getShardId(timeframe, params);
      const dateRange = getShardDateRange(timeframe, snapshotType, params);

      logger.info('updateHeatmapSnapshotTask_generating', {
        baseline,
        timeframe,
        docId,
        shardId,
        dateRange,
      });

      // Generate the snapshot
      const generateStartTime = Date.now();
      const snapshot = await generateHistoricalShard(baseline, timeframe as 'DAILY' | 'WEEKLY' | 'MONTHLY', dateRange, snapshotType, shardId);
      const generateDuration = Date.now() - generateStartTime;

      // Write to Firestore
      const writeStartTime = Date.now();
      await db.collection(HEATMAP_SNAPSHOTS_COLLECTION).doc(docId).set(snapshot, { merge: false });
      const writeDuration = Date.now() - writeStartTime;

      const totalDuration = Date.now() - taskStartTime;

      logger.info('updateHeatmapSnapshotTask_success', {
        baseline,
        timeframe,
        snapshotType,
        docId,
        pairs: snapshot.pairs.length,
        dates: snapshot.dates.length,
        generateDurationMs: generateDuration,
        writeDurationMs: writeDuration,
        totalDurationMs: totalDuration,
        attemptNumber: req.retryCount ?? 0,
      });
    } catch (e: any) {
      const totalDuration = Date.now() - taskStartTime;
      logger.error('updateHeatmapSnapshotTask_failed', {
        baseline,
        timeframe,
        snapshotType,
        year,
        half,
        yearStart,
        yearEnd,
        message: e?.message,
        stack: e?.stack,
        durationMs: totalDuration,
        attemptNumber: req.retryCount ?? 0,
        willRetry: (req.retryCount ?? 0) < 2,
      });
      throw e; // Re-throw to trigger Cloud Tasks retry
    }
  },
);
