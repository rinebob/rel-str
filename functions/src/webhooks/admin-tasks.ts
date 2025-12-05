
import { onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { RsPhase } from '../types/partner';
import { logger } from 'firebase-functions/v2';
import { db } from '../firebase-admin-init';
import { writeWarningsSummary, persistWarning } from '../logging/warn';
import { writeUnifiedSeries } from './pairs-writer';
import { listRegisteredPairs } from './registry';
import { buildPhaseSeries } from './rs-series';
import { fetchDailyBarsRange, fetchDailyBarsRaw } from './symbol-fetch';
import { FIXED_DAYS, FIXED_LIMIT, ProcessErrorSample, FIXED_INTERVAL, RsCloudFunctionName } from './webhooks-config';
import { PAIRS_COLLECTION, SIGNALS_COLLECTION, SIGNALS_DAILY_COLLECTION } from './webhooks-config';
import { SILENCE_ADMIN_INFO } from './webhooks-config';
import { forEachWithConcurrency, processPairLive } from './partner-webhooks';
import { rebuildSignalsDailyMirrorRange } from '../rs-signal-history.callables';

/**
 * Callable: recomputePairsRs
 * Recompute RS for specified pairs (or all registered under a baseline) for a configurable window.
 * Params: { baseline: string; symbols?: string[]; phase?: PRE|POST|'both'; days?: number; limit?: number; concurrency?: number; from?: string; to?: string; yearsBack?: number; missingOnly?: boolean }
 */
export const recomputePairsRs = onCall({ region: 'us-central1', timeoutSeconds: 540 }, async (req) => {
  try {
    const baselineRaw = String(req.data?.baseline || '').trim().toUpperCase();
    const symbolsRaw: string[] = Array.isArray(req.data?.symbols) ? req.data.symbols : [];
    const pairsRaw: Array<{ baseline: string; target: string }> = Array.isArray(req.data?.pairs) ? req.data.pairs : [];
    const phaseRaw = String(req.data?.phase || RsPhase.POST).toLowerCase();
    const days = Number(req.data?.days ?? FIXED_DAYS);
    const limit = Number(req.data?.limit ?? FIXED_LIMIT);
    const from: string | undefined = req.data?.from ? String(req.data.from) : undefined;
    const to: string | undefined = req.data?.to ? String(req.data.to) : undefined;
    const yearsBack: number | undefined = Number.isFinite(req.data?.yearsBack) ? Number(req.data.yearsBack) : undefined;
    const missingOnly: boolean = !!req.data?.missingOnly;
    const concurrency = Number(req.data?.concurrency ?? (Number(process.env.PARTNER_PAIR_CONCURRENCY) || 3));
    const delayMsBetweenPairs = Math.max(0, Number(req.data?.delayMsBetweenPairs ?? 0) || 0);
    if (!baselineRaw && pairsRaw.length === 0) return { ok: false, error: 'missing_baseline_or_pairs' };

    // Resolve pairs list
    let pairsList: Array<{ baseline: string; target: string }> = [];
    if (pairsRaw.length > 0) {
      pairsList = pairsRaw
        .map((p: any) => ({
          baseline: String(p?.baseline || '').trim().toUpperCase(),
          target: String(p?.target || '').trim().toUpperCase(),
        }))
        .filter((p) => p.baseline && p.target);
    } else {
      // Fallback: baseline + optional symbols subset
      let targets: string[] = [];
      if (symbolsRaw.length) {
        targets = symbolsRaw.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
      } else {
        const all = await listRegisteredPairs();
        targets = all.filter(p => p.baseline === baselineRaw).map(p => p.target);
      }
      if (targets.length === 0) return { ok: false, error: 'no_targets' };
      pairsList = targets.map(t => ({ baseline: baselineRaw, target: t }));
    }

    const doPhase = async (phase: RsPhase) => {
      const accum = { successPairs: 0, failedPairs: 0, errorSamples: [] as ProcessErrorSample[] };
      let skippedExisting = 0; // reserved for future use in callable path
      let writtenDays = 0;
      const useRange = !!(from || to || Number.isFinite(yearsBack as number));
      if (!SILENCE_ADMIN_INFO) logger.info('recomputePairsRs starting pair processing', { count: pairsList.length, phase, concurrency, delayMsBetweenPairs, useRange, from: from ?? null, to: to ?? null, yearsBack: yearsBack ?? null });
      const baselineBarsCache = new Map<string, any[]>();

      await forEachWithConcurrency(pairsList, Math.max(1, concurrency), async ({ baseline, target }) => {
        const pairId = `${baseline}-${target}`;
        try {
          if (useRange) {
            // Range-based path: honor explicit from/to/yearsBack and avoid implicit window caps.
            // To account for the 5-day RS window, when a caller provides `from`, we pad the
            // fetch window backwards by a few calendar days so that RS points exist starting
            // at the requested `from` rather than several trading days later.
            let paddedFrom: string | undefined = from;
            if (from) {
              try {
                const base = new Date(from + 'T00:00:00.000Z');
                const padDays = 10; // enough to cover 5 trading days across weekends/holidays
                const padded = new Date(base.getTime() - padDays * 24 * 60 * 60 * 1000);
                const y = padded.getUTCFullYear();
                const m = String(padded.getUTCMonth() + 1).padStart(2, '0');
                const d = String(padded.getUTCDate()).padStart(2, '0');
                paddedFrom = `${y}-${m}-${d}`;
              } catch {}
            }

            const rangeOpts = { from: paddedFrom, to, yearsBack, interval: FIXED_INTERVAL } as const;

            let baseBars: any[] | undefined = baselineBarsCache.get(baseline);
            if (!baseBars) {
              baseBars = await fetchDailyBarsRange(baseline, rangeOpts);
              baselineBarsCache.set(baseline, baseBars);
            }
            const targetBars = await fetchDailyBarsRange(target, rangeOpts);
            let series = buildPhaseSeries(baseBars, targetBars, phase, baseline, target, logger, { from, to });
            // After computing RS, clamp the series to the original requested [from,to] window
            // so we do not leak padded days into Firestore.
            if (from || to) {
              const lower = from ? String(from).slice(0, 10) : '0000-01-01';
              const upper = to ? String(to).slice(0, 10) : '9999-12-31';
              series = series.filter((p) => p.day >= lower && p.day <= upper);
            }
            if (series.length === 0) {
              accum.failedPairs++;
              if (accum.errorSamples.length < 10) accum.errorSamples.push({ pair: pairId, message: 'no_aligned_series' });
              return;
            }
            await writeUnifiedSeries(baseline, target, phase, series, baseBars, targetBars);
            writtenDays += series.length;
            accum.successPairs++;
          } else {
            // Legacy path: last `days` window driven by FIXED_DAYS / RS_DAYS
            await processPairLive(baseline, target, phase, days, accum, { baselineBars: baselineBarsCache });
          }
        } finally {
          if (delayMsBetweenPairs > 0) {
            await new Promise((r) => setTimeout(r, delayMsBetweenPairs));
          }
        }
      });
      return { successPairs: accum.successPairs, failedPairs: accum.failedPairs, skippedExisting, writtenDays, errorSamples: accum.errorSamples };
    };

    const phases: RsPhase[] = phaseRaw === 'both' ? [RsPhase.PRE, RsPhase.POST] : (phaseRaw === RsPhase.PRE ? [RsPhase.PRE] : [RsPhase.POST]);
    const results = [] as Array<{ phase: RsPhase; successPairs: number; failedPairs: number; skippedExisting: number; writtenDays: number; errorSamples: ProcessErrorSample[] }>;
    let writtenDaysTotal = 0;
    for (const ph of phases) {
      const r = await doPhase(ph);
      writtenDaysTotal += r.writtenDays;
      results.push({ phase: ph, ...r });
    }
    try { await writeWarningsSummary({ function: 'recomputePairsRs', baseline: baselineRaw || null, pairs: pairsList.length }); } catch {}

    const useRangeTop = !!(from || to || Number.isFinite(yearsBack as number));
    const daysOut = useRangeTop ? null : days;
    const limitOut = useRangeTop ? null : limit;

    return {
      ok: true,
      baseline: baselineRaw || null,
      pairs: pairsList.length,
      days: daysOut,
      limit: limitOut,
      from,
      to,
      yearsBack,
      missingOnly,
      writtenDaysTotal,
      results,
    };
  } catch (e: any) {
    logger.error('recomputePairsRs_failed', { message: e?.message });
    return { ok: false, error: e?.message || 'internal_error' };
  }
});

/**
 * HTTP (admin): diagnoseRegisteredRangeAdmin
 * Run diagnose (and optional auto-fix) across all registered pairs, grouped by baseline, over a window.
 * Protect with bearer ADMIN_BACKFILL_TOKEN.
 * Query/body: { phase?: PRE|POST, from?: string, to?: string, yearsBack?: number, days?: number, dates?: string[]|comma, autoFix?: boolean }
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
    const yearsBack: number | undefined = (req.body?.yearsBack ?? req.query.yearsBack) !== undefined ? Number(req.body?.yearsBack ?? req.query.yearsBack) : undefined;
    const daysParam = req.body?.days ?? req.query.days;
    const days: number | undefined = daysParam !== undefined ? Number(daysParam) : undefined;
    const datesArgRaw = (req.body?.dates ?? req.query.dates) as any;
    const dates: string[] = Array.isArray(datesArgRaw)
      ? datesArgRaw.map((d: any) => String(d))
      : String(datesArgRaw || '').split(',').map((d) => d.trim()).filter(Boolean);
    const autoFix: boolean = String((req.body?.autoFix ?? req.query.autoFix ?? '')).toLowerCase() === 'true';

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

    const summary: any = { ok: true, baselines: byBaseline.size, totalPairs: pairs.length, phase, window: { from: from ?? null, to: to ?? null, yearsBack: yearsBack ?? null, days: days ?? null, dates }, autoFix, results: [] };

    for (const [baseline, set] of byBaseline.entries()) {
      try {
        const symbols = Array.from(set.values());
        const callRes = await diagnosePairDays.run({
          data: { baseline, symbols, phase, from, to, yearsBack, dates, autoFix },
          auth: undefined,
          instanceIdToken: undefined,
          rawRequest: undefined as any,
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
      } catch (e: any) {
        summary.results.push({ baseline, ok: false, error: e?.message || String(e) });
      }
    }

    try { await writeWarningsSummary({ function: 'diagnoseRegisteredRangeAdmin', baselines: byBaseline.size, totalPairs: pairs.length }); } catch {}
    res.status(200).json(summary);
  } catch (e: any) {
    logger.error('diagnoseRegisteredRangeAdmin_failed', { message: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'internal_error' });
  }
});

/**
 * Callable: recomputeRegisteredLive
 * Iterate all registered pairs and run the live writer for the specified phase (default POST),
 * which updates pairs-data/archive and, on POST, writes positions/{id}.current* via updateOpenPositionsForPair().
 * Params: { phase?: PRE|POST, days?: number, concurrency?: number }
 */
export const recomputeRegisteredLive = onCall({ region: 'us-central1', timeoutSeconds: 540 }, async (req) => {
  try {
    const phase: RsPhase = (String(req.data?.phase || RsPhase.POST).toLowerCase() === RsPhase.PRE) ? RsPhase.PRE : RsPhase.POST;
    const days = Number(req.data?.days ?? FIXED_DAYS);
    const concurrency = Number(req.data?.concurrency ?? (Number(process.env.PARTNER_PAIR_CONCURRENCY) || 3));

    const pairs = await listRegisteredPairs();
    if (pairs.length === 0) {
      if (!SILENCE_ADMIN_INFO) logger.info('recomputeRegisteredLive no registered pairs');
      return { ok: true, processed: 0, failed: 0, phase, days, concurrency };
    }

    const counters = {
      successPairs: 0,
      failedPairs: 0,
      errorSamples: [] as ProcessErrorSample[]
    };
    const baselineBarsCache = new Map<string, any[]>();

    await forEachWithConcurrency(pairs, Math.max(1, concurrency), async ({ baseline, target }) => {
      try {
        await processPairLive(
          baseline, 
          target, 
          phase, 
          days, 
          counters, 
          { baselineBars: baselineBarsCache }, 
          { runId: 'manual', eventType: 'recompute-registered-live', trigger: 'manual' }
        );
        counters.successPairs++;
      } catch (e: any) {
        counters.failedPairs++;
        const msg = (e?.message !== undefined) ? String(e.message) : String(e);
        if (counters.errorSamples.length < 50) {
          counters.errorSamples.push({ 
            pair: `${baseline}-${target}`, 
            status: e?.response?.status as number | undefined, 
            message: msg 
          });
        }
      }
    });

    return { 
      ok: true, 
      processed: counters.successPairs, 
      failed: counters.failedPairs, 
      phase, 
      days, 
      concurrency, 
      errorSamples: counters.errorSamples 
    };
  } catch (e: any) {
    logger.error('recomputeRegisteredLive_failed', { message: e?.message });
    return { ok: false, error: e?.message || 'internal_error' };
  }
});

/**
 * HTTP (admin): recomputeRegisteredBackfill
 * Backfill all registered pairs across all baselines. Protect with bearer ADMIN_BACKFILL_TOKEN.
 * Query/body: { phase?: PRE|POST|'both', days?: number, limit?: number, concurrency?: number, from?: string, to?: string, yearsBack?: number, missingOnly?: boolean }
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
    const yearsBack: number | undefined = req.query.yearsBack ? Number(req.query.yearsBack) : (Number.isFinite(req.body?.yearsBack) ? Number(req.body.yearsBack) : undefined);
    const missingOnly: boolean = String((req.query.missingOnly ?? req.body?.missingOnly ?? '')).toLowerCase() === 'true';
    const concurrency = Number(req.query.concurrency || req.body?.concurrency || (Number(process.env.PARTNER_PAIR_CONCURRENCY) || 3));

    const pairs = await listRegisteredPairs();
    const phases: RsPhase[] = phaseRaw === 'both' ? [RsPhase.PRE, RsPhase.POST] : (phaseRaw === RsPhase.PRE ? [RsPhase.PRE] : [RsPhase.POST]);
    const summary: any = { ok: true, totalPairs: pairs.length, days, limit, from, to, yearsBack, missingOnly, phases, results: [] };

    for (const ph of phases) {
      let successPairs = 0;
      let failedPairs = 0;
      let skippedExisting = 0;
      let writtenDays = 0;
      const errorSamples: ProcessErrorSample[] = [];
      // Cache upstream partner bars per symbol so each symbol is fetched at most once per
      // backfill run (per phase), regardless of whether it appears as a baseline or target.
      const symbolBarsCache = new Map<string, any[]>();

      // Helper: fetch DAILY bars for backfill windows.
      // - If caller provided from/to, use an explicit (padded) date range.
      // - If caller provided yearsBack only, use range mode.
      // - Otherwise fall back to the legacy fixed-days window.
      const fetchBackfillBars = async (symbol: string): Promise<any[]> => {
        const hasFromOrTo = !!(from || to);
        const hasYearsBack = Number.isFinite(yearsBack as number);
        const useRange = hasFromOrTo || hasYearsBack;

        if (!useRange) {
          // Legacy fixed-window path (last N days)
          return await fetchDailyBarsRaw(symbol, days, limit);
        }

        if (hasFromOrTo) {
          // Explicit calendar window: use from/to directly, with padding for RS 5-day window.
          let paddedFrom: string | undefined = from;
          if (from) {
            try {
              const base = new Date(`${from}T00:00:00.000Z`);
              const padDays = 10; // enough to cover 5 trading days across weekends/holidays
              const padded = new Date(base.getTime() - padDays * 24 * 60 * 60 * 1000);
              const y = padded.getUTCFullYear();
              const m = String(padded.getUTCMonth() + 1).padStart(2, '0');
              const d = String(padded.getUTCDate()).padStart(2, '0');
              paddedFrom = `${y}-${m}-${d}`;
            } catch {
              // If padding fails for any reason, fall back to original from
              paddedFrom = from;
            }
          }

          return await fetchDailyBarsRange(symbol, {
            from: paddedFrom,
            to,
            interval: FIXED_INTERVAL,
          });
        }

        // No explicit window, but yearsBack was provided: use range mode (true "N years back").
        return await fetchDailyBarsRange(symbol, {
          yearsBack,
          interval: FIXED_INTERVAL,
        });
      };

      await forEachWithConcurrency(pairs, Math.max(1, concurrency), async ({ baseline, target }) => {
        try {
          const useRange = !!(from || to || Number.isFinite(yearsBack as number));

          // Fetch/cached baseline bars
          let baseBars: any[] | undefined = symbolBarsCache.get(baseline);
          if (!baseBars) {
            baseBars = await fetchBackfillBars(baseline);
            symbolBarsCache.set(baseline, baseBars);
          }

          // Fetch/cached target bars
          let targetBars: any[] | undefined = symbolBarsCache.get(target);
          if (!targetBars) {
            targetBars = useRange
              ? await fetchBackfillBars(target)
              : await fetchDailyBarsRaw(target, days, limit);
            symbolBarsCache.set(target, targetBars);
          }
          let series = buildPhaseSeries(baseBars, targetBars, ph, baseline, target, logger, { from, to });
          // Clamp computed RS points back to the requested [from,to] window
          if (useRange && (from || to)) {
            const lower = from ? String(from).slice(0, 10) : '0000-01-01';
            const upper = to ? String(to).slice(0, 10) : '9999-12-31';
            series = series.filter((p) => p.day >= lower && p.day <= upper);
          }
          if (series.length === 0) {
            failedPairs++;
            if (errorSamples.length < 50) errorSamples.push({ pair: `${baseline}-${target}`, message: 'no_aligned_series' });
            try { await persistWarning('no_aligned_series', { function: RsCloudFunctionName.RECOMPUTE_BACKFILL, pairId: `${baseline}-${target}`, baseline, target, phase: ph }); } catch {}
            return;
          }
          let entries = series;
          if (missingOnly) {
            const pairId = `${baseline}-${target}`;
            const snap = await db.collection(PAIRS_COLLECTION).doc(pairId).get();
            const dataArr: any[] = snap.exists && Array.isArray((snap.data() as any)?.data) ? (snap.data() as any).data : [];
            const existingDays = new Set<string>();
            for (const row of dataArr) {
              const day = String(row?.day || '');
              if (!day) continue;
              if (ph === RsPhase.POST && row?.post?.rs !== undefined) existingDays.add(day);
              if (ph === RsPhase.PRE && row?.pre?.rs !== undefined) existingDays.add(day);
            }
            const before = entries.length;
            entries = entries.filter(e => !existingDays.has(e.day));
            skippedExisting += (before - entries.length);
            if (entries.length === 0) { successPairs++; return; }
          }
          await writeUnifiedSeries(baseline, target, ph, entries, baseBars, targetBars);
          writtenDays += entries.length;
          successPairs++;
        } catch (e: any) {
          failedPairs++;
          if (errorSamples.length < 50) errorSamples.push({ pair: `${baseline}-${target}`, status: e?.response?.status, message: e?.message || String(e) });
        }
      });
      summary.results.push({ phase: ph, successPairs, failedPairs, skippedExisting, writtenDays, errorSamples });
    }

    res.status(200).json(summary);
  } catch (e: any) {
    logger.error('recomputeRegisteredBackfill_failed', { message: e?.message });
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
 *  - from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' OR yearsBack?: number OR dates?: string[] (YYYY-MM-DD)
 *  - autoFix?: boolean (default false) → if true, writes only computed-but-missing days
 */
export const diagnosePairDays = onCall({ region: 'us-central1', timeoutSeconds: 540 }, async (req) => {
  try {
    const baseline = String(req.data?.baseline || '').trim().toUpperCase();
    const symbols: string[] = Array.isArray(req.data?.symbols) ? req.data.symbols.map((s: any) => String(s).toUpperCase()) : [];
    const phase: RsPhase = (String(req.data?.phase || RsPhase.POST).toLowerCase() === RsPhase.PRE) ? RsPhase.PRE : RsPhase.POST;
    const from: string | undefined = req.data?.from ? String(req.data.from) : undefined;
    const to: string | undefined = req.data?.to ? String(req.data.to) : undefined;
    const yearsBack: number | undefined = Number.isFinite(req.data?.yearsBack) ? Number(req.data.yearsBack) : undefined;
    const datesArg: string[] = Array.isArray(req.data?.dates) ? req.data.dates.map((d: any) => String(d)) : [];
    const autoFix: boolean = !!req.data?.autoFix;
    const forceWrite: boolean = !!req.data?.forceWrite;
    logger.info('diagnosePairDays start', { baseline, symbols, phase, from: from ?? null, to: to ?? null, yearsBack: yearsBack ?? null, dates: datesArg, autoFix, forceWrite });

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

    for (const target of symbols) {
      try {
        // Fetch bars for explicit window (or a modest default if none provided)
        const rangeOpts = {
          from,
          to,
          yearsBack,
          days: (!from && !to && !yearsBack && datesArg.length === 0) ? 40 : undefined,
          limit: (!from && !to && !yearsBack && datesArg.length === 0) ? 60 : undefined,
          interval: FIXED_INTERVAL,
        } as const;
        const [baseBars, targetBars] = await Promise.all([
          fetchDailyBarsRange(baseline, rangeOpts),
          fetchDailyBarsRange(target, rangeOpts),
        ]);
        logger.info('diagnosePairDays bars fetched', { pair: `${baseline}-${target}`, phase, baseBars: baseBars?.length ?? 0, targetBars: targetBars?.length ?? 0, from: from ?? null, to: to ?? null });
        // If focusing a single day, surface the raw bars at and before that day for both series
        const focusDatesRaw: string[] = Array.isArray(datesArg) && datesArg.length ? datesArg : ((from && to && from === to) ? [String(from)] : []);
        const focusDay: string | undefined = focusDatesRaw.length ? String(focusDatesRaw[0]).slice(0,10) : undefined;
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
        const series = buildPhaseSeries(baseBars, targetBars, phase, baseline, target, logger, { from, to });
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

        // Read existing stored phase days
        const pairId = `${baseline}-${target}`;
        const snap = await db.collection('pairs-data').doc(pairId).get();
        const dataArr: any[] = snap.exists && Array.isArray((snap.data() as any)?.data) ? (snap.data() as any).data : [];
        const storedDays = new Set<string>();
        for (const row of dataArr) {
          const d = String(row?.day || '');
          if (!d) continue;
          if (phase === RsPhase.POST && row?.post?.rs !== undefined) storedDays.add(d);
          if (phase === RsPhase.PRE && row?.pre?.rs !== undefined) storedDays.add(d);
        }
        const focusDates: string[] = datesArg.length ? datesArg.map(d => String(d).slice(0,10)) : ((from && to && from === to) ? [String(from).slice(0,10)] : []);
        const focus = focusDates.length ? focusDates[0] : undefined;
        logger.info('diagnosePairDays stored vs computed', {
          pair: pairId,
          phase,
          computedCount: computedDays.size,
          storedCount: storedDays.size,
          focus,
          focusInComputed: focus ? computedDays.has(focus) : null,
          focusInStored: focus ? storedDays.has(focus) : null,
        });

        // Establish candidate days to check
        const candidateDays = new Set<string>();
        if (datesArg.length > 0) {
          for (const d of datesArg) candidateDays.add(String(d).slice(0, 10));
        } else {
          // union of base and target bar days for the window
          for (const d of baseDays) candidateDays.add(d);
          for (const d of targDays) candidateDays.add(d);
        }

        // Classify per day
        const problems: Array<{ day: string; reason: string } > = [];
        const computedNotStored: string[] = [];
        let present = 0;
        for (const d of Array.from(candidateDays).sort()) {
          const hasBase = baseDays.has(d);
          const hasTarg = targDays.has(d);
          const isComputed = computedDays.has(d);
          const isStored = storedDays.has(d);

          if (isStored) { present++; continue; }
          if (!hasBase && !hasTarg) { problems.push({ day: d, reason: 'no_bars_both' }); continue; }
          if (!hasBase) { problems.push({ day: d, reason: 'missing_base_bar' }); continue; }
          if (!hasTarg) { problems.push({ day: d, reason: 'missing_target_bar' }); continue; }
          if (hasBase && hasTarg && !isComputed) { problems.push({ day: d, reason: 'compute_skipped' }); continue; }
          if (isComputed && !isStored) { problems.push({ day: d, reason: 'computed_but_not_stored' }); computedNotStored.push(d); continue; }
        }

        // Optionally repair: write only missing computed days
        let writtenDays = 0;
        if (autoFix) {
          // Force write path: ignore storedDays and write all computed entries restricted to the requested dates
          let entries: typeof series = [];
          if (forceWrite) {
            if (datesArg.length > 0) {
              const datesSet = new Set(datesArg.map(d => String(d).slice(0,10)));
              entries = series.filter(e => datesSet.has(e.day));
            } else if (from || to) {
              const lower = from ? String(from).slice(0,10) : '0000-01-01';
              const upper = to ? String(to).slice(0,10) : '9999-12-31';
              entries = series.filter(e => e.day >= lower && e.day <= upper);
            } else {
              entries = series;
            }
          } else if (computedNotStored.length > 0) {
            entries = series.filter((p) => computedNotStored.includes(p.day));
          }

          if (entries.length > 0) {
            const entryDays = entries.map(e => e.day);
            const focusEntry = focusDay ? entries.find(e => e.day === focusDay) : undefined;
            const entriesPreview = entries.slice(0, 3).map(e => ({ day: e.day, baseClose: (e as any).baseClose, targetClose: (e as any).targetClose, it: (e as any).it }));
            logger.info('diagnosePairDays autoFix writing', { pair: pairId, phase, forceWrite, from: from ?? null, to: to ?? null, dates: datesArg, count: entries.length, daysFirst10: entryDays.slice(0,10), focusEntry: focusEntry ? { day: focusEntry.day, baseClose: (focusEntry as any).baseClose, targetClose: (focusEntry as any).targetClose, it: (focusEntry as any).it } : null, entriesPreview });
            try {
              logger.info('diagnosePairDays autoFix writing data: ' + JSON.stringify({ pair: pairId, phase, forceWrite, from, to, dates: datesArg, count: entries.length, days: entryDays.slice(0,20), entriesPreview, focusEntry: focusEntry ? { day: (focusEntry as any).day, baseClose: (focusEntry as any).baseClose, targetClose: (focusEntry as any).targetClose, it: (focusEntry as any).it } : null }).slice(0, 1500));
            } catch {}
            await writeUnifiedSeries(baseline, target, phase, entries, baseBars, targetBars);
            writtenDays = entries.length;
            logger.info('diagnosePairDays autoFix wrote', { pair: pairId, phase, writtenDays, daysFirst10: entryDays.slice(0,10) });
            try { logger.info('diagnosePairDays autoFix wrote data: ' + JSON.stringify({ pair: pairId, phase, writtenDays, days: entryDays.slice(0,20) }).slice(0, 1200)); } catch {}
          }
        }

        results.push({
          pair: pairId,
          phase,
          window: { from: from ?? null, to: to ?? null, yearsBack: yearsBack ?? null },
          counts: {
            candidateDays: candidateDays.size,
            storedDays: storedDays.size,
            computedDays: computedDays.size,
            present,
            problems: problems.length,
            writtenDays,
          },
          problems,
        });
        logger.info('diagnosePairDays result', { pair: pairId, phase, candidateDays: candidateDays.size, storedDays: storedDays.size, computedDays: computedDays.size, present, problems: problems.length, writtenDays, problemsSample: problems.slice(0,10) });
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
    const yearsBack: number | undefined = (req.body?.yearsBack ?? req.query.yearsBack) !== undefined ? Number(req.body?.yearsBack ?? req.query.yearsBack) : undefined;
    const datesArgRaw = (req.body?.dates ?? req.query.dates) as any;
    const datesArg: string[] = Array.isArray(datesArgRaw)
      ? datesArgRaw.map((d: any) => String(d))
      : String(datesArgRaw || '').split(',').map((d) => d.trim()).filter(Boolean);
    const autoFix: boolean = String((req.body?.autoFix ?? req.query.autoFix ?? '')).toLowerCase() === 'true';

    if (!baseline || symbols.length === 0) {
      res.status(400).json({ ok: false, error: 'missing_baseline_or_symbols' });
      return;
    }

    const callRes = await diagnosePairDays.run({
      data: { baseline, symbols, phase, from, to, yearsBack, dates: datesArg, autoFix },
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

export const refreshAllRangeAdmin = onRequest({ region: 'us-central1', timeoutSeconds: 540 }, async (req, res) => {
  const token = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
  const expected = (process.env.ADMIN_BACKFILL_TOKEN || '').trim();
  if (!expected || token !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  try {
    const fromDayRaw: string | undefined = (req.body?.fromDay ?? req.query.fromDay) as string | undefined;
    const toDayRaw: string | undefined = (req.body?.toDay ?? req.query.toDay) as string | undefined;
    const daysParam = req.body?.days ?? req.query.days;
    const days: number | undefined = daysParam !== undefined ? Number(daysParam) : undefined;
    const phaseRaw = String((req.body?.phase ?? req.query.phase) || RsPhase.POST).toLowerCase();
    const concurrency = Number(req.body?.concurrency ?? req.query.concurrency ?? (Number(process.env.PARTNER_PAIR_CONCURRENCY) || 3));

    // Normalize range
    let fromDay: string | undefined = fromDayRaw?.slice(0, 10);
    let toDay: string | undefined = toDayRaw?.slice(0, 10);
    if ((!fromDay || !toDay) && Number.isFinite(days as number)) {
      const to = new Date();
      const from = new Date(to.getTime() - (Math.max(1, Number(days)) - 1) * 24 * 60 * 60 * 1000);
      const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      fromDay = ymd(from);
      toDay = ymd(to);
    }

    // Phases to run
    const phases: RsPhase[] = phaseRaw === 'both' ? [RsPhase.PRE, RsPhase.POST] : (phaseRaw === RsPhase.PRE ? [RsPhase.PRE] : [RsPhase.POST]);

    // 1) Recompute RS series and write pairs-data/signals/positions across the range using existing callable recomputePairsRs per baseline
    const baselinesSet = new Set<string>();
    try {
      const pairs = await listRegisteredPairs();
      for (const p of pairs) baselinesSet.add(String(p.baseline || '').toUpperCase());
    } catch {}

    const rsResults: Array<{ baseline: string; phase: RsPhase; ok: boolean; error?: string }> = [];
    if (baselinesSet.size > 0 && fromDay && toDay) {
      for (const baseline of baselinesSet) {
        for (const ph of phases) {
          try {
            const callRes = await recomputePairsRs.run({
              data: { baseline, phase: ph, from: fromDay, to: toDay, concurrency },
              auth: undefined,
              instanceIdToken: undefined,
              rawRequest: undefined as any,
            } as any);
            const ok = (callRes as any)?.ok !== false;
            rsResults.push({ baseline, phase: ph, ok, error: ok ? undefined : String((callRes as any)?.error || '') });
          } catch (e: any) {
            rsResults.push({ baseline, phase: ph, ok: false, error: e?.message || String(e) });
          }
        }
      }
    } else {
      // Fallback: run the live path for last N days (kept for compatibility)
      for (const ph of phases) {
        try {
          const callRes = await recomputeRegisteredLive.run({
            data: { phase: ph, days: Math.max(1, Number(days) || 7), concurrency },
            auth: undefined,
            instanceIdToken: undefined,
            rawRequest: undefined as any,
          } as any);
          const ok = (callRes as any)?.ok !== false;
          rsResults.push({ baseline: 'ALL_REGISTERED', phase: ph, ok, error: ok ? undefined : String((callRes as any)?.error || '') });
        } catch (e: any) {
          rsResults.push({ baseline: 'ALL_REGISTERED', phase: ph, ok: false, error: e?.message || String(e) });
        }
      }
    }

    // 2) Backfill signals (pairs/*/signals, pairs/*/signals-daily) and positions, then rebuild root/signals-daily
    // mirror
    // We call the existing admin-protected HTTP endpoint backfillSignalsHistory.
    // In emulator we hit localhost:5002; in cloud we hit the regional HTTPS endpoint.
    let backfill: any | undefined;
    let backfillError: string | undefined;
    let mirrorCallError: string | undefined;

    if (fromDay && toDay) {
      try {
        const project = (process.env.GCLOUD_PROJECT || ((): string | undefined => {
          try { return JSON.parse(String(process.env.FIREBASE_CONFIG || '{}')).projectId; } catch { return undefined; }
        })()) || 'rel-str';
        const isEmu = String(process.env.FUNCTIONS_EMULATOR || '').toLowerCase() === 'true';
        const baseUrl = isEmu
          ? `http://127.0.0.1:5002/${project}/us-central1`
          : `https://us-central1-${project}.cloudfunctions.net`;
        const adminToken = String(process.env.ADMIN_BACKFILL_TOKEN || '').trim();
        const resp = await fetch(`${baseUrl}/backfillSignalsHistory`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
          },
          body: JSON.stringify({ from: fromDay, to: toDay, mirror: true, dryRun: false, verbose: false }),
        });
        const txt = await resp.text();
        try { backfill = JSON.parse(txt); } catch { backfill = { raw: txt }; }
        if (!resp.ok) throw new Error(`backfillSignalsHistory HTTP ${resp.status}`);
      } catch (e: any) {
        backfillError = e?.message || String(e);
      }

      // Fallback mirror rebuild (in case backfill mirror=false or backfill skipped it)
      if (!backfill || backfill?.ok === false || backfill?.mirror === undefined) {
        try {
          const mirrorRes = await rebuildSignalsDailyMirrorRange.run({
            data: { from: fromDay, to: toDay },
            auth: undefined,
            instanceIdToken: undefined,
            rawRequest: undefined as any,
          } as any);
          res.status(200).json({ ok: true, phases, range: { fromDay, toDay }, rsResults, backfill, backfillError: backfillError ?? null, mirror: mirrorRes });
          return;
        } catch (e: any) {
          mirrorCallError = e?.message || String(e);
        }
      }

      res.status(200).json({ ok: true, phases, range: { fromDay, toDay }, rsResults, backfill, backfillError: backfillError ?? null });
      return;
    } else {
      mirrorCallError = 'fromDay/toDay required for backfill & mirror rebuild';
    }

    res.status(200).json({ ok: false, phases, range: { fromDay: fromDay ?? null, toDay: toDay ?? null }, rsResults, backfillError: backfillError ?? 'no_range', mirrorError: mirrorCallError });
  } catch (e: any) {
    logger.error('refreshAllRangeAdmin_failed', { message: e?.message });
    res.status(500).json({ ok: false, error: e?.message || 'internal_error' });
  }
});

export const purgePairsDataSignalsAdmin = onRequest({ region: 'us-central1', timeoutSeconds: 540 }, async (req, res) => {
  const token = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
  const expected = (process.env.ADMIN_BACKFILL_TOKEN || '').trim();
  if (!expected || token !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  try {
    const pairs = await listRegisteredPairs();
    let pairsScanned = 0;
    let signalsDeleted = 0;
    let dailyDeleted = 0;

    const deleteAll = async (colRef: FirebaseFirestore.CollectionReference): Promise<number> => {
      let total = 0;
      while (true) {
        const snap = await colRef.limit(500).get();
        if (snap.empty) break;
        const batch = db.batch();
        for (const d of snap.docs) {
          batch.delete(d.ref);
          total++;
        }
        await batch.commit();
      }
      return total;
    };

    for (const p of pairs) {
      const pairId = `${p.baseline}-${p.target}`;
      const baseRef = db.collection(PAIRS_COLLECTION).doc(pairId);
      pairsScanned++;
      try {
        const sRef = baseRef.collection(SIGNALS_COLLECTION);
        const dRef = baseRef.collection(SIGNALS_DAILY_COLLECTION);
        signalsDeleted += await deleteAll(sRef);
        dailyDeleted += await deleteAll(dRef);
      } catch {}
    }

    res.status(200).json({ ok: true, pairs: pairsScanned, signalsDeleted, signalsDailyDeleted: dailyDeleted });
  } catch (e: any) {
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