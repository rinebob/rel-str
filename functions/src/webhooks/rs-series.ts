/**
 * RS Series Utilities
 *
 * Provides helpers for building phase-aware aligned series used by the writer
 * and a minimal RS series when only close prices are needed.
 */
import type { PartnerBar, SeriesBar, RsPoint, PhaseSeriesPoint } from './webhooks-config';
import { RsPhase } from '../types/partner';
import { SILENCE_RS_SERIES_INFO, RsCloudFunctionName } from './webhooks-config';
import { persistWarning } from '../logging/warn';

/** Return day-of-week label (UTC) for a YYYY-MM-DD string. */
function dowLabelUTC(dayStr: string): string {
  const d = new Date(dayStr + 'T00:00:00.000Z');
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
  return labels[d.getUTCDay()];
}

/** Precompute matrices for 5-day window rank calculation. */
function genMatrices5(): string[] {
  const out: string[] = [];
  for (let i = 0; i < 32; i++) out.push(i.toString(2).padStart(5, '0'));
  return out;
}
const MATRICES_5 = genMatrices5();

/**
 * Calculate rank for a 5-value window comparing subject vs baseline percent changes.
 * Returns a percentile in (0,1], where 1 means subject outperforms in all combinations.
 */
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

/** Normalize a timestamp in ms to YYYY-MM-DD (UTC). */
function dayKeyUTC(ts: number): string {
  const d = new Date(ts);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

/**
 * Compute a minimal RS series aligned by day with only time and close values.
 * Useful for diagnostics and lightweight comparisons.
 */
export function computeRsSeries(baseBars: SeriesBar[], targetBars: SeriesBar[]): RsPoint[] {
  const baseByDay = new Map<string, SeriesBar>();
  for (const b of baseBars) baseByDay.set(dayKeyUTC(b.t), b);
  const out: RsPoint[] = [];
  for (const t of targetBars) {
    const key = dayKeyUTC(t.t);
    const base = baseByDay.get(key);
    if (base && base.c > 0) {
      const rs = t.c / base.c;
      const tEff = Math.max(t.t, base.t);
      out.push({ t: tEff, rs, baseClose: base.c, targetClose: t.c });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Build the phase-aware series for a pair, aligned by YYYY-MM-DD and filtered to trading days.
 *
 * PRE phase:
 *  - uses ip/ipc (intraday) when available
 * POST phase:
 *  - uses ac/cp (end-of-day/adjusted close)
 *
 * Includes a 5-day rolling window rank based on percent changes.
 */
export function buildPhaseSeries(
  baselineBars: PartnerBar[],
  targetBars: PartnerBar[],
  phase: RsPhase,
  baselineSymbol: string,
  targetSymbol: string,
  logger: any,
  opts?: { from?: string; to?: string }
): PhaseSeriesPoint[] {
  // Helper: weekend check
  const isWeekend = (dayStr?: string) => {
    if (!dayStr) return false;
    const dow = new Date(dayStr + 'T00:00:00.000Z').getUTCDay();
    return dow === 0 || dow === 6;
  };

  const baseByDay = new Map<string, PartnerBar>();
  for (const b of baselineBars) if (b?.d) baseByDay.set(b.d!, b);
  // Build day->index maps to allow looking up previous trading day's close
  const baseIndexByDay = new Map<string, number>();
  for (let i = 0; i < baselineBars.length; i++) if (baselineBars[i]?.d) baseIndexByDay.set(baselineBars[i]!.d!, i);
  const targIndexByDay = new Map<string, number>();
  for (let i = 0; i < targetBars.length; i++) if (targetBars[i]?.d) targIndexByDay.set(targetBars[i]!.d!, i);

  const findPrevTradingClose = (bars: PartnerBar[], idx: number | undefined): number | undefined => {
    if (idx === undefined || idx <= 0) return undefined;
    let j = idx - 1;
    while (j >= 0) {
      const d = bars[j]?.d;
      if (d && !isWeekend(d)) {
        const c = Number(bars[j]?.ac ?? bars[j]?.c ?? 0);
        return Number.isFinite(c) && c > 0 ? c : undefined;
      }
      j--;
    }
    return undefined;
  };

  const rangeFrom = opts?.from ? String(opts.from).slice(0, 10) : undefined;
  const rangeTo = opts?.to ? String(opts.to).slice(0, 10) : undefined;

  const inRequestedRange = (day: string | undefined): boolean => {
    if (!day) return true;
    const d = day.slice(0, 10);
    if (rangeFrom && d < rangeFrom) return false;
    if (rangeTo && d > rangeTo) return false;
    return true;
  };

  const aligned: Array<{ day: string; base: PartnerBar; target: PartnerBar }> = [];
  const candidateDays: string[] = [];
  for (const t of targetBars) {
    if (!t?.d) continue;
    const base = baseByDay.get(t.d);
    if (!base) {
      if (!SILENCE_RS_SERIES_INFO) {
        logger.info('rs_series_skip_no_alignment', {
          day: t.d,
          phase,
          baseline: baselineSymbol,
          target: targetSymbol,
          reason: 'baseline_bar_missing'
        });
      }
      if (inRequestedRange(t.d)) {
        try {
          void persistWarning('rs_series_no_alignment', {
            function: RsCloudFunctionName.WRITE_UNIFIED_SERIES,
            pairId: `${baselineSymbol}-${targetSymbol}`,
            baseline: baselineSymbol,
            target: targetSymbol,
            phase,
            day: t.d,
            reason: 'baseline_bar_missing',
          });
        } catch {}
      }
      continue;
    }
    const dw = dowLabelUTC(t.d);
    if (dw === 'Sat' || dw === 'Sun') continue;
    candidateDays.push(t.d);
  }

  let latestAlignedDay: string | undefined;
  if (candidateDays.length > 0) {
    latestAlignedDay = candidateDays.reduce((a, b) => (a > b ? a : b));
  }

  for (const t of targetBars) {
    if (!t?.d) continue;
    const base = baseByDay.get(t.d);
    if (!base) continue;
    const dw = dowLabelUTC(t.d);
    if (dw === 'Sat' || dw === 'Sun') continue;
    if (phase === RsPhase.PRE) {
      const isLatest = latestAlignedDay === t.d;
      if (isLatest) {
        const targetIp = Number(t.ip);
        const baseIp = Number(base?.ip);
        const targetIpcRaw = Number(t.ipc);
        const baseIpcRaw = Number(base?.ipc);
        const bi = baseIndexByDay.get(t.d);
        const ti = targIndexByDay.get(t.d);
        const prevBaseClose = findPrevTradingClose(baselineBars, bi);
        const prevTargetClose = findPrevTradingClose(targetBars, ti);
        const canDeriveTargetIpc = Number.isFinite(targetIp) && targetIp > 0 && Number.isFinite(prevTargetClose) && (prevTargetClose as number) > 0;
        const canDeriveBaseIpc = Number.isFinite(baseIp) && baseIp > 0 && Number.isFinite(prevBaseClose) && (prevBaseClose as number) > 0;
        const targetIpc = Number.isFinite(targetIpcRaw)
          ? targetIpcRaw
          : (canDeriveTargetIpc ? ((targetIp - (prevTargetClose as number)) / (prevTargetClose as number)) * 100 : NaN);
        const baseIpc = Number.isFinite(baseIpcRaw)
          ? baseIpcRaw
          : (canDeriveBaseIpc ? ((baseIp - (prevBaseClose as number)) / (prevBaseClose as number)) * 100 : NaN);

        const missing: string[] = [];
        if (!(Number.isFinite(targetIp) && targetIp > 0)) missing.push('target_ip');
        if (!(Number.isFinite(baseIp) && baseIp > 0)) missing.push('baseline_ip');
        if (!Number.isFinite(targetIpc)) missing.push('target_ipc_derived');
        if (!Number.isFinite(baseIpc)) missing.push('baseline_ipc_derived');
        if (missing.length > 0) {
          if (!SILENCE_RS_SERIES_INFO) {
            logger.info('rs_series_skip_pre_missing_fields', {
              day: t.d,
              phase,
              baseline: baselineSymbol,
              target: targetSymbol,
              missing
            });
          }
          if (inRequestedRange(t.d)) {
            try {
              void persistWarning('rs_series_pre_missing_fields', {
                function: RsCloudFunctionName.WRITE_UNIFIED_SERIES,
                pairId: `${baselineSymbol}-${targetSymbol}`,
                baseline: baselineSymbol,
                target: targetSymbol,
                phase,
                day: t.d,
                missing,
              });
            } catch {}
          }
          continue;
        }
        (t as any)._ipc_eff = Number(targetIpc.toFixed(6));
        (base as any)._ipc_eff = Number(baseIpc.toFixed(6));
      } else {
        const bi = baseIndexByDay.get(t.d);
        const ti = targIndexByDay.get(t.d);
        const prevBaseClose = findPrevTradingClose(baselineBars, bi);
        const prevTargetClose = findPrevTradingClose(targetBars, ti);

        const todayTargetClose = Number(t.ac ?? t.c ?? 0);
        const todayBaseClose = Number(base?.ac ?? base?.c ?? 0);

        const targetCpRaw = Number(t.cp);
        const baseCpRaw = Number(base?.cp);

        const canDeriveTargetCp = Number.isFinite(todayTargetClose) && todayTargetClose > 0 && Number.isFinite(prevTargetClose) && (prevTargetClose as number) > 0;
        const canDeriveBaseCp = Number.isFinite(todayBaseClose) && todayBaseClose > 0 && Number.isFinite(prevBaseClose) && (prevBaseClose as number) > 0;

        const targetCpEff = Number.isFinite(targetCpRaw)
          ? targetCpRaw
          : (canDeriveTargetCp ? ((todayTargetClose - (prevTargetClose as number)) / (prevTargetClose as number)) * 100 : NaN);
        const baseCpEff = Number.isFinite(baseCpRaw)
          ? baseCpRaw
          : (canDeriveBaseCp ? ((todayBaseClose - (prevBaseClose as number)) / (prevBaseClose as number)) * 100 : NaN);

        const missing = [] as string[];
        if (!(todayTargetClose > 0)) missing.push('target_close');
        if (!(todayBaseClose > 0)) missing.push('baseline_close');
        if (!Number.isFinite(targetCpEff)) missing.push('target_cp_derived');
        if (!Number.isFinite(baseCpEff)) missing.push('baseline_cp_derived');
        if (missing.length > 0) {
          if (!SILENCE_RS_SERIES_INFO) {
            logger.info('rs_series_skip_post_missing_fields', {
              day: t.d,
              phase,
              baseline: baselineSymbol,
              target: targetSymbol,
              missing
            });
          }
          if (inRequestedRange(t.d)) {
            try {
              void persistWarning('rs_series_post_missing_fields', {
                function: RsCloudFunctionName.WRITE_UNIFIED_SERIES,
                pairId: `${baselineSymbol}-${targetSymbol}`,
                baseline: baselineSymbol,
                target: targetSymbol,
                phase,
                day: t.d,
                missing,
              });
            } catch {}
          }
          continue;
        }
        (t as any)._cp_eff = Number(targetCpEff.toFixed(6));
        (base as any)._cp_eff = Number(baseCpEff.toFixed(6));
      }
    } else {
      const bi = baseIndexByDay.get(t.d);
      const ti = targIndexByDay.get(t.d);
      const prevBaseClose = findPrevTradingClose(baselineBars, bi);
      const prevTargetClose = findPrevTradingClose(targetBars, ti);

      const todayTargetClose = Number(t.ac ?? t.c ?? 0);
      const todayBaseClose = Number(base?.ac ?? base?.c ?? 0);

      const targetCpRaw = Number(t.cp);
      const baseCpRaw = Number(base?.cp);

      const canDeriveTargetCp = Number.isFinite(todayTargetClose) && todayTargetClose > 0 && Number.isFinite(prevTargetClose) && (prevTargetClose as number) > 0;
      const canDeriveBaseCp = Number.isFinite(todayBaseClose) && todayBaseClose > 0 && Number.isFinite(prevBaseClose) && (prevBaseClose as number) > 0;

      const targetCpEff = Number.isFinite(targetCpRaw)
        ? targetCpRaw
        : (canDeriveTargetCp ? ((todayTargetClose - (prevTargetClose as number)) / (prevTargetClose as number)) * 100 : NaN);
      const baseCpEff = Number.isFinite(baseCpRaw)
        ? baseCpRaw
        : (canDeriveBaseCp ? ((todayBaseClose - (prevBaseClose as number)) / (prevBaseClose as number)) * 100 : NaN);

      const missing = [] as string[];
      if (!(todayTargetClose > 0)) missing.push('target_close');
      if (!(todayBaseClose > 0)) missing.push('baseline_close');
      if (!Number.isFinite(targetCpEff)) missing.push('target_cp_derived');
      if (!Number.isFinite(baseCpEff)) missing.push('baseline_cp_derived');
      if (missing.length > 0) {
        if (!SILENCE_RS_SERIES_INFO) {
          logger.info('rs_series_skip_post_missing_fields', {
            day: t.d,
            phase,
            baseline: baselineSymbol,
            target: targetSymbol,
            missing
          });
        }
        if (inRequestedRange(t.d)) {
          try {
            persistWarning('rs_series_post_missing_fields', {
              function: RsCloudFunctionName.WRITE_UNIFIED_SERIES,
              pairId: `${baselineSymbol}-${targetSymbol}`,
              baseline: baselineSymbol,
              target: targetSymbol,
              phase,
              day: t.d,
              missing,
            });
          } catch {}
        }
        continue;
      }
      (t as any)._cp_eff = Number(targetCpEff.toFixed(6));
      (base as any)._cp_eff = Number(baseCpEff.toFixed(6));
    }
    aligned.push({ day: t.d, base, target: t });
  }

  const outDays: string[] = [];
  const outTimes: Array<string | undefined> = [];
  const outDows: string[] = [];
  const baseCp: number[] = [];
  const targetCp: number[] = [];
  const baseClose: number[] = [];
  const targetClose: number[] = [];
  const outT: number[] = [];

  for (const { day, base, target } of aligned) {
    const isLatest = phase === RsPhase.PRE ? (candidateDays.length > 0 && day === (candidateDays.reduce((a, b) => (a > b ? a : b)))) : false;
    // Percent change inputs by phase
    const bCp = phase === RsPhase.POST
      ? Number((base as any)._cp_eff ?? base.cp)
      : (isLatest ? Number((base as any)._ipc_eff ?? base.ipc) : Number((base as any)._cp_eff ?? base.cp));
    const tCp = phase === RsPhase.POST
      ? Number((target as any)._cp_eff ?? target.cp)
      : (isLatest ? Number((target as any)._ipc_eff ?? target.ipc) : Number((target as any)._cp_eff ?? target.cp));

    // Close inputs by phase (price reference)
    const bClose = phase === RsPhase.POST
      ? (Number(base.ac) || Number(base.c) || 0)
      : (isLatest ? Number(base.ip) : (Number(base.ac) || Number(base.c) || 0));
    const tClose = phase === RsPhase.POST
      ? (Number(target.ac) || Number(target.c) || 0)
      : (isLatest ? Number(target.ip) : (Number(target.ac) || Number(target.c) || 0));

    if (!Number.isFinite(bCp) || !Number.isFinite(tCp)) {
      if (!SILENCE_RS_SERIES_INFO) {
        logger.info('rs_series_skip_calc_nonfinite_cp', {
          day,
          phase,
          baseline: baselineSymbol,
          target: targetSymbol,
          baseCp: (base as any)._cp_eff ?? base.cp,
          targetCp: (target as any)._cp_eff ?? target.cp,
          baseIpc: (base as any)._ipc_eff ?? base.ipc,
          targetIpc: (target as any)._ipc_eff ?? target.ipc
        });
      }
      if (inRequestedRange(day)) {
        try {
          void persistWarning('rs_series_calc_nonfinite_cp', {
            function: RsCloudFunctionName.WRITE_UNIFIED_SERIES,
            pairId: `${baselineSymbol}-${targetSymbol}`,
            baseline: baselineSymbol,
            target: targetSymbol,
            phase,
            day,
            baseCp: (base as any)._cp_eff ?? base.cp,
            targetCp: (target as any)._cp_eff ?? target.cp,
          });
        } catch {}
      }
      continue;
    }
    if (!Number.isFinite(bClose) || !Number.isFinite(tClose)) {
      if (!SILENCE_RS_SERIES_INFO) {
        logger.info('rs_series_skip_calc_nonfinite_price', {
          day,
          phase,
          baseline: baselineSymbol,
          target: targetSymbol,
          baseClose,
          targetClose
        });
      }
      if (inRequestedRange(day)) {
        try {
          void persistWarning('rs_series_calc_nonfinite_price', {
            function: RsCloudFunctionName.WRITE_UNIFIED_SERIES,
            pairId: `${baselineSymbol}-${targetSymbol}`,
            baseline: baselineSymbol,
            target: targetSymbol,
            phase,
            day,
            baseClose,
            targetClose,
          });
        } catch {}
      }
      continue;
    }
    if (bClose <= 0 || tClose <= 0) {
      if (!SILENCE_RS_SERIES_INFO) {
        logger.info('rs_series_skip_calc_nonpositive_price', {
          day,
          phase,
          baseline: baselineSymbol,
          target: targetSymbol,
          baseClose,
          targetClose
        });
      }
      if (inRequestedRange(day)) {
        try {
          void persistWarning('rs_series_calc_nonpositive_price', {
            function: RsCloudFunctionName.WRITE_UNIFIED_SERIES,
            pairId: `${baselineSymbol}-${targetSymbol}`,
            baseline: baselineSymbol,
            target: targetSymbol,
            phase,
            day,
            baseClose,
            targetClose,
          });
        } catch {}
      }
      continue;
    }

    outDays.push(day);
    outTimes.push(phase === RsPhase.PRE ? (target.it || base.it) : undefined);
    outDows.push(dowLabelUTC(day));
    baseCp.push(Number(bCp));
    targetCp.push(Number(tCp));
    baseClose.push(bClose);
    targetClose.push(tClose);
    outT.push(Number(target.t || base.t || 0));
  }

  const out: PhaseSeriesPoint[] = [];

  // Emit RS for every aligned trading day, using up to 5 most recent days.
  for (let i = 0; i < outDays.length; i++) {
    // Use as many past days as we have, up to 5
    const windowSize = Math.min(5, i + 1);

    const sub: number[] = [];
    const bas: number[] = [];

    // Collect most recent windowSize days: i, i-1, ..., i-(windowSize-1)
    for (let k = 0; k < windowSize; k++) {
      const idx = i - k;
      sub.push(targetCp[idx]);
      bas.push(baseCp[idx]);
    }
    // Reverse so they are oldest → newest
    sub.reverse();
    bas.reverse();

    // If windowSize < 5, pad by repeating the earliest day so calculateRankWindow still sees 5 points
    while (sub.length < 5) sub.unshift(sub[0]);
    while (bas.length < 5) bas.unshift(bas[0]);

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
