import { RsPhase } from '../types/partner';
import { logger } from 'firebase-functions/v2';

import { writeUnifiedSeries } from './pairs-writer';

import { buildPhaseSeries } from './rs-series';
import { fetchDailyBarsRange } from './symbol-fetch';

import { FIXED_DAYS, FIXED_LIMIT, FIXED_INTERVAL } from './webhooks-config';

import { SILENCE_ADMIN_INFO } from './webhooks-config';
import { forEachWithConcurrency } from './partner-webhooks';

import { ActivityEventKind, ActivityEventState, Interval, RsSource, type ActivityEvent } from '../types/signal.types';
import { upsertSignalsActivityForPair, upsertSignalsActivityRoot } from './signals-activity-writer';

import { runCanonicalRsEngineForPair, type PhaseSeriesPointWithMetrics } from './rs-canonical-engine';
import { applyRsEventsForPair } from './rs-events-consumer';

import { appendRootPositionTimelineUpdate } from './positions-manager';

import {
  RS_OPEN_LONG_THRESHOLD,
  RS_CLOSE_LONG_THRESHOLD,
  RS_OPEN_SHORT_THRESHOLD,
  RS_CLOSE_SHORT_THRESHOLD,
} from './webhooks-config';

interface BackfillSignalsPipelinePairResult {
  pair: string;
  opens?: number;
  closes?: number;
  activityDays: number;
}

interface ArchiveBackfillForPairsOptions {
  pairs: string[];
  from: string;
  to: string;
  phase: RsPhase;
  intervals: Interval[];
  days: number;
  limit: number;
  concurrency: number;
}

interface SignalsBackfillForPairsOptions {
  pairs: string[];
  from: string;
  to: string;
  phase: RsPhase;
  intervals: Interval[];
}

/**
 * Internal helper: archive backfill (D/W/M) for a concrete set of pairs.
 *
 * This is a specialized variant of recomputeRegisteredBackfill that:
 * - operates only on the provided pairs ("BASE-TARG" ids)
 * - assumes a single phase (typically POST)
 */
