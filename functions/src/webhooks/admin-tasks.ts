import { onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { RsPhase } from '../types/partner';
import { logger } from 'firebase-functions/v2';
import { writeWarningsSummary } from '../logging/warn';

import { writeUnifiedSeries } from './pairs-writer';
import { listRegisteredPairs } from './registry';
import { buildCanonicalCalendarForYear } from './calendar';

import { buildPhaseSeries } from './rs-series';
import { fetchDailyBarsRange } from './symbol-fetch';
import { db, FieldValue } from '../firebase-admin-init';

import { FIXED_DAYS, FIXED_LIMIT, ProcessErrorSample, FIXED_INTERVAL, APP_COLLECTION } from './webhooks-config';

import { SILENCE_ADMIN_INFO } from './webhooks-config';
import { forEachWithConcurrency } from './partner-webhooks';

import { ActivityEventKind, ActivityEventState, Interval, RsSource, type ActivityEvent } from '../types/signal.types';
import { upsertSignalsActivityForPair, upsertSignalsActivityRoot } from './signals-activity-writer';

import { runCanonicalRsEngineForPair, type PhaseSeriesPointWithMetrics } from './rs-canonical-engine';
import { applyRsEventsForPair } from './rs-events-consumer';

import { appendRootPositionTimelineUpdate } from './positions-manager';
import { callPartnerMarketHolidays } from '../partner-proxy';

import {
  RS_OPEN_LONG_THRESHOLD,
  RS_CLOSE_LONG_THRESHOLD,
  RS_OPEN_SHORT_THRESHOLD,
  RS_CLOSE_SHORT_THRESHOLD,
} from './webhooks-config';

interface BackfillSignalsPipelinePairResult {
  pair: string;
  opens: number;
  closes: number;
  activityDays: number;
}

/**
 * HTTP (admin): diagnoseRegisteredRangeAdmin
 * Run diagnose (and optional auto-fix) across all registered pairs, grouped by baseline, over a window.
 * Protect with bearer ADMIN_BACKFILL_TOKEN.
 * Query/body: { phase?: PRE|POST, from?: string, to?: string, days?: number }
 */
export const diagnoseRegisteredRangeAdmin = onRequest({ region: 'us-central1', timeoutSeconds: 540 }, async (req, res) => {
  const token = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
  const expected = (process.env.ADMIN_BACKFILL_TOKEN || '').trim();
  if (!expected || token !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  try {
    const phase: RsPhase = (String((req.body?.phase ?? req.query.phase) || RsPhase.POST).toLowerCase() === RsPhase.PRE) ? RsPhase.PRE : RsPhase.POST;
    const from: string | undefined = (req.body?.from ?? req.query.from) as string | undefined;
    const to: string | undefined = (req.body?.to ?? req.query.to) as string | undefined;
    const daysParam = req.body?.days ?? req.query.days;
    const days: number | undefined = daysParam !== undefined ? Number(daysParam) : undefined;

    // Group registered pairs by baseline
    const pairs = await listRegisteredPairs();
    const byBaseline = new Map<string, Set<string>>();
    for (const p of pairs) {
      const base = String(p.baseline || '').toUpperCase();
      const targ = String(p.target || '').toUpperCase();
      if (!base || !targ) continue;
      const set = byBaseline.get(base) ?? new Set<string>();
      set.add(targ);
      byBaseline.set(base, set);
    }

    const summary: any = { ok: true, baselines: byBaseline.size, totalPairs: pairs.length, phase, window: { from: from ?? null, to: to ?? null, days: days ?? null }, results: [] };

    try {
      for (const [baseline, set] of byBaseline.entries()) {
        const symbols = Array.from(set.values());
        const callRes = await diagnosePairDays.run({
          data: { baseline, symbols, phase, from, to },
          auth: undefined,
          instanceIdToken: undefined,
          rawRequest: undefined,
        } as any);
        const ok = (callRes as any)?.ok !== false;
        const results = Array.isArray((callRes as any)?.results) ? (callRes as any).results : [];
        // Aggregate counts of problems remaining
        const agg: Record<string, number> = {};
        let remainingPairs = 0;
        for (const r of results) {
          const probs = Array.isArray((r as any)?.problems) ? (r as any).problems as Array<{ day: string; reason: string }> : [];
          const unresolved = probs.filter(p => p.reason !== 'computed_but_not_stored');
          if (unresolved.length > 0) remainingPairs++;
          for (const p of unresolved) {
            agg[p.reason] = (agg[p.reason] || 0) + 1;
          }
        }
        summary.results.push({ baseline, ok, pairs: symbols.length, remainingPairs, reasons: agg, raw: results.slice(0, 5) });
      }
      await writeWarningsSummary({ function: 'diagnoseRegisteredRangeAdmin', baselines: byBaseline.size, totalPairs: pairs.length });
    } catch (e: any) {
      summary.results.push({ baseline: null, ok: false, error: e?.message || String(e) });
    }

    res.status(200).json(summary);
  } catch (e: any) {
    logger.error('diagnoseRegisteredRangeAdmin_failed', { message: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'internal_error' });
  }
});

/**
 * HTTP (admin): backfillSignalsPipelineAdmin
 * Unified pipeline that, for the given range/pairs/intervals:
 * - Rebuilds canonical DAILY/WEEKLY/MONTHLY signals + positions from archive via the canonical RS engine
 * - Builds Signals Activity (DAILY/WEEKLY/MONTHLY) from the same engine output.
 * Protect with bearer ADMIN_BACKFILL_TOKEN.
 */
export const backfillSignalsPipelineAdmin = onRequest({ region: 'us-central1', timeoutSeconds: 540 }, async (req, res) => {
  const token = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
  const expected = (process.env.ADMIN_BACKFILL_TOKEN || '').trim();
  if (!expected || token !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  try {
    const body = (req.method === 'POST' ? (req.body || {}) : (req.query || {})) as any;
    const from: string = String(body.from || '').slice(0, 10);
    const to: string = String(body.to || '').slice(0, 10);
    if (!from || !to) {
      res.status(400).json({ ok: false, error: 'missing_from_or_to' });
      return;
    }

    const phaseRaw = String(body.phase || RsPhase.POST).toLowerCase();
    const phase: RsPhase = phaseRaw === RsPhase.PRE ? RsPhase.PRE : RsPhase.POST;

    const intervalsRaw = body.intervals as string | string[];
    const normalizeInterval = (v: string): Interval | undefined => {
      const s = String(v || '').toUpperCase();
      if (s === Interval.DAILY || s === Interval.WEEKLY || s === Interval.MONTHLY) {
        return s as Interval;
      }
      return undefined;
    };
    let intervals: Interval[];
    if (Array.isArray(intervalsRaw)) {
      intervals = (intervalsRaw as string[])
        .map((v) => normalizeInterval(v))
        .filter((v): v is Interval => v !== undefined);
    } else if (intervalsRaw !== undefined) {
      const single = normalizeInterval(intervalsRaw);
      intervals = single ? [single] : [];
    } else {
      intervals = [Interval.DAILY, Interval.WEEKLY, Interval.MONTHLY];
    }
    if (intervals.length === 0) {
      intervals = [Interval.DAILY, Interval.WEEKLY, Interval.MONTHLY];
    }

    let pairs: string[] = [];
    if (Array.isArray(body.pairs)) {
      pairs = (body.pairs as any[]).map((p) => String(p || '').trim()).filter(Boolean);
    } else if (typeof body.pair === 'string' && body.pair.trim().length > 0) {
      pairs = [String(body.pair).trim()];
    }
    if (pairs.length === 0) {
      const reg = await listRegisteredPairs();
      pairs = reg.map((p) => `${p.baseline}-${p.target}`);
    }
    if (pairs.length === 0) {
      res.status(200).json({ ok: true, message: 'no pairs to process', from, to, pairs: 0 });
      return;
    }

    const includeDaily = intervals.includes(Interval.DAILY);
    const includeWeekly = intervals.includes(Interval.WEEKLY);
    const includeMonthly = intervals.includes(Interval.MONTHLY);

    if (!SILENCE_ADMIN_INFO) {
      logger.info('backfillSignalsPipelineAdmin_start', {
        from,
        to,
        phase,
        intervals,
        totalPairs: pairs.length,
      });
    }

    const results: BackfillSignalsPipelinePairResult[] = [];

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

      // DAILY and any other intervals use the requested from date without padding.
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
      // Clamp to the exact [from,to] window to avoid leaking padded days.
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

      // Canonical DAILY / WEEKLY / MONTHLY backfill via canonical RS engine using archive RS series.
      let opens = 0;
      let closes = 0;

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
          // Engine expects an array for `daily`; pass empty when DAILY is not requested.
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
          // Derive simple open/close counts for summary from write kinds when available.
          for (const w of writes as any[]) {
            const kind = String((w?.kind ?? w?.type ?? '').toString().toLowerCase());
            if (kind.includes('open')) opens++;
            if (kind.includes('close')) closes++;
          }
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
            // Skip early HOLDs for positions that have not emitted an OPEN in this backfill window.
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
        logger.warn('backfill_canonical_engine_failed', { pair, baseline, target, message: e?.message });
      }

      const pairSummary: BackfillSignalsPipelinePairResult = {
        pair,
        opens,
        closes,
        activityDays: engineActivityByDay.size,
      };

      logger.info('backfillSignalsPipelineAdmin_pair_done', {
        pair,
        baseline,
        target,
        from: fromDay,
        to: toDay,
        phase,
        intervals,
        opens: pairSummary.opens,
        closes: pairSummary.closes,
        activityDays: pairSummary.activityDays,
      });

      results.push(pairSummary);

      processedPairs++;
      if (!SILENCE_ADMIN_INFO && (processedPairs % logEvery === 0 || processedPairs === totalPairs)) {
        logger.info('backfillSignalsPipelineAdmin_progress', {
          from,
          to,
          phase,
          intervals,
          processedPairs,
          totalPairs,
        });
      }
    }

    const summary = { ok: true, from, to, intervals, pairs: results.length, results };
    if (!SILENCE_ADMIN_INFO) {
      logger.info('backfillSignalsPipelineAdmin_done', summary);
      logger.info('backfillSignalsPipelineAdmin_done results', results);
    }
    res.status(200).json(summary);
  } catch (e: any) {
    logger.error('backfillSignalsPipelineAdmin_failed', { message: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'internal_error' });
  }
});

/**
 * HTTP (admin): refreshMarketHolidaysAdmin
 * Fetch US market holidays for a given year from SavantAPI and mirror them into
 * app/market-holidays-US-<year>. Protect with bearer ADMIN_BACKFILL_TOKEN.
 * Query/body: { year: string|number }
 */
export const refreshMarketHolidaysAdmin = onRequest({ region: 'us-central1', timeoutSeconds: 120 }, async (req, res) => {
  const token = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
  const expected = (process.env.ADMIN_BACKFILL_TOKEN || '').trim();
  if (!expected || token !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  try {
    const rawYear = (req.query.year as string) ?? (req.body?.year as string | number | undefined);
    const yearStr = String(rawYear || '').trim();
    const yearNum = Number(yearStr);
    if (!yearStr || !Number.isInteger(yearNum) || yearNum < 1900 || yearNum > 2100) {
      res.status(400).json({ ok: false, error: 'invalid_year', message: 'Expected year=YYYY between 1900 and 2100.' });
      return;
    }

    logger.info('refreshMarketHolidaysAdmin_start', { year: yearNum });

    const upstream = await callPartnerMarketHolidays({ year: yearNum });
    const holidays = Array.isArray(upstream.holidays) ? upstream.holidays : [];

    const docId = `market-holidays-US-${yearNum}`;
    const docRef = db.collection(APP_COLLECTION).doc(docId);

    const canonical = buildCanonicalCalendarForYear(yearNum, holidays);

    await docRef.set(
      {
        year: yearNum,
        region: 'US',
        holidays,
        source: 'SA',
        weeklyLastTradingDays: canonical.weeklyLastTradingDays,
        monthlyLastTradingDays: canonical.monthlyLastTradingDays,
        lastUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const payload = {
      ok: true,
      year: upstream.year ?? String(yearNum),
      count: holidays.length,
      docPath: `${APP_COLLECTION}/${docId}`,
    };

    logger.info('refreshMarketHolidaysAdmin_done', payload);
    res.status(200).json(payload);
  } catch (e: any) {
    logger.error('refreshMarketHolidaysAdmin_failed', { message: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'internal_error' });
  }
});

/**
 * HTTP (admin): recomputeRegisteredBackfill
 * Backfill all registered pairs across all baselines. Protect with bearer ADMIN_BACKFILL_TOKEN.
 * Query/body: { phase?: PRE|POST|'both', days?: number, limit?: number, concurrency?: number, from?: string, to?: string, intervals?: Interval[] }
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
    const concurrency = Number(req.query.concurrency || req.body?.concurrency || (Number(process.env.PARTNER_PAIR_CONCURRENCY) || 3));

    const intervalsRaw = (req.query.intervals ?? req.body?.intervals) as unknown;
    const normalizeInterval = (v: unknown): Interval | undefined => {
      const s = String(v || '').toUpperCase();
      if (s === Interval.DAILY || s === Interval.WEEKLY || s === Interval.MONTHLY) {
        return s as Interval;
      }
      return undefined;
    };
    let intervals: Interval[];
    if (Array.isArray(intervalsRaw)) {
      intervals = (intervalsRaw as unknown[])
        .map((v) => normalizeInterval(v))
        .filter((v): v is Interval => v !== undefined);
    } else if (intervalsRaw !== undefined) {
      const single = normalizeInterval(intervalsRaw);
      intervals = single ? [single] : [];
    } else {
      intervals = [Interval.DAILY, Interval.WEEKLY, Interval.MONTHLY];
    }
    if (intervals.length === 0) {
      intervals = [Interval.DAILY, Interval.WEEKLY, Interval.MONTHLY];
    }

    if (!from || !to) {
      res.status(400).json({ ok: false, error: 'missing_from_or_to' });
      return;
    }

    let pairs = await listRegisteredPairs();

    // Optional filter: pair (string) or pairs (array)
    const pairParam = (req.query.pair || req.body?.pair) as string | undefined;
    const pairsParam = (req.query.pairs || req.body?.pairs) as any; // array or string[]

    if (pairParam && typeof pairParam === 'string' && pairParam.trim().length > 0) {
      const p = pairParam.trim().toUpperCase();
      pairs = pairs.filter(r => `${r.baseline}-${r.target}` === p);
    } else if (pairsParam && Array.isArray(pairsParam) && pairsParam.length > 0) {
      const set = new Set(pairsParam.map((p: any) => String(p).trim().toUpperCase()));
      pairs = pairs.filter(r => set.has(`${r.baseline}-${r.target}`));
    }

    if (pairs.length === 0) {
      res.status(200).json({ ok: true, message: 'no pairs matched filter', totalPairs: 0 });
      return;
    }

    const phases: RsPhase[] = phaseRaw === 'both' ? [RsPhase.PRE, RsPhase.POST] : (phaseRaw === RsPhase.PRE ? [RsPhase.PRE] : [RsPhase.POST]);
    const summary: any = { ok: true, totalPairs: pairs.length, days, limit, from, to, phases, intervals, results: [] };

    if (!SILENCE_ADMIN_INFO) {
      logger.info('recomputeRegisteredBackfill_start', {
        from,
        to,
        days,
        limit,
        phases,
        intervals,
        totalPairs: pairs.length,
      });
    }

    for (const ph of phases) {
      let successPairs = 0;
      let failedPairs = 0;
      let writtenDays = 0;
      const errorSamples: ProcessErrorSample[] = [];
      // Cache upstream partner bars per symbol so each symbol is fetched at most once per
      // backfill run (per phase), regardless of whether it appears as a baseline or target.
      const symbolBarsCache = new Map<string, any[]>();
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

      // Helper: fetch DAILY bars for backfill windows.
      // Always resolve to a concrete [from,to] window before calling the
      // partner API.
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

      let processedPairsForPhase = 0;
      const totalPairsForPhase = pairs.length;
      const logEveryPhase = Math.max(1, Math.min(10, Math.floor(totalPairsForPhase / 5) || 1));

      await forEachWithConcurrency(pairs, Math.max(1, concurrency), async ({ baseline, target }) => {
        try {
          const pairId = `${baseline}-${target}`;
          let pairWrittenDays = 0;
          let pairDailyDays = 0;
          let pairWeeklyDays = 0;
          let pairMonthlyDays = 0;

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
          let series = buildPhaseSeries(baseBars, targetBars, ph, baseline, target, logger, { from, to });
          // Clamp computed RS points back to the requested [from,to] window
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

          // DAILY backfill
          if (includeDaily && entries.length > 0) {
            await writeUnifiedSeries(baseline, target, ph, entries, baseBars, targetBars, Interval.DAILY);
            writtenDays += entries.length;
            pairWrittenDays += entries.length;
            pairDailyDays += entries.length;
          }

          // WEEKLY backfill
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
              let weeklySeries = buildPhaseSeries(baseWeekly, targetWeekly, ph, baseline, target, logger, { from, to });
              weeklySeries = weeklySeries.filter((p) => p.day >= lower && p.day <= upper);

              if (weeklySeries.length === 0) {
                // No weekly archive points produced for this pair in the requested window.
                logger.warn('recomputeRegisteredBackfill_weekly_no_series', {
                  pair: pairId,
                  phase: ph,
                  from,
                  to,
                  paddedFromWeekly,
                  lower,
                  upper,
                  baseWeeklyBars: baseWeekly?.length ?? 0,
                  targetWeeklyBars: targetWeekly?.length ?? 0,
                });
              } else {
                // Preview which weekly archive docs will be written (collection + docId).
                const firstDays = weeklySeries.slice(0, 5).map((p) => p.day);
                const lastDays = weeklySeries.slice(Math.max(0, weeklySeries.length - 5)).map((p) => p.day);
                const sampleDays = [...firstDays, ...lastDays];

                const docPreview = sampleDays.map((d) => {
                  const day = String(d).slice(0, 10);
                  const year = day.slice(0, 4);
                  // weekly archive docs are stored under archive-weekly-{year} with YYMMDD ids
                  const docId = day.replace(/-/g, '').slice(2);
                  return { day, year, col: `archive-weekly-${year}`, docId };
                });

                logger.info('recomputeRegisteredBackfill_weekly_series_preview', {
                  pair: pairId,
                  phase: ph,
                  from,
                  to,
                  paddedFromWeekly,
                  lower,
                  upper,
                  seriesCount: weeklySeries.length,
                  docs: docPreview,
                });

                await writeUnifiedSeries(baseline, target, ph, weeklySeries, baseWeekly, targetWeekly, Interval.WEEKLY);
                writtenDays += weeklySeries.length;
                pairWrittenDays += weeklySeries.length;
                pairWeeklyDays += weeklySeries.length;
              }

            } catch (e: any) {
              if (errorSamples.length < 50) errorSamples.push({ pair: `${baseline}-${target}`, status: e?.response?.status, message: e?.message || String(e) });

            }
          }

          // MONTHLY backfill
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
              let monthlySeries = buildPhaseSeries(baseMonthly, targetMonthly, ph, baseline, target, logger, { from, to });
              monthlySeries = monthlySeries.filter((p) => p.day >= lower && p.day <= upper);
              if (monthlySeries.length > 0) {
                await writeUnifiedSeries(baseline, target, ph, monthlySeries, baseMonthly, targetMonthly, Interval.MONTHLY);
                writtenDays += monthlySeries.length;
                pairWrittenDays += monthlySeries.length;
                pairMonthlyDays += monthlySeries.length;
              }

            } catch (e: any) {
              if (errorSamples.length < 50) errorSamples.push({ pair: `${baseline}-${target}`, status: e?.response?.status, message: e?.message || String(e) });
            }
          }

          if (!SILENCE_ADMIN_INFO) {
            logger.info('recomputeRegisteredBackfill_pair_summary', {
              pair: pairId,
              phase: ph,
              from,
              to,
              intervals,
              dailyDays: pairDailyDays,
              weeklyDays: pairWeeklyDays,
              monthlyDays: pairMonthlyDays,
              totalDays: pairWrittenDays,
            });
          }

          if (pairWrittenDays > 0) {
            successPairs++;
          } else if (errorSamples.length < 50) {
            errorSamples.push({
              pair: pairId,
              status: 0,
              message: 'no archive writes for pair in requested window',
            });
          }
        } catch (e: any) {
          failedPairs++;
          if (errorSamples.length < 50) errorSamples.push({ pair: `${baseline}-${target}`, status: e?.response?.status, message: e?.message || String(e) });

        }
      });

      processedPairsForPhase++;
      if (!SILENCE_ADMIN_INFO && (processedPairsForPhase % logEveryPhase === 0 || processedPairsForPhase === totalPairsForPhase)) {
        logger.info('recomputeRegisteredBackfill_progress', {
          phase: ph,
          from,
          to,
          intervals,
          processedPairs: processedPairsForPhase,
          totalPairs: totalPairsForPhase,
          writtenDays,
        });
      }

      if (!SILENCE_ADMIN_INFO && writtenDays === 0) {
        logger.warn('recomputeRegisteredBackfill_phase_no_written_days', {
          phase: ph,
          from,
          to,
          intervals,
          totalPairs: pairs.length,
        });
      }

      if (!SILENCE_ADMIN_INFO) {
        logger.info('recomputeRegisteredBackfill_phase_summary', {
          phase: ph,
          from,
          to,
          intervals,
          totalPairs: pairs.length,
          successPairs,
          failedPairs,
          writtenDays,
        });
      }

      summary.results.push({ phase: ph, successPairs, failedPairs, writtenDays, errorSamples });
    }

    res.status(200).json(summary);
  } catch (e: any) {
    logger.error('recomputeRegisteredBackfill_failed', { message: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'internal_error' });
  }
});

/**
 * HTTP (admin): cleanupIntraperiodBar
 * One-off cleanup to remove an incorrect archive doc for all registered pairs.
 * Year, interval and docId (YYMMDD) are provided via query/body. Protect with bearer ADMIN_BACKFILL_TOKEN.
 */
export const cleanupIntraperiodBar = onRequest({ region: 'us-central1', timeoutSeconds: 540 }, async (req, res) => {
  const token = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
  const expected = (process.env.ADMIN_BACKFILL_TOKEN || '').trim();
  if (!expected || token !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  try {
    const body = (req.method === 'POST' ? (req.body || {}) : (req.query || {})) as any;
    const year = String(body.year || '').trim();
    const docId = String(body.docId || '').trim(); // expected format YYMMDD
    const intervalRaw = String(body.interval || '').toUpperCase();

    const interval: Interval =
      intervalRaw === Interval.DAILY || intervalRaw === Interval.WEEKLY || intervalRaw === Interval.MONTHLY
        ? (intervalRaw as Interval)
        : Interval.MONTHLY;

    if (!year || !/^[0-9]{4}$/.test(year)) {
      res.status(400).json({ ok: false, error: 'missing_or_invalid_year' });
      return;
    }

    if (!docId || !/^[0-9]{6}$/.test(docId)) {
      res.status(400).json({ ok: false, error: 'missing_or_invalid_docId' });
      return;
    }

    let pairs = await listRegisteredPairs();

    // Optional pair filters, mirroring recomputeRegisteredBackfill
    const pairParam = (body.pair ?? req.query.pair) as string | undefined;
    const pairsParam = (body.pairs ?? req.query.pairs) as any;

    if (pairParam && typeof pairParam === 'string' && pairParam.trim().length > 0) {
      const p = pairParam.trim().toUpperCase();
      pairs = pairs.filter(r => `${r.baseline}-${r.target}` === p);
    } else if (pairsParam && Array.isArray(pairsParam) && pairsParam.length > 0) {
      const set = new Set(pairsParam.map((p: any) => String(p).trim().toUpperCase()));
      pairs = pairs.filter(r => set.has(`${r.baseline}-${r.target}`));
    }

    if (!pairs || pairs.length === 0) {
      res.status(200).json({ ok: true, totalPairs: 0, deletedDocs: 0, year, docId, interval });
      return;
    }

    let col: string;
    if (interval === Interval.DAILY) {
      col = `archive-${year}`;
    } else if (interval === Interval.WEEKLY) {
      col = `archive-weekly-${year}`;
    } else {
      col = `archive-monthly-${year}`;
    }
    let deleted = 0;

    for (const p of pairs) {
      const pairId = `${p.baseline}-${p.target}`;
      const ref = db.collection('pairs-data').doc(pairId).collection(col).doc(docId);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.delete();
        deleted++;
      }
    }

    res.status(200).json({ ok: true, totalPairs: pairs.length, deletedDocs: deleted, col, docId, year, interval });
  } catch (e: any) {
    logger.error('cleanupIntraperiodBar_failed', { message: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'internal_error' });
  }
});

/**
 * HTTP (admin): purgePairSignalsAndActivityAllHttp
 * HTTP version of purgePairSignalsAndActivityAll with detailed logging.
 * Protect with bearer ADMIN_BACKFILL_TOKEN.
 */
export const purgePairSignalsAndActivityAllHttp = onRequest({ region: 'us-central1', timeoutSeconds: 540 }, async (req, res) => {
  const token = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
  const expected = (process.env.ADMIN_BACKFILL_TOKEN || '').trim();
  if (!expected || token !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  try {
    const body = (req.method === 'POST' ? (req.body || {}) : (req.query || {})) as any;
    
    // Log incoming request details for debugging
    logger.info('purgePairSignalsAndActivityAllHttp_request', {
      method: req.method,
      bodyKeys: Object.keys(body),
      body: body,
      queryKeys: Object.keys(req.query || {}),
      query: req.query
    });

    let pairs: string[] = [];
    if (Array.isArray(body.pairs)) {
      pairs = (body.pairs as any[]).map((p) => String(p || '').trim()).filter(Boolean);
      logger.info('purgePairSignalsAndActivityAllHttp_pairs_from_body', { count: pairs.length, pairs: pairs.slice(0, 5) });
    } else if (body.pairs) {
      logger.warn('purgePairSignalsAndActivityAllHttp_pairs_not_array', { pairs: body.pairs, type: typeof body.pairs });
    }

    const fromYear = Number(body.fromYear);
    const toYear = Number(body.toYear);
    const removeContainers = body.removeContainers === true;
    const removeOpenBucket = body.removeOpenBucket === true;

    // Validate parameters
    if (!Number.isInteger(fromYear) || fromYear < 2000 || fromYear > 2030) {
      logger.error('purgePairSignalsAndActivityAllHttp_invalid_fromYear', { fromYear, body });
      res.status(400).json({ ok: false, error: 'invalid_from_year', fromYear });
      return;
    }

    if (!Number.isInteger(toYear) || toYear < 2000 || toYear > 2030) {
      logger.error('purgePairSignalsAndActivityAllHttp_invalid_toYear', { toYear, body });
      res.status(400).json({ ok: false, error: 'invalid_to_year', toYear });
      return;
    }

    if (fromYear > toYear) {
      logger.error('purgePairSignalsAndActivityAllHttp_invalid_range', { fromYear, toYear });
      res.status(400).json({ ok: false, error: 'from_year_greater_than_to_year', fromYear, toYear });
      return;
    }

    if (pairs.length === 0) {
      logger.info('purgePairSignalsAndActivityAllHttp_using_registry_pairs');
      const reg = await listRegisteredPairs();
      pairs = reg.map((p) => `${p.baseline}-${p.target}`);
    }

    logger.info('purgePairSignalsAndActivityAllHttp_start', {
      pairsCount: pairs.length,
      fromYear,
      toYear,
      removeContainers,
      removeOpenBucket,
    });

    const { PAIRS_COLLECTION, SIGNALS_COLLECTION, ITEMS_SUBCOLLECTION, OPEN_BUCKET_ID, SIGNALS_OPENS_SUBCOLLECTION, SIGNALS_CLOSES_SUBCOLLECTION, SIGNALS_ACTIVITY_COLLECTION, DAYS_SUBCOLLECTION } = await import('./webhooks-config');
    
    let deletedLegacySignals = 0;
    let deletedSignalsYearItems = 0;
    let deletedActivityYearItems = 0;

    for (const pair of pairs) {
      const signalsBase = db.collection(PAIRS_COLLECTION).doc(pair).collection(SIGNALS_COLLECTION);

      const legacySnap = await signalsBase.select().get();
      let batch = db.batch();
      let ops = 0;
      for (const d of legacySnap.docs) {
        const id = String(d.id);
        if (!/^\d{4}$/.test(id)) {
          batch.delete(signalsBase.doc(id));
          ops++;
          deletedLegacySignals++;
          if (ops >= 400) {
            await batch.commit();
            batch = db.batch();
            ops = 0;
          }
        }
      }
      if (ops > 0) {
        await batch.commit();
      }

      if (removeOpenBucket) {
        try {
          const openItems = signalsBase.doc(OPEN_BUCKET_ID).collection(ITEMS_SUBCOLLECTION);
          const osnap = await openItems.select().get();
          let obatch = db.batch();
          let oops = 0;
          for (const it of osnap.docs) {
            obatch.delete(openItems.doc(it.id));
            oops++;
            if (oops >= 400) {
              await obatch.commit();
              obatch = db.batch();
              oops = 0;
            }
          }
          if (oops > 0) {
            await obatch.commit();
          }
          try {
            await signalsBase.doc(OPEN_BUCKET_ID).delete();
          } catch {}
        } catch {}
      }

      const activityBase = db.collection(PAIRS_COLLECTION).doc(pair).collection(SIGNALS_ACTIVITY_COLLECTION);

      for (let y = fromYear; y <= toYear; y++) {
        const yearId = String(y);

        const yearSignalsDoc = signalsBase.doc(yearId);

        const opensCol = yearSignalsDoc.collection(SIGNALS_OPENS_SUBCOLLECTION);
        const osnap = await opensCol.select().get();
        let obatch = db.batch();
        let oops = 0;
        for (const it of osnap.docs) {
          obatch.delete(opensCol.doc(it.id));
          oops++;
          deletedSignalsYearItems++;
          if (oops >= 400) {
            await obatch.commit();
            obatch = db.batch();
            oops = 0;
          }
        }
        if (oops > 0) {
          await obatch.commit();
        }

        const closesCol = yearSignalsDoc.collection(SIGNALS_CLOSES_SUBCOLLECTION);
        const csnap = await closesCol.select().get();
        let cbatch = db.batch();
        let cops = 0;
        for (const it of csnap.docs) {
          cbatch.delete(closesCol.doc(it.id));
          cops++;
          deletedSignalsYearItems++;
          if (cops >= 400) {
            await cbatch.commit();
            cbatch = db.batch();
            cops = 0;
          }
        }
        if (cops > 0) {
          await cbatch.commit();
        }

        if (removeContainers) {
          try {
            await signalsBase.doc(yearId).delete();
          } catch {}
        }

        const yearActivityDoc = activityBase.doc(yearId);
        const daysCol = yearActivityDoc.collection(DAYS_SUBCOLLECTION);
        const dsnap = await daysCol.select().get();
        let dbatch = db.batch();
        let dops = 0;
        for (const it of dsnap.docs) {
          dbatch.delete(daysCol.doc(it.id));
          dops++;
          deletedActivityYearItems++;
          if (dops >= 400) {
            await dbatch.commit();
            dbatch = db.batch();
            dops = 0;
          }
        }
        if (dops > 0) {
          await dbatch.commit();
        }

        if (removeContainers) {
          try {
            await activityBase.doc(yearId).delete();
          } catch {}
        }
      }
    }

    const result = {
      ok: true,
      pairs: pairs.length,
      years: { from: fromYear, to: toYear },
      signals: {
        deletedLegacy: deletedLegacySignals,
        deletedYearItems: deletedSignalsYearItems,
      },
      activity: {
        deletedYearItems: deletedActivityYearItems,
      },
    };
    
    logger.info('purgePairSignalsAndActivityAllHttp_done', result);
    res.status(200).json(result);
  } catch (e: any) {
    logger.error('purgePairSignalsAndActivityAllHttp_failed', { message: e?.message, stack: e?.stack });
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
 *  - from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD'
 *  - autoFix?: boolean (default false) → if true, writes only computed-but-missing days
 */
export const diagnosePairDays = onCall({ region: 'us-central1', timeoutSeconds: 540 }, async (req) => {

  try {
    const baseline = String(req.data?.baseline || '').trim().toUpperCase();
    const symbols: string[] = Array.isArray(req.data?.symbols) ? req.data.symbols.map((s: any) => String(s).toUpperCase()) : [];
    const phase: RsPhase = (String(req.data?.phase || RsPhase.POST).toLowerCase() === RsPhase.PRE) ? RsPhase.PRE : RsPhase.POST;
    const from: string | undefined = req.data?.from ? String(req.data.from) : undefined;
    const to: string | undefined = req.data?.to ? String(req.data.to) : undefined;
    const autoFix: boolean = !!req.data?.autoFix;
    const forceWrite: boolean = !!req.data?.forceWrite;
    logger.info('diagnosePairDays start', { baseline, symbols, phase, from: from ?? null, to: to ?? null, autoFix, forceWrite });

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

    // Resolve an effective [from,to] window for diagnostics.
    const today = new Date();
    const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const effectiveTo: string = to ? String(to).slice(0, 10) : ymd(today);
    const effectiveFrom: string = from
      ? String(from).slice(0, 10)
      : (() => {
          const d = new Date(today.getTime() - 40 * 24 * 60 * 60 * 1000);
          return ymd(d);
        })();

    for (const target of symbols) {
      try {
        // Fetch bars for the resolved explicit window.
        const rangeOpts = {
          from: effectiveFrom,
          to: effectiveTo,
          interval: FIXED_INTERVAL,
        } as const;
        const [baseBars, targetBars] = await Promise.all([
          fetchDailyBarsRange(baseline, rangeOpts),
          fetchDailyBarsRange(target, rangeOpts),
        ]);
        logger.info('diagnosePairDays bars fetched', { pair: `${baseline}-${target}`, phase, baseBars: baseBars?.length ?? 0, targetBars: targetBars?.length ?? 0, from: effectiveFrom, to: effectiveTo });
        // If focusing a single day, surface the raw bars at and before that day for both series.
        const focusDay: string | undefined = (from && to && from === to) ? String(from).slice(0, 10) : undefined;

        if (focusDay) {
          const toIndex = (bars: any[], day: string): number | undefined => {
            for (let i = 0; i < bars.length; i++) { const d = (bars[i]?.d || bars[i]?.t)?.toString?.().slice(0,10); if (d === day) return i; }
            return undefined;
          };
          const bi = toIndex(baseBars as any[], focusDay);
          const ti = toIndex(targetBars as any[], focusDay);
          const prev = (bars: any[], idx?: number) => (idx !== undefined && idx > 0) ? bars[idx-1] : undefined;
          const preview = (b: any) => b ? { d: b?.d ?? b?.t ?? null, ac: b?.ac ?? null, c: b?.c ?? null } : null;
          logger.info('diagnosePairDays focus bars', {
            pair: `${baseline}-${target}`,
            phase,
            focusDay,
            baseAt: preview(bi !== undefined ? (baseBars as any[])[bi] : undefined),
            basePrev: preview(prev(baseBars as any[], bi)),
            targetAt: preview(ti !== undefined ? (targetBars as any[])[ti] : undefined),
            targetPrev: preview(prev(targetBars as any[], ti)),
          });
          try {
            const payload = {
              pair: `${baseline}-${target}`,
              phase,
              focusDay,
              baseAt: preview(bi !== undefined ? (baseBars as any[])[bi] : undefined),
              basePrev: preview(prev(baseBars as any[], bi)),
              targetAt: preview(ti !== undefined ? (targetBars as any[])[ti] : undefined),
              targetPrev: preview(prev(targetBars as any[], ti)),
            };
            logger.info('diagnosePairDays focus bars data: ' + JSON.stringify(payload).slice(0, 1200));
          } catch {}
        }

        // Build quick lookup of bars by day
        const baseDays = new Set<string>();
        const targDays = new Set<string>();
        for (const b of baseBars) { const d = dayStr((b as any).d || (b as any).t); if (d) baseDays.add(d); }
        for (const b of targetBars) { const d = dayStr((b as any).d || (b as any).t); if (d) targDays.add(d); }

        // Compute series for the window, then index by day
        const series = buildPhaseSeries(baseBars, targetBars, phase, baseline, target, logger, { from: effectiveFrom, to: effectiveTo });

        const seriesDays = series.map(p => p.day);
        logger.info('diagnosePairDays series built', { pair: `${baseline}-${target}`, phase, series: series.length, first5: seriesDays.slice(0,5), last5: seriesDays.slice(Math.max(0, seriesDays.length-5)) });
        if (focusDay) {
          const focusPt = series.find(p => p.day === focusDay);
          const previewPt = focusPt ? {
            day: focusPt.day,
            baseClose: (focusPt as any).baseClose,
            targetClose: (focusPt as any).targetClose,
            it: (focusPt as any).it,
          } : null;
          logger.info('diagnosePairDays series focus', { pair: `${baseline}-${target}`, phase, focusDay, present: !!focusPt, point: previewPt });
          try {
            logger.info('diagnosePairDays series focus data: ' + JSON.stringify({ pair: `${baseline}-${target}`, phase, focusDay, point: previewPt }).slice(0, 1200));
          } catch {}
        }
        const computedDays = new Set<string>(series.map((p) => p.day));

        // Establish candidate days to check (union of base and target bar days)
        const candidateDays = new Set<string>();
        for (const d of baseDays) candidateDays.add(d);
        for (const d of targDays) candidateDays.add(d);

        const problems: Array<{ day: string; reason: string }> = [];
        let present = 0;
        for (const d of Array.from(candidateDays).sort()) {
          const hasBase = baseDays.has(d);
          const hasTarg = targDays.has(d);
          const isComputed = computedDays.has(d);

          if (hasBase && hasTarg && isComputed) {
            present++;
            continue;
          }
          if (!hasBase && !hasTarg) {
            problems.push({ day: d, reason: 'no_bars_both' });
            continue;
          }
          if (!hasBase) {
            problems.push({ day: d, reason: 'missing_base_bar' });
            continue;
          }
          if (!hasTarg) {
            problems.push({ day: d, reason: 'missing_target_bar' });
            continue;
          }
          if (hasBase && hasTarg && !isComputed) {
            problems.push({ day: d, reason: 'compute_skipped' });
            continue;
          }
        }

        results.push({
          pair: `${baseline}-${target}`,
          phase,
          window: { from: effectiveFrom, to: effectiveTo, yearsBack: null },
          summary: {
            problems,
            present,
            computedCount: computedDays.size,
            baseDays: Array.from(baseDays.values()).sort(),
            targDays: Array.from(targDays.values()).sort(),
          },
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
    // yearsBack/dates are accepted at the surface for compatibility but ignored by the callable.

    const autoFix: boolean = String((req.body?.autoFix ?? req.query.autoFix ?? '')).toLowerCase() === 'true';

    if (!baseline || symbols.length === 0) {
      res.status(400).json({ ok: false, error: 'missing_baseline_or_symbols' });
      return;
    }

    const callRes = await diagnosePairDays.run({
      data: { baseline, symbols, phase, from, to, autoFix },
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

/**
 * Scheduled: autoDiagnoseAndFixDaily
 * Runs daily to detect and auto-fix missing pair-day RS entries across all registered pairs.
 * Window: last 3 UTC days to be resilient to delayed partner updates.
 */
export const autoDiagnoseAndFixDaily = onSchedule({ region: 'us-central1', schedule: 'every day 03:30', timeZone: 'Etc/UTC' }, async () => {
  try {
    // Gate the daily safety net behind an env flag to avoid redundancy with the post-close verifier loop.
    const safetyNetEnabled = String(process.env.SAFETY_NET_ENABLED || '').toLowerCase() === 'true';
    if (!safetyNetEnabled) {
      if (!SILENCE_ADMIN_INFO) logger.info('autoDiagnoseAndFixDaily skipped (SAFETY_NET_ENABLED!=true)');
      return;
    }

    const pairs = await listRegisteredPairs();
    if (!pairs || pairs.length === 0) {
      if (!SILENCE_ADMIN_INFO) logger.info('autoDiagnoseAndFixDaily no registered pairs');
      return;
    }
    const byBaseline = new Map<string, Set<string>>();
    for (const p of pairs) {
      const base = String(p.baseline || '').toUpperCase();
      const targ = String(p.target || '').toUpperCase();
      if (!base || !targ) continue;
      const set = byBaseline.get(base) ?? new Set<string>();
      set.add(targ);
      byBaseline.set(base, set);
    }

    const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const today = new Date();
    const to = ymd(today);
    const fromDate = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);
    const from = ymd(fromDate);

    for (const [baseline, set] of byBaseline.entries()) {
      const symbols = Array.from(set.values());
      try {
        const callRes = await diagnosePairDays.run({
          data: { baseline, symbols, phase: RsPhase.POST, from, to, autoFix: true },
          auth: undefined,
          instanceIdToken: undefined,
          rawRequest: undefined as any,
        } as any);
        const ok = (callRes as any)?.ok !== false;
        if (!SILENCE_ADMIN_INFO) logger.info('autoDiagnoseAndFixDaily baseline result', { baseline, ok, from, to });
      } catch (e: any) {
        logger.warn('autoDiagnoseAndFixDaily diagnose failed', { baseline, from, to, message: e?.message });
      }
    }
  } catch (e: any) {
    logger.error('autoDiagnoseAndFixDaily_failed', { message: e?.message });
  }
});