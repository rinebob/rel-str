/**
 * `aggregate.ts` — per-exit-type aggregation over analysis trade records
 * (Topic #1238, Thread #1266, task #1372; IMPL-BE §3 step 4).
 *
 * `aggregateExitType(records) -> ExitTypeAggregate` — pure; the worker
 * calls it once per exitId with that exit's (row × rule) records.
 *
 * Conventions from `ExitTypeAggregate` (shared/options-analysis-contracts):
 * - A stat is ABSENT when its population is empty — consumers render '—',
 *   never branch on sentinels. hitRatePct absent when every record
 *   errored; avgDaysToExit/avgPremiumCapturedPct absent when nothing
 *   exited; worstMae/maeP50/maeP90 absent when all errored.
 * - hitRatePct denominator EXCLUDES error records (a fetch failure is no
 *   evidence about the exit rule).
 * - Premium captured = (entryMark − exitPrice)/entryMark ×100 — the
 *   short-premium convention; records with entryMark <= 0 are excluded
 *   from that mean (division degenerates) — if none qualify, absent.
 * - Percentiles are nearest-rank over non-error mae.value.
 */

import type {
  AnalysisTradeRecord,
  ExitTypeAggregate,
} from '@options-analysis/contracts';

/** Nearest-rank percentile over an ascending-sorted array — index
 *  ceil(p/100 · n) − 1; n=1 → the single element. */
function nearestRank(sorted: number[], pct: number): number {
  return sorted[Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1)];
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Aggregate one exit type's records — `records` is exactly that exitId's
 *  (pick-row × rule) outcomes; `contractCount` = total pick rows. */
export function aggregateExitType(
  exitId: string,
  contractCount: number,
  records: AnalysisTradeRecord[],
): ExitTypeAggregate {
  const exited = records.filter(
    (r): r is Extract<AnalysisTradeRecord, { outcome: 'exit' }> => r.outcome === 'exit',
  );
  const expiredCount = records.filter((r) => r.outcome === 'expired').length;
  const errorCount = records.filter((r) => r.outcome === 'error').length;

  const agg: ExitTypeAggregate = {
    exitId,
    contractCount,
    exitedCount: exited.length,
    expiredCount,
    errorCount,
  };

  const hitDenom = contractCount - errorCount;
  if (hitDenom > 0) agg.hitRatePct = (exited.length / hitDenom) * 100;

  if (exited.length > 0) {
    agg.avgDaysToExit = mean(exited.map((r) => r.daysHeld));
    const captured = exited
      .filter((r) => r.entryMark > 0)
      .map((r) => ((r.entryMark - r.exitPrice) / r.entryMark) * 100);
    if (captured.length > 0) agg.avgPremiumCapturedPct = mean(captured);
  }

  const maes = records
    .filter((r) => r.outcome !== 'error')
    .map((r) => r.mae.value)
    .sort((a, b) => a - b);
  if (maes.length > 0) {
    agg.worstMae = maes[maes.length - 1];
    agg.maeP50 = nearestRank(maes, 50);
    agg.maeP90 = nearestRank(maes, 90);
  }

  return agg;
}
