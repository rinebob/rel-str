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
  phase: Phase
): PhaseSeriesPoint[] {
  const baseByDay = new Map<string, PartnerBar>();
  for (const b of baselineBars) if (b?.d) baseByDay.set(b.d!, b);
  const aligned: Array<{ day: string; base: PartnerBar; target: PartnerBar }> = [];
  for (const t of targetBars) {
    if (!t?.d) continue;
    const base = baseByDay.get(t.d);
    if (!base) continue;
    const dw = dowLabelUTC(t.d);
    if (dw === 'Sat' || dw === 'Sun') continue;
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
  const outTimes: Array<string | undefined> = [];
  const outDows: string[] = [];
  const baseCp: number[] = [];
  const targetCp: number[] = [];
  const baseClose: number[] = [];
  const targetClose: number[] = [];
  const outT: number[] = [];

  for (const { day, base, target } of aligned) {
    const bCp = phase === 'post'
      ? (Number(base.cp) || 0)
      : (Number(base.ipc) || (Number(base.ip) && Number(base.pc) ? ((Number(base.ip) - Number(base.pc)) / Number(base.pc)) * 100 : 0));
    const tCp = phase === 'post'
      ? (Number(target.cp) || 0)
      : (Number(target.ipc) || (Number(target.ip) && Number(target.pc) ? ((Number(target.ip) - Number(target.pc)) / Number(target.pc)) * 100 : 0));

    const bClose = phase === 'post' ? (Number(base.ac) || Number(base.c) || 0) : (Number(base.ip) || 0);
    const tClose = phase === 'post' ? (Number(target.ac) || Number(target.c) || 0) : (Number(target.ip) || 0);

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