async function runArchiveBackfillForPairs(opts: ArchiveBackfillForPairsOptions): Promise<void> {
  const { pairs, from, to, phase, intervals, concurrency } = opts;
  if (!pairs || pairs.length === 0) return;

  const parsedPairs = pairs
    .map((id) => {
      const [baseline, target] = String(id || '').split('-', 2).map((s) => s.trim().toUpperCase());
      return baseline && target ? { baseline, target } : undefined;
    })
    .filter((p): p is { baseline: string; target: string } => !!p);

  if (parsedPairs.length === 0) return;

  if (!SILENCE_ADMIN_INFO) {
    logger.info('runArchiveBackfillForPairs_start', {
      phase,
      from,
      to,
      intervals,
      pairs: parsedPairs.length,
    });
  }

  const includeDaily = intervals.includes(Interval.DAILY);
  const includeWeekly = intervals.includes(Interval.WEEKLY);
  const includeMonthly = intervals.includes(Interval.MONTHLY);

  // Helper: compute a padded-from date for an interval so RS has enough history.
  const padFromForInterval = (fromVal: string | undefined, interval: Interval): string | undefined => {
    if (!fromVal) return fromVal;
    const base = new Date(`${fromVal}T00:00:00.000Z`);
    if (Number.isNaN(base.getTime())) return fromVal;

    if (interval === Interval.DAILY) {
      const padDays = 10; // enough to cover 5 trading days across weekends/holidays
      const padded = new Date(base.getTime() - padDays * 24 * 60 * 60 * 1000);
      const y = padded.getUTCFullYear();
      const m = String(padded.getUTCMonth() + 1).padStart(2, '0');
      const d = String(padded.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    if (interval === Interval.WEEKLY) {
      const padDays = 35; // approx 5 weeks
      const padded = new Date(base.getTime() - padDays * 24 * 60 * 60 * 1000);
      const y = padded.getUTCFullYear();
      const m = String(padded.getUTCMonth() + 1).padStart(2, '0');
      const d = String(padded.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    if (interval === Interval.MONTHLY) {
      const padMonths = 5; // 5 prior months for RS warmup
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

  const symbolBarsCache = new Map<string, any[]>();

  const fetchBackfillBars = async (symbol: string): Promise<any[]> => {
    const baseFrom = from;
    const baseTo = to;

    let paddedFrom = padFromForInterval(baseFrom, Interval.DAILY);
    try {
      if (!paddedFrom) paddedFrom = baseFrom;
    } catch {
      paddedFrom = baseFrom;
    }

    const effectiveTo = baseTo;

    return await fetchDailyBarsRange(symbol, {
      from: paddedFrom,
      to: effectiveTo,
      interval: FIXED_INTERVAL,
    });
  };

  let writtenDays = 0;

  await forEachWithConcurrency(parsedPairs, Math.max(1, concurrency), async ({ baseline, target }) => {
    const pairId = `${baseline}-${target}`;
    let pairWrittenDays = 0;
    let pairDailyDays = 0;
    let pairWeeklyDays = 0;
    let pairMonthlyDays = 0;

    try {
      // Fetch/cached baseline bars
      let baseBars = symbolBarsCache.get(baseline);
      if (!baseBars) {
        baseBars = await fetchBackfillBars(baseline);
        symbolBarsCache.set(baseline, baseBars);
      }

      // Fetch/cached target bars
      let targetBars = symbolBarsCache.get(target);
      if (!targetBars) {
        targetBars = await fetchBackfillBars(target);
        symbolBarsCache.set(target, targetBars);
      }

      let series = buildPhaseSeries(baseBars, targetBars, phase, baseline, target, logger, { from, to });

      if (from || to) {
        const lower = from ? String(from).slice(0, 10) : '0000-01-01';
        const upper = to
          ? String(to).slice(0, 10)
          : (() => {
              const today = new Date();
              return `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
            })();
        series = series.filter((p) => p.day >= lower && p.day <= upper);
      }

      let entries = series;

      if (includeDaily && entries.length > 0) {
        await writeUnifiedSeries(baseline, target, phase, entries, baseBars, targetBars, Interval.DAILY);
        writtenDays += entries.length;
        pairWrittenDays += entries.length;
        pairDailyDays += entries.length;
      }

      if (includeWeekly) {
        try {
          const lower = from ? String(from).slice(0, 10) : '0000-01-01';
          const upper = to
            ? String(to).slice(0, 10)
            : (() => {
                const today = new Date();
                return `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
              })();

          const paddedFromWeekly = padFromForInterval(from, Interval.WEEKLY) ?? from ?? lower;
          const baseWeekly = await fetchDailyBarsRange(baseline, { from: paddedFromWeekly, to, interval: Interval.WEEKLY });
          const targetWeekly = await fetchDailyBarsRange(target, { from: paddedFromWeekly, to, interval: Interval.WEEKLY });
          let weeklySeries = buildPhaseSeries(baseWeekly, targetWeekly, phase, baseline, target, logger, { from, to });
          weeklySeries = weeklySeries.filter((p) => p.day >= lower && p.day <= upper);

          if (weeklySeries.length > 0) {
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

            await writeUnifiedSeries(baseline, target, phase, weeklySeries, baseWeekly, targetWeekly, Interval.WEEKLY, windowToDay);
            writtenDays += weeklySeries.length;
            pairWrittenDays += weeklySeries.length;
            pairWeeklyDays += weeklySeries.length;
          }
        } catch (e: any) {
          logger.warn('runArchiveBackfillForPairs_weekly_failed', { pair: pairId, message: e?.message });
        }
      }

      if (includeMonthly) {
        try {
          const lower = from ? String(from).slice(0, 10) : '0000-01-01';
          const upper = to
            ? String(to).slice(0, 10)
            : (() => {
                const today = new Date();
                return `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
              })();

          const paddedFromMonthly = padFromForInterval(from, Interval.MONTHLY) ?? from ?? lower;
          const baseMonthly = await fetchDailyBarsRange(baseline, { from: paddedFromMonthly, to, interval: Interval.MONTHLY });
          const targetMonthly = await fetchDailyBarsRange(target, { from: paddedFromMonthly, to, interval: Interval.MONTHLY });
          let monthlySeries = buildPhaseSeries(baseMonthly, targetMonthly, phase, baseline, target, logger, { from, to });
          monthlySeries = monthlySeries.filter((p) => p.day >= lower && p.day <= upper);

          if (monthlySeries.length > 0) {
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

            await writeUnifiedSeries(baseline, target, phase, monthlySeries, baseMonthly, targetMonthly, Interval.MONTHLY, windowToDay);
            writtenDays += monthlySeries.length;
            pairWrittenDays += monthlySeries.length;
            pairMonthlyDays += monthlySeries.length;
          }
        } catch (e: any) {
          logger.warn('runArchiveBackfillForPairs_monthly_failed', { pair: pairId, message: e?.message });
        }
      }

      if (!SILENCE_ADMIN_INFO) {
        logger.info('runArchiveBackfillForPairs_pair_summary', {
          pair: pairId,
          phase,
          from,
          to,
          intervals,
          dailyDays: pairDailyDays,
          weeklyDays: pairWeeklyDays,
          monthlyDays: pairMonthlyDays,
          totalDays: pairWrittenDays,
        });
      }
    } catch (e: any) {
      logger.warn('runArchiveBackfillForPairs_pair_failed', { pair: pairId, message: e?.message });
    }
  });

  if (!SILENCE_ADMIN_INFO) {
    logger.info('runArchiveBackfillForPairs_done', {
      phase,
      from,
      to,
      intervals,
      pairs: parsedPairs.length,
      writtenDays,
    });
  }
}

/**
 * Internal helper: signals/activity/positions backfill from archive for specific pairs.
 *
 * Specialized variant of backfillSignalsPipelineAdmin that works directly with a
 * caller-provided list of pair ids.
 */
async function runSignalsBackfillForPairs(opts: SignalsBackfillForPairsOptions): Promise<void> {
  const { pairs, from, to, phase, intervals } = opts;
  if (!pairs || pairs.length === 0) return;

  const includeDaily = intervals.includes(Interval.DAILY);
  const includeWeekly = intervals.includes(Interval.WEEKLY);
  const includeMonthly = intervals.includes(Interval.MONTHLY);

  const fromDay = from;
  const toDay = to;

  const padFromForInterval = (fromVal: string, interval: Interval): string => {
    const base = new Date(`${fromVal}T00:00:00.000Z`);
    if (Number.isNaN(base.getTime())) return fromVal;

    if (interval === Interval.WEEKLY) {
      const padDays = 35;
      const padded = new Date(base.getTime() - padDays * 24 * 60 * 60 * 1000);
      const y = padded.getUTCFullYear();
      const m = String(padded.getUTCMonth() + 1).padStart(2, '0');
      const d = String(padded.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    if (interval === Interval.MONTHLY) {
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

  const buildArchivePhaseSeriesForInterval = async (
    baseline: string,
    target: string,
    interval: Interval,
    phaseForSeries: RsPhase,
    fromVal: string,
    toVal: string,
  ): Promise<PhaseSeriesPointWithMetrics[]> => {
    const paddedFrom = padFromForInterval(fromVal, interval);
    const baseBars = await fetchDailyBarsRange(baseline, { from: paddedFrom, to: toVal, interval });
    const targetBars = await fetchDailyBarsRange(target, { from: paddedFrom, to: toVal, interval });
    let series = buildPhaseSeries(baseBars, targetBars, phaseForSeries, baseline, target, logger, { from: fromVal, to: toVal });
    series = series.filter((p) => p.day >= fromVal && p.day <= toVal);
    return series as unknown as PhaseSeriesPointWithMetrics[];
  };

  let processedPairs = 0;
  const totalPairs = pairs.length;
  const logEvery = Math.max(1, Math.min(10, Math.floor(totalPairs / 5) || 1));

  for (const pair of pairs) {
    const [baseline, target] = pair.split('-', 2);
    if (!baseline || !target) continue;

    const engineActivityByDay = new Map<string, ActivityEvent[]>();
    const openActivityPositionIds = new Set<string>();

    let dailySeriesForEngine: PhaseSeriesPointWithMetrics[] | undefined;
    let weeklySeriesForEngine: PhaseSeriesPointWithMetrics[] | undefined;
    let monthlySeriesForEngine: PhaseSeriesPointWithMetrics[] | undefined;

    if (includeDaily) {
      dailySeriesForEngine = await buildArchivePhaseSeriesForInterval(baseline, target, Interval.DAILY, phase, fromDay, toDay);
    }

    if (includeWeekly) {
      weeklySeriesForEngine = await buildArchivePhaseSeriesForInterval(baseline, target, Interval.WEEKLY, phase, fromDay, toDay);
    }

    if (includeMonthly) {
      monthlySeriesForEngine = await buildArchivePhaseSeriesForInterval(baseline, target, Interval.MONTHLY, phase, fromDay, toDay);
    }

    try {
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

      const seriesContext = {
        daily: includeDaily && dailySeriesForEngine ? dailySeriesForEngine : [],
        weekly: includeWeekly ? weeklySeriesForEngine : undefined,
        monthly: includeMonthly ? monthlySeriesForEngine : undefined,
      };

      const { writes, activity } = await runCanonicalRsEngineForPair(
        pair,
        baseline,
        target,
        logger,
        seriesContext,
        engineThresholds,
      );

      if (writes.length > 0) {
        await applyRsEventsForPair(writes);
      }

      const dailyPriceByDay = new Map<string, number>();
      if (dailySeriesForEngine) {
        for (const p of dailySeriesForEngine) {
          const dayKey = String(p.day).slice(0, 10);
          dailyPriceByDay.set(dayKey, p.targetClose);
        }
      }

      const weeklyPriceByDay = new Map<string, number>();
      if (weeklySeriesForEngine) {
        for (const p of weeklySeriesForEngine) {
          const dayKey = String(p.day).slice(0, 10);
          weeklyPriceByDay.set(dayKey, p.targetClose);
        }
      }

      const monthlyPriceByDay = new Map<string, number>();
      if (monthlySeriesForEngine) {
        for (const p of monthlySeriesForEngine) {
          const dayKey = String(p.day).slice(0, 10);
          monthlyPriceByDay.set(dayKey, p.targetClose);
        }
      }

      for (const ev of activity) {
        const rawDay = (ev as any).day as string | undefined;
        const day = String(rawDay || '').slice(0, 10);
        if (!day) continue;
        const promoted: ActivityEvent = {
          ...ev,
          day,
          state: ActivityEventState.FINAL,
        };

        if (promoted.kind === ActivityEventKind.OPEN) {
          openActivityPositionIds.add(promoted.positionId);
        } else if (promoted.kind === ActivityEventKind.HOLD && !openActivityPositionIds.has(promoted.positionId)) {
          continue;
        }

        const list = engineActivityByDay.get(day) ?? [];
        list.push(promoted);
        engineActivityByDay.set(day, list);

        if (promoted.kind === ActivityEventKind.HOLD) {
          let price: number | undefined;

          if (promoted.interval === Interval.DAILY) {
            price = dailyPriceByDay.get(day);
          } else if (promoted.interval === Interval.WEEKLY) {
            price = weeklyPriceByDay.get(day);
          } else if (promoted.interval === Interval.MONTHLY) {
            price = monthlyPriceByDay.get(day);
          }

          if (Number.isFinite(price)) {
            const ts = new Date(`${day}T00:00:00Z`).getTime();
            try {
              await appendRootPositionTimelineUpdate({
                positionId: promoted.positionId,
                day,
                timestamp: ts,
                price: price as number,
                rsRaw: promoted.rsRaw,
                rsNorm: promoted.rsNorm,
                prevRsRaw: promoted.prevRsRaw ?? promoted.rsRaw,
                prevRsNorm: promoted.prevRsNorm ?? promoted.rsNorm,
                source: RsSource.POST,
              });
            } catch {
              // best-effort; do not fail the entire pair on timeline update issues
            }
          }
        }
      }

      for (const [day, evs] of engineActivityByDay.entries()) {
        await upsertSignalsActivityForPair(pair, day, evs);
        await upsertSignalsActivityRoot(day, evs);
      }
    } catch (e: any) {
      logger.warn('runSignalsBackfillForPairs_pair_failed', { pair, message: e?.message });
    }

        const pairSummary: BackfillSignalsPipelinePairResult = {
      pair,
      activityDays: engineActivityByDay.size,
    };

    if (!SILENCE_ADMIN_INFO) {
      logger.info('runSignalsBackfillForPairs_pair_done', {
        pair,
        baseline,
        target,
        from: fromDay,
        to: toDay,
        phase,
        intervals,
        activityDays: pairSummary.activityDays,
      });
    }

    processedPairs++;
    if (!SILENCE_ADMIN_INFO && (processedPairs % logEvery === 0 || processedPairs === totalPairs)) {
      logger.info('runSignalsBackfillForPairs_progress', {
        from,
        to,
        phase,
        intervals,
        processedPairs,
        totalPairs,
      });
    }
  }

  if (!SILENCE_ADMIN_INFO) {
    logger.info('runSignalsBackfillForPairs_done', {
      from,
      to,
      phase,
      intervals,
      pairs: totalPairs,
    });
  }
}

/**
 * Exported helper: run full archive (D/W/M) backfill followed by
 * signals/activity/positions backfill for a specific set of pairs over a
 * concrete [from,to] window.
 */
export async function runFullBackfillForPairs(pairs: string[], from: string, to: string): Promise<void> {
  if (!pairs || pairs.length === 0) return;

  const phase = RsPhase.POST;
  const intervals: Interval[] = [Interval.DAILY, Interval.WEEKLY, Interval.MONTHLY];
  const days = FIXED_DAYS;
  const limit = FIXED_LIMIT;
  const concurrency = Number(process.env.PARTNER_PAIR_CONCURRENCY) || 3;

  await runArchiveBackfillForPairs({ pairs, from, to, phase, intervals, days, limit, concurrency });
  await runSignalsBackfillForPairs({ pairs, from, to, phase, intervals });
}