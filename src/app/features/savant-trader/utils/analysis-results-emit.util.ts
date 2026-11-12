/**
 * Analysis-results → option-chart emit util (#1431 item 12).
 *
 * The chart's `PlottedEntry.markerDates` is the dot vocabulary — one dot
 * per date on the contract's span marker. Sending a result set therefore
 * means folding each (contract-row × rule) record into a per-contract
 * marker union: pick day always, plus the rule's terminal marker —
 * exitDate for 'exit', the OCC-parsed expiration for 'expired', the
 * last observed bar for 'open' (the position's as-of point), nothing
 * extra for 'error'. The exit's hypothetical PRICE needs no transport:
 * the dot lands on the plotted series at that date, which IS the mark.
 */
import { parseOccContractId } from '@options-contract/contracts';
import type { PlottedEntry } from '@options-contract/contracts';
import type { AnalysisResultDoc } from '@options-analysis/contracts';

/** One PlottedEntry per unique contract in a result doc — markerDates =
 *  union of pick days + each pick's terminal marker under the doc's
 *  rule; openDate = earliest marker. Deterministic order: earliest date
 *  then contractId (same convention as contract-list-emit). */
export function resultDocToPlottedEntries(doc: AnalysisResultDoc): PlottedEntry[] {
  const byContract = new Map<string, Set<string>>();
  for (const t of doc.trades) {
    const dates = byContract.get(t.contractId) ?? new Set<string>();
    dates.add(t.pickDate);
    if (t.outcome === 'exit') {
      dates.add(t.exitDate);
    } else if (t.outcome === 'expired') {
      const exp = parseOccContractId(t.contractId)?.expiration;
      if (exp) dates.add(exp);
    } else if (t.outcome === 'open') {
      dates.add(t.lastBarDate);
    }
    // 'error' — pick day only; no terminal marker exists.
    byContract.set(t.contractId, dates);
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
