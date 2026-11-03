/** Pure helpers for the plotted set's underlying-context window — the one
 *  canonical home for "pick days" semantics and the ~50-session prefix math
 *  shared by the plotted feature (widen/restore fetches, axis domain) and
 *  the viewer store (fetch clamps). */
import type { PlottedEntry } from '@options-contract/contracts';
import type { PlottedContract } from './plotted-contracts-feature';

/** Sessions of underlying context prepended before the earliest pick day —
 *  dated sets open with the price action that produced the selections. The
 *  window counts loaded bar rows, not calendar days. */
export const UNDERLYING_CONTEXT_SESSIONS = 50;

/** Calendar-day lower bound used when widening a FETCH (50 sessions ≈ 70
 *  calendar days — a slight over-fetch that lands ≥50 sessions once bars
 *  arrive; holiday-dense stretches may land a little under). */
export const UNDERLYING_CONTEXT_DAYS = 70;

/** Every date a stored entry contributes as a span-marker vertex —
 *  markerDates unioned with openDate so producers supplying only one of
 *  the two still mark every pick day. Sorted; dates[0] = earliest pick. */
export function markerDatesOf(e: PlottedEntry): string[] {
  return [...new Set([...(e.markerDates ?? []), ...(e.openDate ? [e.openDate] : [])])].sort();
}

export interface ContextAnchor {
  earliest: string;
  symbol: string;
}

/** The set's context anchor — the earliest pick day and the symbol owning
 *  it, in one scan. Null when no contract carries pick days (bare-id sets
 *  get no context prefix). Plotted sets are single-underlying (the parser
 *  rejects cross-symbol lines), so the earliest-owner's symbol IS the
 *  context window's underlying. */
export function contextAnchor(contracts: Record<string, PlottedContract>): ContextAnchor | null {
  let earliest: string | null = null;
  let symbol: string | null = null;
  for (const c of Object.values(contracts)) {
    for (const d of markerDatesOf(c.entry)) {
      if (earliest == null || d < earliest) {
        earliest = d;
        symbol = c.parsed.symbol;
      }
    }
  }
  return earliest == null || symbol == null ? null : { earliest, symbol };
}

/** The earliest pick day across a plotted set — the anchor every context
 *  computation shares. */
export function earliestPickDate(contracts: Record<string, PlottedContract>): string | null {
  return contextAnchor(contracts)?.earliest ?? null;
}

/** ~70d before `earliest` — the fetch lower bound that delivers the
 *  ~50-session context prefix once bars are counted. */
export function pickPrefixFrom(earliest: string): string {
  return new Date(Date.parse(`${earliest}T00:00:00.000Z`) - UNDERLYING_CONTEXT_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);
}

/** The last underlying fetch's request — what the bars in state claim to
 *  span. Coverage is judged on this, not bar dates: returned bars can end
 *  before `to` on weekends/holidays without anything being wrong, and bar
 *  dates can't distinguish "narrowed by a contract fetch" from "data
 *  legitimately ends here". */
export interface FetchRange {
  symbol: string;
  from: string;
  to: string;
}

export type ContextCoverage = { covered: true } | { covered: false; from: string };

/** Coverage check for a dated set's context window — the last requested
 *  range must be for the set's symbol and span
 *  [pickPrefixFrom(earliest), today]. Either edge can be short (a contract
 *  fetch narrows both), or the symbol can be foreign (a load for a
 *  different underlying replaced the bars). `from` on the uncovered branch
 *  keeps the previous request's depth when it ran deeper than the prefix,
 *  so a tail-restore doesn't drop already-loaded history. */
export function contextCoverage(
  range: FetchRange | null,
  anchor: ContextAnchor,
  today: string,
): ContextCoverage {
  const desired = pickPrefixFrom(anchor.earliest);
  if (range == null || range.symbol !== anchor.symbol) return { covered: false, from: desired };
  if (range.from <= desired && range.to >= today) return { covered: true };
  return { covered: false, from: range.from < desired ? range.from : desired };
}
