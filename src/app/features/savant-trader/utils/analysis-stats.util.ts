/**
 * Analysis stats utils (Thread #1059, task #1084) — pure computations over
 * the workbench's filtered row set: the stats block, tradeRetPct histogram
 * bins, and scatter points. Kept pure + spec'd; the views component and
 * store computeds are thin wrappers. All return metrics operate on rows
 * with a numeric tradeRetPct — open/provisional rows reach stats only when
 * the caller lifts the quarantine, per #1083.
 */
import type { TradeAnalysisRow } from '@paper-trading/analysis';

export interface SignalTypeStats {
  signalType: string;
  count: number;
  winPct: number | null;
  avgRetPct: number | null;
  profitFactor: number | null;
}

export interface AnalysisStats {
  count: number;
  wins: number;
  losses: number;
  profitablePct: number | null;
  avgRetPct: number | null;
  medianRetPct: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  /** avgWin / |avgLoss| — null when either side is empty. */
  payoff: number | null;
  /** gross wins / |gross losses| — Infinity when all wins, null when all losses. */
  profitFactor: number | null;
  /** Mean return per trade — same value as avgRetPct, surfaced separately
   *  because that's the name traders read it by. */
  expectancyPct: number | null;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  avgDaysHeld: number | null;
  avgMfePct: number | null;
  avgMaePct: number | null;
  avgGivebackRatio: number | null;
  bySignalType: SignalTypeStats[];
}

export interface HistogramBin {
  x0: number;
  x1: number;
  count: number;
  wins: number;
  losses: number;
}

export interface ScatterPoint {
  x: number;
  y: number;
  color?: string | number;
  tradeId: string | number | null;
}

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Rows that carry a numeric tradeRetPct — the return-stat universe. */
const rets = (rows: readonly TradeAnalysisRow[]) =>
  rows
    .map((r) => r.tradeRetPct)
    .filter((v): v is number => typeof v === 'number');

export function computeAnalysisStats(
  rows: readonly TradeAnalysisRow[],
): AnalysisStats {
  const r = rets(rows);
  const wins = r.filter((v) => v > 0);
  const losses = r.filter((v) => v < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = losses.reduce((a, b) => a + b, 0);
  const avgWin = mean(wins);
  const avgLoss = mean(losses);
  const avg = mean(r);

  const ordered = [...rows]
    .filter((x) => typeof x.tradeRetPct === 'number')
    .sort((a, b) => (a.entryDate ?? '').localeCompare(b.entryDate ?? ''));
  let maxW = 0, maxL = 0, curW = 0, curL = 0;
  for (const x of ordered) {
    if ((x.tradeRetPct as number) > 0) {
      curW += 1; curL = 0;
    } else if ((x.tradeRetPct as number) < 0) {
      curL += 1; curW = 0;
    } else {
      curW = 0; curL = 0;
    }
    if (curW > maxW) maxW = curW;
    if (curL > maxL) maxL = curL;
  }

  const num = (k: keyof TradeAnalysisRow & string) =>
    mean(
      rows
        .map((x) => x[k])
        .filter((v): v is number => typeof v === 'number'),
    );

  const groups = new Map<string, number[]>();
  for (const x of rows) {
    const t = x.signalType === null ? '—' : String(x.signalType);
    if (typeof x.tradeRetPct !== 'number') continue;
    (groups.get(t) ?? groups.set(t, []).get(t)!).push(x.tradeRetPct);
  }
  const bySignalType = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([signalType, rr]) => {
      const w = rr.filter((v) => v > 0);
      const l = rr.filter((v) => v < 0);
      const gw = w.reduce((a, b) => a + b, 0);
      const gl = l.reduce((a, b) => a + b, 0);
      return {
        signalType,
        count: rr.length,
        winPct: (w.length / rr.length) * 100,
        avgRetPct: mean(rr),
        profitFactor:
          l.length === 0 ? (w.length === 0 ? null : Infinity) : gw / -gl,
      };
    });

  return {
    count: r.length,
    wins: wins.length,
    losses: losses.length,
    profitablePct: r.length === 0 ? null : (wins.length / r.length) * 100,
    avgRetPct: avg,
    medianRetPct: median(r),
    avgWinPct: avgWin,
    avgLossPct: avgLoss,
    payoff:
      avgWin === null || avgLoss === null ? null : avgWin / Math.abs(avgLoss),
    profitFactor:
      losses.length === 0
        ? wins.length === 0
          ? null
          : Infinity
        : grossWin / -grossLoss,
    expectancyPct: avg,
    maxConsecutiveWins: maxW,
    maxConsecutiveLosses: maxL,
    avgDaysHeld: num('daysHeld'),
    avgMfePct: num('mfePct'),
    avgMaePct: num('maePct'),
    avgGivebackRatio: num('givebackRatio'),
    bySignalType,
  };
}

/** tradeRetPct bins with edges aligned to multiples of `width` — a bin is
 *  wholly on the win or loss side of zero, which is what colors it. */
export function histogramBins(
  rows: readonly TradeAnalysisRow[],
  column: keyof TradeAnalysisRow & string,
  width: number,
): HistogramBin[] {
  const byIndex = new Map<number, HistogramBin>();
  for (const r of rows) {
    const v = r[column];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const i = Math.floor(v / width);
    const b =
      byIndex.get(i) ??
      byIndex
        .set(i, { x0: i * width, x1: (i + 1) * width, count: 0, wins: 0, losses: 0 })
        .get(i)!;
    b.count += 1;
    if (v > 0) b.wins += 1;
    else if (v < 0) b.losses += 1;
    // v === 0: breakeven — sits in the non-negative bin but is neither
    // a win nor a loss, matching computeAnalysisStats.
  }
  return [...byIndex.values()].sort((a, b) => a.x0 - b.x0);
}

export function scatterPoints(
  rows: readonly TradeAnalysisRow[],
  xKey: keyof TradeAnalysisRow & string,
  yKey: keyof TradeAnalysisRow & string,
  colorKey?: keyof TradeAnalysisRow & string,
): ScatterPoint[] {
  const out: ScatterPoint[] = [];
  for (const r of rows) {
    const x = r[xKey];
    const y = r[yKey];
    if (typeof x !== 'number' || !Number.isFinite(x)) continue;
    if (typeof y !== 'number' || !Number.isFinite(y)) continue;
    out.push({
      x,
      y,
      color: colorKey ? (r[colorKey] ?? undefined) : undefined,
      tradeId: r.tradeId,
    });
  }
  return out;
}
