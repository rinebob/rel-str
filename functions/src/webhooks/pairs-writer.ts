import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase-admin-init';
import type { PhaseSeriesPoint, PartnerBar } from './webhooks-config';
import { ARCHIVE_COLLECTION_PREFIX, MONTHLY_ARCHIVE_COLLECTION_PREFIX, PAIRS_COLLECTION, SILENCE_RS_SERIES_INFO, WEEKLY_ARCHIVE_COLLECTION_PREFIX } from './webhooks-config';
import { RsPhase } from '../types/partner';
import { logger } from 'firebase-functions/v2';
import { RsCloudFunctionName, SILENCE_MISSING_POST_TIME } from './webhooks-config';
import { persistWarning } from '../logging/warn';
import { Interval } from '../types/signal.types';

/**
 * Write unified RS series for a pair into Firestore (pairs-data schema).
 *
 * Document path: pairs-data/{BASELINE}-{TARGET}
 * Canonical root shape:
 * {
 *   meta: { baseline, symbol, interval, window },
 *   lastUpdatedAt: Timestamp,
 *   latestDaily?: { day, dow, pre?{}, post?{} },
 *   latestWeekly?: { day, dow, post?{} },
 *   latestMonthly?: { day, dow, post?{} },
 * }
 *
 * Notes:
 * - Pre phase computes change/percentChange versus prior-day post-close adjusted close (ac).
 * - Post phase also computes versus prior-day post-close (ac, fallback c).
 * - Retention: limited to meta.window elements (default 30) from the tail.
 * - Upsert: per-day entries merged; existing other phase preserved when one phase updates.
 * - Archive shards under `pairs-data/{PAIR}/archive-YYYY/{YYMMDD}` and interval variants
 *   (`archive-weekly-YYYY`, `archive-monthly-YYYY`) are the authoritative store for FE
 *   consumption and for the canonical RS engine.
 */
