/**
 * Contract-list emit util (#1361).
 *
 * The single seam between a contract-list session's selection and the
 * existing `date,id` pairs pipeline: `toPairLines` produces textarea
 * lines (one per pick row — duplicates preserved, each pick day is its
 * own marker), `rowsToPlottedEntries` produces the equivalent
 * `PlottedEntry[]` for `loadPlotted` (per-contract markerDates union,
 * matching what `parsePlottedEntries` yields from those same lines).
 * `no-selection` rows are never emittable.
 */
import type { ContractListPickRow, ContractListRow } from '@options-replay/contracts';
import type { PlottedEntry } from '@options-contract/contracts';

/** Rows the emit path can carry — picks only, no-selections dropped.
 *  Shared with the session store (its docs may carry `rows` unset). */
export const pickRowsOf = (rows: ContractListRow[] | undefined): ContractListPickRow[] =>
  (rows ?? []).filter((r): r is ContractListPickRow => r.kind === 'pick');

/** `entryDate,contractId` lines in deterministic order — entryDate asc,
 *  then contractId. Duplicates preserved: every pick row emits a line. */
export function toPairLines(rows: ContractListRow[]): string[] {
  return pickRowsOf(rows)
    .slice()
    .sort(
      (a, b) =>
        a.entryDate.localeCompare(b.entryDate) ||
        a.contractId.localeCompare(b.contractId),
    )
    .map((r) => `${r.entryDate},${r.contractId}`);
}

/** One `PlottedEntry` per unique contract — `openDate` = earliest pick,
 *  `markerDates` = sorted union of its pick days (one dot per day on the
 *  span marker). Ordered by earliest date then contractId. */
export function rowsToPlottedEntries(rows: ContractListRow[]): PlottedEntry[] {
  const byContract = new Map<string, Set<string>>();
  for (const r of pickRowsOf(rows)) {
    const dates = byContract.get(r.contractId) ?? new Set<string>();
    dates.add(r.entryDate);
    byContract.set(r.contractId, dates);
  }
  return [...byContract.entries()]
    .map(([contractId, dates]) => {
      const markerDates = [...dates].sort();
      return { contractId, openDate: markerDates[0] ?? null, markerDates };
    })
    .sort(
      (a, b) =>
        (a.openDate ?? '').localeCompare(b.openDate ?? '') ||
        a.contractId.localeCompare(b.contractId),
    );
}
