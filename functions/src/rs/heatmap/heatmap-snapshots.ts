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
 * V2 schema for shards.
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
 * Get ISO week identifier for a date (YYYY-Www format, where ww is the ISO week number).
 * ISO weeks start on Monday and the first week of the year contains Jan 4.
 */
function getIsoWeekKey(dayStr: string): string {
  const d = new Date(dayStr + 'T00:00:00Z');
  const dayOfWeek = d.getUTCDay();
  const offset = (dayOfWeek + 6) % 7; // Days back to Monday
  const monday = new Date(d.getTime() - offset * 24 * 60 * 60 * 1000);
  
  // ISO week year and week number
  const year = monday.getUTCFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const daysSinceStart = Math.floor((monday.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  const weekNum = Math.floor(daysSinceStart / 7) + 1;
  
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Get month identifier for a date (YYYY-MM format).
 */
function getMonthKey(dayStr: string): string {
  return dayStr.slice(0, 7); // YYYY-MM
}

/**
 * Generate a v2 shard for a given baseline and date range.
 * Supports DAILY, WEEKLY, and MONTHLY timeframes.
 */
async function generateShardSnapshot(
  baseline: string,
  timeframe: 'DAILY' | 'WEEKLY' | 'MONTHLY',
  dateRange: { from: string; to: string },
  shardId: string,
): Promise<HeatmapSnapshotV2> {
  const startTime = Date.now();
  const { from, to } = dateRange;

  logger.info('generateShardSnapshot_start', {
    baseline,
    timeframe,
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
  logger.info('generateShardSnapshot_registry_loaded', {
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
      // For DAILY, just collect all trading days
      // For WEEKLY/MONTHLY, we'll collect all days and group them later
      for (const s of series) {
        dateSet.add(s.day);
      }
    } catch (e: any) {
      failedPairs++;
      logger.warn('generateShardSnapshot_pair_load_failed', { 
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
  logger.info('generateShardSnapshot_data_loaded', {
    baseline,
    timeframe,
    pairCount: pairs.length,
    failedPairs,
    totalDataPoints,
    durationMs: dataLoadDuration,
  });

  // For WEEKLY/MONTHLY, group trading days by week/month and find the latest day in each bucket
  let allDates: string[];
  const bucketToLatestDay = new Map<string, string>();

  if (timeframe === 'DAILY') {
    allDates = Array.from(dateSet.values()).sort((a, b) => a.localeCompare(b));
  } else if (timeframe === 'WEEKLY') {
    // Group all trading days by ISO week
    const weekToDays = new Map<string, string[]>();
    for (const day of dateSet.values()) {
      const weekKey = getIsoWeekKey(day);
      if (!weekToDays.has(weekKey)) weekToDays.set(weekKey, []);
      weekToDays.get(weekKey)!.push(day);
    }
    // For each week, use the latest trading day as the bucket label
    for (const [weekKey, days] of weekToDays.entries()) {
      const latestDay = days.sort((a, b) => b.localeCompare(a))[0];
      bucketToLatestDay.set(weekKey, latestDay);
    }
    allDates = Array.from(bucketToLatestDay.values()).sort((a, b) => a.localeCompare(b));
  } else {
    // MONTHLY: Group all trading days by month
    const monthToDays = new Map<string, string[]>();
    for (const day of dateSet.values()) {
      const monthKey = getMonthKey(day);
      if (!monthToDays.has(monthKey)) monthToDays.set(monthKey, []);
      monthToDays.get(monthKey)!.push(day);
    }
    // For each month, use the latest trading day as the bucket label
    for (const [monthKey, days] of monthToDays.entries()) {
      const latestDay = days.sort((a, b) => b.localeCompare(a))[0];
      bucketToLatestDay.set(monthKey, latestDay);
    }
    allDates = Array.from(bucketToLatestDay.values()).sort((a, b) => a.localeCompare(b));
  }

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
        const bucketKey = timeframe === 'WEEKLY' ? getIsoWeekKey(s.day) : getMonthKey(s.day);
        const existing = byBucket.get(bucketKey);
        // Keep the latest trading day's value for this bucket
        if (!existing || s.day > existing.day) {
          byBucket.set(bucketKey, { day: s.day, value: s.rsRaw });
        }
      }
      const row: number[] = [];
      for (const bucketLabel of allDates) {
        // Find which bucket this label belongs to
        let bucketKey = '';
        if (timeframe === 'WEEKLY') {
          bucketKey = getIsoWeekKey(bucketLabel);
        } else {
          bucketKey = getMonthKey(bucketLabel);
        }
        const entry = byBucket.get(bucketKey);
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
  
  logger.info('generateShardSnapshot_complete', {
    baseline,
    timeframe,
    shardId,
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
    logger.warn('shard_size_warning', {
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
    shardId,
  };
}

/**
 * Generate document ID for shards.
 */
function getShardDocId(
  baseline: string,
  timeframe: string,
  params: { year?: number; half?: number; yearStart?: number; yearEnd?: number },
): string {
  if (timeframe === 'DAILY') {
    const { year, half } = params;
    if (!year || !half) {
      throw new Error('DAILY shards require year and half parameters');
    }
    return `${baseline}-DAILY-${year}-H${half}`;
  }

  const { yearStart, yearEnd } = params;
  if (!yearStart || !yearEnd) {
    throw new Error(`${timeframe} shards require yearStart and yearEnd parameters`);
  }
  return `${baseline}-${timeframe}-${yearStart}-${yearEnd}`;
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
 * Calculate date range for a shard.
 */
function getShardDateRange(
  timeframe: string,
  params: { year?: number; half?: number; yearStart?: number; yearEnd?: number },
): { from: string; to: string } {
  if (timeframe === 'DAILY') {
    const { year, half } = params;
    if (!year || !half) {
      throw new Error('DAILY shards require year and half parameters');
    }
    const today = new Date();
    const currentYear = today.getFullYear();

    if (half === 1) {
      const from = `${year}-01-01`;
      // End of H1 is June 30; use today if this is the current in-progress half
      const halfEnd = `${year}-06-30`;
      const to = year === currentYear && today < new Date(`${year}-07-01T00:00:00Z`)
        ? today.toISOString().slice(0, 10)
        : halfEnd;
      return { from, to };
    } else {
      const from = `${year}-07-01`;
      // End of H2 is Dec 31; use today if this is the current in-progress half
      const halfEnd = `${year}-12-31`;
      const to = year === currentYear && today >= new Date(`${year}-07-01T00:00:00Z`)
        ? today.toISOString().slice(0, 10)
        : halfEnd;
      return { from, to };
    }
  }

  const { yearStart, yearEnd } = params;
  if (!yearStart || !yearEnd) {
    throw new Error(`${timeframe} shards require yearStart and yearEnd parameters`);
  }
  const from = `${yearStart}-01-01`;
  const today = new Date();
  const currentYear = today.getFullYear();
  // For completed historical ranges, end at Dec 31 of yearEnd; if the range includes the current year, cap at today
  const rangeEnd = yearEnd < currentYear ? `${yearEnd}-12-31` : today.toISOString().slice(0, 10);
  return { from, to: rangeEnd };
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
      let params: any = { baseline, timeframe };

      if (timeframe === 'DAILY') {
        params.year = year;
        params.half = half;
      } else if (timeframe === 'WEEKLY') {
        // 2-year shards: 2019-2020, 2021-2022, 2023-2024, 2025-2026, etc.
        const yearStart = year % 2 === 0 ? year - 1 : year;
        params.yearStart = yearStart;
        params.yearEnd = yearStart + 1;
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
 * - Supports both viewport (v1, deprecated) and v2 shards.
 * - For v2 shards, writes `heatmap-snapshots/{baseline}-{timeframe}-hist-{shardId}`.
 */
export const rebuildHeatmapSnapshotAdmin = onCall({ region: 'us-central1', timeoutSeconds: 540 }, async (req) => {
  const baseline = String(req.data?.baseline || '').trim().toUpperCase();
  const timeframe = String(req.data?.timeframe || 'DAILY').trim().toUpperCase();
  // snapshotType deprecated/ignored; always generate to today's date
  
  // V2 shard parameters
  const year = req.data?.year ? Number(req.data.year) : undefined;
  const half = req.data?.half ? Number(req.data.half) : undefined;
  const yearStart = req.data?.yearStart ? Number(req.data.yearStart) : undefined;
  const yearEnd = req.data?.yearEnd ? Number(req.data.yearEnd) : undefined;
  // Optional custom date range override for v2 shards
  const dateFrom = req.data?.dateFrom ? String(req.data.dateFrom).slice(0, 10) : undefined; // ISO YYYY-MM-DD
  const dateTo = req.data?.dateTo ? String(req.data.dateTo).slice(0, 10) : undefined;       // ISO YYYY-MM-DD

  if (!baseline) {
    logger.warn('rebuildHeatmapSnapshotAdmin_missing_baseline');
    return { ok: false, message: 'Missing baseline' };
  }

  if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(timeframe)) {
    logger.warn('rebuildHeatmapSnapshotAdmin_unsupported_timeframe', { timeframe });
    return { ok: false, message: 'Only DAILY, WEEKLY, and MONTHLY timeframes are supported' };
  }

  try {
    // Handle v2 shards (single path)
    const params = { year, half, yearStart, yearEnd } as { year?: number; half?: number; yearStart?: number; yearEnd?: number };
    let docId: string;
    let shardId: string;
    let dateRange: { from: string; to: string };

    const isCustomRange = !!(dateFrom && dateTo);
    if (isCustomRange) {
      // Validate basic ISO format and ordering
      const from = dateFrom as string;
      const to = dateTo as string;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        logger.warn('rebuildHeatmapSnapshotAdmin_invalid_custom_range', { baseline, timeframe, from, to });
        return { ok: false, message: 'Invalid custom date range. Expected YYYY-MM-DD for dateFrom/dateTo' };
      }
      if (from > to) {
        logger.warn('rebuildHeatmapSnapshotAdmin_reversed_custom_range', { baseline, timeframe, from, to });
        return { ok: false, message: 'dateFrom must be <= dateTo' };
      }

      shardId = `${from}_${to}`;
      docId = `${baseline}-${timeframe}-${shardId}`;
      dateRange = { from, to };
    } else {
      docId = getShardDocId(baseline, timeframe, params);
      shardId = getShardId(timeframe, params);
      dateRange = getShardDateRange(timeframe, params);
    }

    logger.info('rebuildHeatmapSnapshotAdmin_generating_v2', {
      baseline,
      timeframe,
      shardId,
      dateRange,
    });

    // Generate the v2 shard
    const snapshot = await generateShardSnapshot(
      baseline,
      timeframe as 'DAILY' | 'WEEKLY' | 'MONTHLY',
      dateRange,
      shardId,
    );

    // Write to Firestore
    await db.collection(HEATMAP_SNAPSHOTS_COLLECTION).doc(docId).set(snapshot, { merge: false });

    logger.info('rebuildHeatmapSnapshotAdmin_success_v2', {
      baseline,
      timeframe,
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
      shardId,
      docId,
      pairs: snapshot.pairs.length,
      dates: snapshot.dates.length,
      dateRange: snapshot.dateRange,
    };
  } catch (e: any) {
    logger.error('rebuildHeatmapSnapshotAdmin_failed', { baseline, timeframe, message: e?.message });
    return { ok: false, baseline, timeframe, message: e?.message };
  }
});

/**
 * Admin-only callable to migrate heatmap snapshot document IDs by removing '-hist-'.
 * - Copies docs matching OLD pattern to NEW ID and deletes the old doc.
 * - Optionally deletes unknown/malformed IDs not matching either pattern when deleteUnknown=true.
 *
 * Request shape:
 * { dryRun?: boolean, deleteUnknown?: boolean, limit?: number }
 */
export const migrateHeatmapDocIdsAdmin = onCall({ region: 'us-central1', timeoutSeconds: 540 }, async (req) => {
  const dryRun = Boolean(req.data?.dryRun ?? true);
  const deleteUnknown = Boolean(req.data?.deleteUnknown ?? false);
  const limit = req.data?.limit ? Number(req.data.limit) : undefined;
  const baselineFilterRaw = req.data?.baseline ? String(req.data.baseline).toUpperCase().trim() : '';
  const baselineFilter = baselineFilterRaw && /^[A-Z]+$/.test(baselineFilterRaw) ? baselineFilterRaw : '';

  const oldPattern = /^([A-Z]+)-(DAILY|WEEKLY|MONTHLY)-hist-(.+)$/;
  // Strict canonical new IDs (no custom ranges):
  // DAILY:   SYMBOL-DAILY-YYYY-H[12]
  // WEEKLY:  SYMBOL-WEEKLY-YYYY-YYYY
  // MONTHLY: SYMBOL-MONTHLY-YYYY-YYYY
  const dailyCanonical = /^([A-Z]+)-DAILY-(\d{4}-H[12])$/;
  const weeklyCanonical = /^([A-Z]+)-WEEKLY-(\d{4}-\d{4})$/;
  const monthlyCanonical = /^([A-Z]+)-MONTHLY-(\d{4}-\d{4})$/;

  try {
    const start = Date.now();
    const colRef = db.collection(HEATMAP_SNAPSHOTS_COLLECTION);
    const docRefs = await colRef.listDocuments();
    let filtered = docRefs;
    if (baselineFilter) {
      filtered = docRefs.filter((d) => d.id.startsWith(`${baselineFilter}-`));
    }
    const targets = typeof limit === 'number' ? filtered.slice(0, limit) : filtered;

    let migrated = 0;
    let skipped = 0;
    let deletedUnknown = 0;

    for (const ref of targets) {
      const id = ref.id;
      const oldMatch = id.match(oldPattern);
      const isCanonicalNew =
        dailyCanonical.test(id) || weeklyCanonical.test(id) || monthlyCanonical.test(id);

      if (oldMatch) {
        const baseline = oldMatch[1];
        const timeframe = oldMatch[2];
        const shardId = oldMatch[3];
        const newId = `${baseline}-${timeframe}-${shardId}`;
        if (newId === id) {
          skipped++;
          continue;
        }
        if (dryRun) {
          logger.info('migrateHeatmapDocIdsAdmin_dryrun_would_migrate', { from: id, to: newId });
          migrated++;
          continue;
        }
        const snap = await ref.get();
        const data = snap.data();
        if (!data) {
          // Nothing to copy; just delete old
          await ref.delete();
          migrated++;
          continue;
        }
        await colRef.doc(newId).set(data, { merge: false });
        await ref.delete();
        migrated++;
      } else if (isCanonicalNew) {
        // Already migrated
        skipped++;
      } else if (deleteUnknown) {
        if (dryRun) {
          logger.info('migrateHeatmapDocIdsAdmin_dryrun_would_delete_unknown', { id });
          deletedUnknown++;
        } else {
          await ref.delete();
          deletedUnknown++;
        }
      } else {
        skipped++;
      }
    }

    const durationMs = Date.now() - start;
    logger.info('migrateHeatmapDocIdsAdmin_complete', { migrated, skipped, deletedUnknown, durationMs, dryRun, deleteUnknown, scanned: targets.length, baselineFilter: baselineFilter || undefined });
    return { ok: true, migrated, skipped, deletedUnknown, durationMs, dryRun, deleteUnknown, scanned: targets.length, baselineFilter: baselineFilter || undefined };
  } catch (e: any) {
    logger.error('migrateHeatmapDocIdsAdmin_failed', { message: e?.message, stack: e?.stack });
    return { ok: false, message: e?.message };
  }
});

/**
 * Admin-only callable to bulk rebuild shards for provided baselines and selected intervals.
 * Intended for 2026 H1 cutover without '-hist-'.
 *
 * Request shape:
 * { baselines?: string[], all?: boolean, rebuildDaily?: boolean, rebuildWeekly?: boolean, rebuildMonthly?: boolean }
 */
export const bulkRebuildShardsAdmin = onCall({ region: 'us-central1', timeoutSeconds: 540 }, async (req) => {
  let baselines: string[] = Array.isArray(req.data?.baselines) ? req.data.baselines.map((b: any) => String(b).toUpperCase()) : [];
  const useAll = Boolean(req.data?.all ?? false);
  const rebuildDaily = Boolean(req.data?.rebuildDaily ?? true);
  const rebuildWeekly = Boolean(req.data?.rebuildWeekly ?? true);
  const rebuildMonthly = Boolean(req.data?.rebuildMonthly ?? true);

  if (useAll) {
    const registrySnap = await db.collection(REGISTRY_COLLECTION).get();
    const baseSet = new Set<string>();
    registrySnap.forEach((doc) => {
      const id = doc.id || '';
      const dash = id.indexOf('-');
      if (dash > 0) baseSet.add(id.slice(0, dash));
    });
    baselines = Array.from(baseSet.values()).sort();
  }

  if (!baselines || baselines.length === 0) {
    logger.warn('bulkRebuildShardsAdmin_missing_baselines');
    return { ok: false, message: 'Missing baselines array (or set all=true)' };
  }

  const results: Array<{ baseline: string; timeframe: string; ok: boolean; docId?: string; message?: string }> = [];

  const today = new Date();
  const year = today.getFullYear();
  const half = today.getMonth() < 6 ? 1 : 2;

  for (const baseline of baselines) {
    // DAILY: current year and half
    if (rebuildDaily) {
      try {
        const timeframe: 'DAILY' = 'DAILY';
        const params = { year, half };
        const dateRange = getShardDateRange(timeframe, params);
        const shardId = getShardId(timeframe, params);
        const docId = getShardDocId(baseline, timeframe, params);
        const snapshot = await generateShardSnapshot(baseline, timeframe, dateRange, shardId);
        await db.collection(HEATMAP_SNAPSHOTS_COLLECTION).doc(docId).set(snapshot, { merge: false });
        results.push({ baseline, timeframe, ok: true, docId });
      } catch (e: any) {
        results.push({ baseline, timeframe: 'DAILY', ok: false, message: e?.message });
      }
    }

    // WEEKLY: 2-year shards
    if (rebuildWeekly) {
      try {
        const timeframe: 'WEEKLY' = 'WEEKLY';
        const yearStart = year % 2 === 0 ? year - 1 : year;
        const params = { yearStart, yearEnd: yearStart + 1 };
        const dateRange = getShardDateRange(timeframe, params);
        const shardId = getShardId(timeframe, params);
        const docId = getShardDocId(baseline, timeframe, params);
        const snapshot = await generateShardSnapshot(baseline, timeframe, dateRange, shardId);
        await db.collection(HEATMAP_SNAPSHOTS_COLLECTION).doc(docId).set(snapshot, { merge: false });
        results.push({ baseline, timeframe, ok: true, docId });
      } catch (e: any) {
        results.push({ baseline, timeframe: 'WEEKLY', ok: false, message: e?.message });
      }
    }

    // MONTHLY: 4-year rolling window
    if (rebuildMonthly) {
      try {
        const timeframe: 'MONTHLY' = 'MONTHLY';
        const params = { yearStart: year - 3, yearEnd: year };
        const dateRange = getShardDateRange(timeframe, params);
        const shardId = getShardId(timeframe, params);
        const docId = getShardDocId(baseline, timeframe, params);
        const snapshot = await generateShardSnapshot(baseline, timeframe, dateRange, shardId);
        await db.collection(HEATMAP_SNAPSHOTS_COLLECTION).doc(docId).set(snapshot, { merge: false });
        results.push({ baseline, timeframe, ok: true, docId });
      } catch (e: any) {
        results.push({ baseline, timeframe: 'MONTHLY', ok: false, message: e?.message });
      }
    }
  }

  logger.info('bulkRebuildShardsAdmin_complete', { count: results.length });
  return { ok: true, results };
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
    const { baseline, timeframe, year, half, yearStart, yearEnd } = req.data as any;

    logger.info('updateHeatmapSnapshotTask_start', {
      baseline,
      timeframe,
      year,
      half,
      yearStart,
      yearEnd,
      attemptNumber: req.retryCount ?? 0,
    });

    try {
      // Determine shard parameters
      const params = { year, half, yearStart, yearEnd };
      const docId = getShardDocId(baseline, timeframe, params);
      const shardId = getShardId(timeframe, params);
      const dateRange = getShardDateRange(timeframe, params);

      logger.info('updateHeatmapSnapshotTask_generating', {
        baseline,
        timeframe,
        docId,
        shardId,
        dateRange,
      });

      // Generate the snapshot
      const generateStartTime = Date.now();
      const snapshot = await generateShardSnapshot(baseline, timeframe as 'DAILY' | 'WEEKLY' | 'MONTHLY', dateRange, shardId);
      const generateDuration = Date.now() - generateStartTime;

      // Write to Firestore
      const writeStartTime = Date.now();
      await db.collection(HEATMAP_SNAPSHOTS_COLLECTION).doc(docId).set(snapshot, { merge: false });
      const writeDuration = Date.now() - writeStartTime;

      const totalDuration = Date.now() - taskStartTime;

      logger.info('updateHeatmapSnapshotTask_success', {
        baseline,
        timeframe,
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

/**
 * Admin callable to delete heatmap snapshot documents in batches.
 * Supports baseline and timeframe filtering for targeted deletion.
 * Much faster than client-side filtering since it runs server-side.
 */
export const deleteHeatmapSnapshotsAdmin = onCall(
  { region: 'us-central1', timeoutSeconds: 540, memory: '512MiB' },
  async (req) => {
    const startTime = Date.now();

    // Validate admin token
    const adminToken = req.data?.adminToken || '';
    const expectedToken = process.env.ADMIN_BACKFILL_TOKEN || 'local-admin';
    if (adminToken !== expectedToken) {
      logger.warn('deleteHeatmapSnapshotsAdmin_unauthorized', { ip: req.rawRequest?.ip });
      throw new Error('Unauthorized: invalid admin token');
    }

    // Parse parameters
    const baselinesRaw = Array.isArray(req.data?.baselines)
      ? req.data.baselines.map((b: any) => String(b).toUpperCase().trim()).filter((b: string) => /^[A-Z]+$/.test(b))
      : [];
    const baselineFilters = baselinesRaw.length > 0 ? baselinesRaw : [];

    const timeframesRaw = Array.isArray(req.data?.timeframes)
      ? req.data.timeframes.map((t: any) => String(t).toUpperCase().trim()).filter((t: string) => /^(DAILY|WEEKLY|MONTHLY)$/.test(t))
      : [];
    const timeframeFilters = timeframesRaw.length > 0 ? timeframesRaw : [];

    const dryRun = Boolean(req.data?.dryRun ?? false);
    const batchSize = 100; // Reduced to avoid 10 MiB transaction size limit

    logger.info('deleteHeatmapSnapshotsAdmin_start', {
      baselineFilters: baselineFilters.length > 0 ? baselineFilters : 'ALL',
      timeframeFilters: timeframeFilters.length > 0 ? timeframeFilters : 'ALL',
      dryRun,
    });

    const collectionRef = db.collection(HEATMAP_SNAPSHOTS_COLLECTION);
    let totalScanned = 0;
    let totalDeleted = 0;
    let totalSkipped = 0;

    try {
      // Query all docs (no server-side filtering by doc ID available)
      const snapshot = await collectionRef.get();
      totalScanned = snapshot.size;

      // Filter and batch delete
      const toDelete: FirebaseFirestore.DocumentReference[] = [];

      for (const doc of snapshot.docs) {
        const docId = doc.id;

        // Apply baseline filters if specified
        if (baselineFilters.length > 0) {
          const matchesBaseline = baselineFilters.some((b: string) => docId.startsWith(`${b}-`));
          if (!matchesBaseline) {
            totalSkipped++;
            continue;
          }
        }

        // Apply timeframe filters if specified
        if (timeframeFilters.length > 0) {
          const matchesTimeframe = timeframeFilters.some((tf: string) => docId.includes(`-${tf}-`));
          if (!matchesTimeframe) {
            totalSkipped++;
            continue;
          }
        }

        toDelete.push(doc.ref);
      }

      // Delete in batches
      if (!dryRun && toDelete.length > 0) {
        for (let i = 0; i < toDelete.length; i += batchSize) {
          const batch = db.batch();
          const chunk = toDelete.slice(i, i + batchSize);
          for (const docRef of chunk) {
            batch.delete(docRef);
          }
          await batch.commit();
          totalDeleted += chunk.length;
          logger.info('deleteHeatmapSnapshotsAdmin_batch', {
            batchNumber: Math.floor(i / batchSize) + 1,
            deletedInBatch: chunk.length,
            totalDeleted,
          });
        }
      } else {
        totalDeleted = toDelete.length;
      }

      const durationMs = Date.now() - startTime;

      logger.info('deleteHeatmapSnapshotsAdmin_complete', {
        totalScanned,
        totalDeleted,
        totalSkipped,
        dryRun,
        durationMs,
      });

      return {
        ok: true,
        scanned: totalScanned,
        deleted: totalDeleted,
        skipped: totalSkipped,
        dryRun,
        durationMs,
        baselineFilters: baselineFilters.length > 0 ? baselineFilters : ['ALL'],
        timeframeFilters: timeframeFilters.length > 0 ? timeframeFilters : ['ALL'],
      };
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      logger.error('deleteHeatmapSnapshotsAdmin_error', {
        message: e?.message,
        stack: e?.stack,
        durationMs,
      });
      throw e;
    }
  },
);