export async function writeUnifiedSeries(
  baseline: string,
  target: string,
  phase: RsPhase,
  entries: PhaseSeriesPoint[],
  baselineBars: PartnerBar[],
  targetBars: PartnerBar[],
  interval: Interval = Interval.DAILY,
  windowToDay?: string,
): Promise<void> {
  if (entries.length === 0) return;
  const pairId = `${baseline}-${target}`;
  const pairRef = db.collection(PAIRS_COLLECTION).doc(pairId);

  const snap = await pairRef.get();
  const existing = (snap.exists ? (snap.data() as any) : {}) || {};
  const existingMeta: any = (existing.meta as any) || {};

  // Resolve desired storage window
  const envWindowRaw = Number(process.env.RS_WINDOW);
  const envWindow = Number.isFinite(envWindowRaw) && envWindowRaw > 0 ? envWindowRaw : undefined;
  const existingWindowRaw = Number(existingMeta?.window);
  const existingWindow = Number.isFinite(existingWindowRaw) && existingWindowRaw > 0 ? existingWindowRaw : undefined;
  const desiredWindow = Math.max(existingWindow ?? 0, envWindow ?? 0, 30);

  const meta = {
    baseline,
    symbol: target,
    // Interval is now multi-interval; keep existing value if present but do not rely on it for writes.
    interval: existingMeta?.interval ?? Interval.DAILY,
    // Use the larger of existing window and RS_WINDOW so backfills can expand retention
    window: desiredWindow,
  };

  // ============ Helpers ============
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
    const dow = new Date(dayStr + 'T00:00:00.000Z').getUTCDay();
    return dow === 0 || dow === 6;
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

  // Frontend V1-inspired RS rank calculation
  // COMPARISON_MATRICES from FE (rs.constants.ts)
  const COMPARISON_MATRICES: string[] = [
    '00000','00001','00010','00011','00100','00101','00110','00111',
    '01000','01001','01010','01011','01100','01101','01110','01111',
    '10000','10001','10010','10011','10100','10101','10110','10111',
    '11000','11001','11010','11011','11100','11101','11110','11111',
  ];

  // Build day->percentChange map anchored to prior-day post-close for both base and target
  const pctByDay = (bars: PartnerBar[]): Map<string, number> => {
    const out = new Map<string, number>();
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const d = b?.d;
      if (!d) continue;
      // Use adjusted close (ac) when present; fallback to c
      const today = Number(b?.ac ?? b?.c ?? 0);
      // Find prior trading day's post-close
      let prevIdx = i - 1;
      let prev: PartnerBar | undefined;
      while (prevIdx >= 0 && !prev) {
        const pd = bars[prevIdx]?.d;
        if (pd && !isWeekend(pd)) prev = bars[prevIdx];
        prevIdx--;
      }
      const prevClose = Number(prev?.ac ?? prev?.c ?? 0);
      const pct = prevClose > 0 ? ((today - prevClose) / prevClose) * 100 : 0;
      out.set(d, Number(pct.toFixed(6)));
    }
    return out;
  };

  const basePctByDay = pctByDay(baselineBars);
  const targetPctByDay = pctByDay(targetBars);

  // Calculate metrics for a day using 5-day window and matrices
  // - rsNorm: discrete rank in (0,1] with 1/32 steps (legacy, used for color bins)
  // - rsRaw:  continuous score in [0,1] via min–max normalization of the target (11111) outcome sum across all matrices
  // If metrics cannot be computed (insufficient history, alignment issues, etc.),
  // return an empty object so callers can treat RS as "missing" instead of 0.
  function calculateMetricsForDay(day: string): { rsNorm?: number; rsRaw?: number } {
    const bi = baseIndexByDay.get(day);
    const ti = targetIndexByDay.get(day);
    if (bi === undefined || ti === undefined) return {};

    // Collect last 5 trading days including current if available
    const collectLast5 = (bars: PartnerBar[], startIdx: number): number[] => {
      const arr: number[] = [];
      let idx = startIdx;
      while (idx >= 0 && arr.length < 5) {
        const d = bars[idx]?.d;
        if (d && !isWeekend(d)) {
          arr.push((bars === baselineBars ? basePctByDay : targetPctByDay).get(d) ?? 0);
        }
        idx--;
      }
      // reverse to chronological order
      return arr.reverse();
    };

    let baseWin = collectLast5(baselineBars, bi);
    let targWin = collectLast5(targetBars, ti);
    if (baseWin.length < 5 || targWin.length < 5) return {}; // insufficient history

    // Apply V1 ranking logic
    const outcomes: Array<[string, number]> = [];
    for (const matrix of COMPARISON_MATRICES) {
      const bits = matrix.split('');
      const values: number[] = [];
      for (let j = 0; j < bits.length; j++) {
        const useTarget = bits[j] === '1';
        const v = useTarget ? targWin[j] : baseWin[j];
        values.push(v);
      }
      const sum = Number(values.reduce((acc, v) => acc + v, 0).toFixed(4));
      outcomes.push([matrix, sum]);
    }
    outcomes.sort((a, b) => (a[1] > b[1] ? 1 : a[1] < b[1] ? -1 : 0));
    const idx = outcomes.findIndex(([m]) => m === '11111');
    if (idx < 0) return {};

    // Continuous min–max normalization using the sums domain
    const minSum = outcomes[0][1];
    const maxSum = outcomes[outcomes.length - 1][1];
    const targetSum = outcomes[idx][1];
    const rsRaw = Number(
      (maxSum - minSum) !== 0 ? ((targetSum - minSum) / (maxSum - minSum)).toFixed(6) : '0'
    );

    // Discrete bucket: nearest 1/32 step to rsRaw in (0,1]
    const step = 1 / COMPARISON_MATRICES.length; // 1/32 = 0.03125
    const rawIndex = Math.round(rsRaw / step) - 1;
    const bucketIndex = Math.min(COMPARISON_MATRICES.length - 1, Math.max(0, rawIndex));
    const rsNorm = Number(((bucketIndex + 1) * step).toFixed(6));

    return { rsNorm, rsRaw };
  }

  // ============ Merge and write ============
  // If there are no entries for this interval, nothing to write.
  if (entries.length === 0) {
    return;
  }

  const byDay = new Map<string, any>();

  // Build the per-day map from the full series so that latestDaily/latestWeekly/latestMonthly
  // reflect the most recent bar (including intra-period runs).
  for (const e of entries) {
    const dayObj = byDay.get(e.day) || { day: e.day, dow: e.dow };

    // Price-based deltas vs prior-day post-close (for display/debug)
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

    // Calculate RS metrics
    const metrics = calculateMetricsForDay(e.day);
    const hasRs = Number.isFinite(metrics?.rsNorm) && Number.isFinite(metrics?.rsRaw);

    if (hasRs && ((metrics!.rsNorm ?? 0) === 0 || (metrics!.rsRaw ?? 0) === 0)) {
      if (!SILENCE_RS_SERIES_INFO) {
        logger.warn('rs_series_zero_value', {
          pairId,
          phase,
          day: e.day,
          rsNorm: metrics!.rsNorm,
          rsRaw: metrics!.rsRaw,
        });
      }
      try {
        void persistWarning('rs_series_zero_value', {
          function: RsCloudFunctionName.WRITE_UNIFIED_SERIES,
          pairId,
          phase,
          day: e.day,
          rsNorm: metrics!.rsNorm,
          rsRaw: metrics!.rsRaw,
        });
      } catch {}
    }

    // Respect upstream times; if missing, omit time and log
    const preTime = (typeof e.it === 'string' && e.it.length > 0) ? e.it : undefined;

    if (phase === RsPhase.PRE) {
      dayObj.pre = {
        ...(preTime ? { time: preTime } : {}),
        base: { price: e.baseClose, change: Number(baseChange.toFixed(6)), percentChange: Number(basePct.toFixed(6)) },
        target: { price: e.targetClose, change: Number(targetChange.toFixed(6)), percentChange: Number(targetPct.toFixed(6)) },
        ...(hasRs ? {
          rs: metrics!.rsNorm,       // legacy field (kept for compatibility)
          rsNorm: metrics!.rsNorm,   // explicit normalized rank for color bins
          rsRaw: metrics!.rsRaw,     // continuous value for display
        } : {}),
        source: 'intraday',
      };
      if (!preTime) {
        logger.warn('missing_intraday_time_it_on_pre', { pairId, day: e.day });
        await persistWarning('missing_intraday_time_it_on_pre', {
          function: RsCloudFunctionName.WRITE_UNIFIED_SERIES,
          pairId,
          phase: RsPhase.PRE,
          day: e.day,
        });
      }
    } else {
      dayObj.post = {
        ...(typeof e.it === 'string' && e.it.length > 0 ? { time: e.it } : {}),
        base: { price: e.baseClose, change: Number(baseChange.toFixed(6)), percentChange: Number(basePct.toFixed(6)) },
        target: { price: e.targetClose, change: Number(targetChange.toFixed(6)), percentChange: Number(targetPct.toFixed(6)) },
        ...(hasRs ? {
          rs: metrics!.rsNorm,
          rsNorm: metrics!.rsNorm,
          rsRaw: metrics!.rsRaw,
        } : {}),
        source: 'raw close',
      };
      if (!(dayObj.post as any).time) {
        if (!SILENCE_MISSING_POST_TIME) {
          logger.warn('missing_close_time_on_post', { pairId, day: e.day });
          await persistWarning('missing_close_time_on_post', {
            function: RsCloudFunctionName.WRITE_UNIFIED_SERIES,
            pairId,
            phase: RsPhase.POST,
            day: e.day,
          });
        }
      }
    }

    byDay.set(e.day, dayObj);
  }

  const merged = Array.from(byDay.values()).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const latest = merged[merged.length - 1];

  // Build latest payload for this interval
  const latestPayload: any = {
    day: latest?.day,
    dow: latest?.dow,
  };
  if (latest?.pre) latestPayload.pre = latest.pre;
  if (latest?.post) latestPayload.post = latest.post;

  const rootPatch: any = {
    meta,
    lastUpdatedAt: FieldValue.serverTimestamp(),
  };

  if (interval === Interval.DAILY) {
    rootPatch.latestDaily = latestPayload;
  } else if (interval === Interval.WEEKLY) {
    rootPatch.latestWeekly = latestPayload;
  } else if (interval === Interval.MONTHLY) {
    rootPatch.latestMonthly = latestPayload;
  }

  await pairRef.set(rootPatch, { merge: true });

  // ===== Archive upserts: pairs-data/{PAIR}/archive-YYYY/{YYMMDD} and interval variants
  const batch = db.batch();
  const previewItems: Array<{ archiveCol: string; docId: string; dayDoc: any }> = [];

  // SA monthly/weekly bars are already end-of-interval (one bar per month/week),
  // so we can write all entries directly to the appropriate archive collection.
  const archiveEntries: PhaseSeriesPoint[] = entries;

  try {
    logger.info('rs_series_archive_plan', {
      pairId,
      interval,
      phase,
      latestDay: latest?.day,
      archiveEntryDays: archiveEntries.map(e => e.day).slice(0, 12),
      totalArchiveEntries: archiveEntries.length,
    });
  } catch {}

  // For WEEKLY/MONTHLY runs, emit an explicit log of all days being written so
  // diagnostics and manual checks can confirm whether specific closes are
  // present in the write set.
  try {
    if (interval === Interval.WEEKLY) {
      logger.info('archive_weekly_upsert_days', {
        pairId,
        phase,
        count: archiveEntries.length,
        days: archiveEntries.map(e => e.day),
      });
    } else if (interval === Interval.MONTHLY) {
      logger.info('archive_monthly_upsert_days', {
        pairId,
        phase,
        count: archiveEntries.length,
        days: archiveEntries.map(e => e.day),
      });
    }
  } catch {}

  for (const e of archiveEntries) {
    const y = String(e.day).slice(0, 4);
    const yy = y.slice(2);
    const yymmdd = `${yy}${e.day.slice(5,7)}${e.day.slice(8,10)}`; // YYMMDD

    let archiveCol: string;
    if (interval === Interval.DAILY) {
      archiveCol = `${ARCHIVE_COLLECTION_PREFIX}${y}`; // e.g., archive-2025
    } else if (interval === Interval.WEEKLY) {
      archiveCol = `${WEEKLY_ARCHIVE_COLLECTION_PREFIX}${y}`; // e.g., archive-weekly-2025
    } else {
      archiveCol = `${MONTHLY_ARCHIVE_COLLECTION_PREFIX}${y}`; // e.g., archive-monthly-2025
    }
    const archiveRef = pairRef.collection(archiveCol).doc(yymmdd);

    const existingDay = byDay.get(e.day);
    const dayDoc: any = { day: existingDay.day, dow: existingDay.dow };
    if (existingDay.pre) {
      const { time, base, target, rsNorm, rsRaw, source } = existingDay.pre;
      dayDoc.pre = { time, base, target, rsNorm, rsRaw, source };
    }
    if (existingDay.post) {
      const { time, base, target, rsNorm, rsRaw, source } = existingDay.post;
      dayDoc.post = { time, base, target, rsNorm, rsRaw, source };
    }

    // Weekly/monthly interval close flags are set only on POST. We always
    // write archive docs for all SA bars and rely on overwrites to keep
    // the latest state rather than skipping in-progress intervals.
    if (interval !== Interval.DAILY && phase === RsPhase.POST) {
      dayDoc.isIntervalClose = true;
    }

    batch.set(archiveRef, dayDoc, { merge: false });
    if (previewItems.length < 3) {
      try { previewItems.push({ archiveCol, docId: yymmdd, dayDoc }); } catch {}
    }
  }
  try {
    logger.info('archive_upsert_preview', { pairId, phase, count: entries.length, items: previewItems });
    logger.info('archive_upsert_preview data: ' + JSON.stringify({ pairId, phase, count: entries.length, items: previewItems }).slice(0, 2000));
  } catch {}
  await batch.commit();
  try {
    logger.info('archive_upsert_committed', { pairId, phase, count: entries.length, daysFirst10: entries.map(e => e.day).slice(0,10) });
  } catch {}

  logger.info(`archive_write_done ${pairId} phase=${phase} days=${merged.length} latestDay=${latest?.day} (archive upserts=${entries.length})`);
}
