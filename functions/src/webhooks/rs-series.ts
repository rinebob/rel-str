/**
 * RS Series Utilities
 *
 * Provides helpers for building phase-aware aligned series used by the writer
 * and a minimal RS series when only close prices are needed.
 */
import type { Phase, PartnerBar, SeriesBar, RsPoint, PhaseSeriesPoint } from './webhooks-config';

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
 * Pre phase:
 *  - uses ip/ipc (intraday) when available
 * Post phase:
 *  - uses ac/cp (end-of-day/adjusted close)
 *
 * Includes a 5-day rolling window rank based on percent changes.
 */
export function buildPhaseSeries(
  baselineBars: PartnerBar[],
  targetBars: PartnerBar[],
  phase: Phase,
  baselineSymbol: string,
  targetSymbol: string,
  logger: any
): PhaseSeriesPoint[] {
  const baseByDay = new Map<string, PartnerBar>();
  for (const b of baselineBars) if (b?.d) baseByDay.set(b.d!, b);
  const aligned: Array<{ day: string; base: PartnerBar; target: PartnerBar }> = [];
  for (const t of targetBars) {
    if (!t?.d) continue;
    const base = baseByDay.get(t.d);
    if (!base) {
      logger.info('rs_series_skip_no_alignment', {
        day: t.d,
        phase,
        baseline: baselineSymbol,
        target: targetSymbol,
        reason: 'baseline_bar_missing'
      });
      continue;
    }
    const dw = dowLabelUTC(t.d);
    if (dw === 'Sat' || dw === 'Sun') continue;
    if (phase === 'pre') {
      // Intraday must have price and intraday percent-change (ipc) for both sides
      const missing = [];
      if (Number(t.ip) <= 0) missing.push('target_ip');
      if (Number(base?.ip) <= 0) missing.push('baseline_ip');
      if (!Number.isFinite(Number(t.ipc))) missing.push('target_ipc');
      if (!Number.isFinite(Number(base.ipc))) missing.push('baseline_ipc');
      if (missing.length > 0) {
        logger.info('rs_series_skip_pre_missing_fields', {
          day: t.d,
          phase,
          baseline: baselineSymbol,
          target: targetSymbol,
          missing
        });
        continue;
      }
    } else {
      // Strict EOD: must have closes and provider EOD percent-change (cp)
      const missing = [];
      if (!(Number(t.ac) > 0 || Number(t.c) > 0)) missing.push('target_close');
      if (!(Number(base?.ac) > 0 || Number(base?.c) > 0)) missing.push('baseline_close');
      if (!Number.isFinite(Number(t.cp))) missing.push('target_cp');
      if (!Number.isFinite(Number(base?.cp))) missing.push('baseline_cp');
      if (missing.length > 0) {
        logger.info('rs_series_skip_post_missing_fields', {
          day: t.d,
          phase,
          baseline: baselineSymbol,
          target: targetSymbol,
          missing
        });
        continue;
      }
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
    // Percent change inputs by phase
    const bCp = phase === 'post' ? Number(base.cp) : Number(base.ipc);
    const tCp = phase === 'post' ? Number(target.cp) : Number(target.ipc);

    // Close inputs by phase (price reference)
    const bClose = phase === 'post' ? (Number(base.ac) || Number(base.c) || 0) : Number(base.ip);
    const tClose = phase === 'post' ? (Number(target.ac) || Number(target.c) || 0) : Number(target.ip);

    if (!Number.isFinite(bCp) || !Number.isFinite(tCp)) {
      logger.info('rs_series_skip_calc_nonfinite_cp', {
        day,
        phase,
        baseline: baselineSymbol,
        target: targetSymbol,
        baseCp: base.cp,
        targetCp: target.cp,
        baseIpc: base.ipc,
        targetIpc: target.ipc
      });
      continue;
    }
    if (!Number.isFinite(bClose) || !Number.isFinite(tClose)) {
      logger.info('rs_series_skip_calc_nonfinite_price', {
        day,
        phase,
        baseline: baselineSymbol,
        target: targetSymbol,
        baseClose,
        targetClose
      });
      continue;
    }
    if (bClose <= 0 || tClose <= 0) {
      logger.info('rs_series_skip_calc_nonpositive_price', {
        day,
        phase,
        baseline: baselineSymbol,
        target: targetSymbol,
        baseClose,
        targetClose
      });
      continue;
    }

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
