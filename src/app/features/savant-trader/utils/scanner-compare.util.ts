/**
 * Scanner compare engine — pure bucketing over scan output vs. the
 * tracked-symbol universe (#1098/#1138, FE IMPL §2).
 *
 * Produces a CurationProposalBuckets partition plus supporting rows for
 * the compare panel. Symbol matching is trim + case-fold — stricter than
 * evaluateUniverse's trim-only sanitize, so a tracked 'aapl' still
 * matches a wire 'AAPL'.
 *
 * Bucket semantics (live-probed 2026-10-20 — a scoped+filtered
 * preview_scan returns only matchers, so a single filtered eval cannot
 * separate a screen failure from a scanner-uncovered symbol):
 *
 * - Discovery (runScan): addCandidates = matched ∩ ¬tracked.
 * - Prune (evaluateTracked): the service runs TWO evals — `coverage`
 *   (symbol ANY_OF scope + recipe columns, NO filters: every covered
 *   symbol returns with its metric values) and `matched` (scope +
 *   filters: passers only). `unevaluated` must be the UNION of both
 *   evals' rejected-chunk lists — a symbol absent from coverage because
 *   its coverage chunk failed is unknown, not dead. Then:
 *     dead  = tracked ∧ ¬returned ∧ ¬unevaluated  — where returned =
 *             covered ∪ matched (either response is coverage evidence);
 *             verify-before-drop per CONTEXT.md
 *     noData = tracked ∧ row ∧ noDataPred(row) — checked BEFORE the
 *             matched-pass: a passer whose key metrics read blank is
 *             canonicalization drift or a provider gap, not a clean
 *             keep (distinct from dead — a row exists — and from drop —
 *             no metrics to judge)
 *     drop  = covered ∧ tracked ∧ ¬noData ∧ ¬matched ∧ ¬unevaluated —
 *             covered but failed the screen; dropDetail carries the
 *             coverage row's column values (PRD #15: "the metric values
 *             that failed them")
 *     unevaluated = tracked symbols whose screen verdict is unknown:
 *             ¬returned ∧ chunk-failed, OR covered ∧ matched-chunk-
 *             failed (a rejected coverage chunk yields no row, so union
 *             membership on a covered symbol can only mean its matched
 *             chunk failed). Surfaced separately, folded into NO bucket.
 * - `truncated` is an input flag — the caller derives it via the shared
 *   isScanTruncated contract (no re-derivation here).
 */
import type { CurationProposalBuckets } from '@st/scanner';
import type { ScanRow } from './scanner-rows.util';

/** Compare outcome — buckets + display rows + supporting detail. */
export interface CompareResult {
  /** Display rows with `tracked` stamped (discovery: scan rows; prune: coverage ∪ matched). */
  rows: ScanRow[];
  /** The four-way curation partition (CONTEXT.md: Curation Proposal). */
  buckets: CurationProposalBuckets;
  /** Drop candidate → its coverage-row column values (failing metrics;
   *  keys are wire column names — canonical where the backend renamed,
   *  so label via the recipe's columnLookup). */
  dropDetail: Record<string, Record<string, string>>;
  /** Caller-derived via isScanTruncated — the pure engine only carries it. */
  truncated: boolean;
  /** Prune only: tracked symbols whose screen verdict is unknown —
   *  a rejected chunk left them unscreened (uncovered-side or
   *  matched-side). Excluded from every bucket. */
  unevaluated: string[];
}

/** Normalize for set membership — trim + case-fold, same convention as
 *  evaluateUniverse's symbol sanitize. */
const norm = (s: string) => s.trim().toUpperCase();

const emptyBuckets = (): CurationProposalBuckets => ({
  addCandidates: [],
  dropCandidates: [],
  deadSymbols: [],
  noDataSymbols: [],
});

/** Stamps a copy of each row with its tracked membership. */
function stamp(rows: ScanRow[], trackedNorm: ReadonlySet<string>): ScanRow[] {
  return rows.map((r) => ({ ...r, tracked: trackedNorm.has(norm(r.symbol)) }));
}

/**
 * Discovery compare — results of an unscoped recipe run.
 * addCandidates = matched ∩ ¬tracked; other buckets stay empty
 * (discovery says nothing about tracked symbols' health).
 */
export function compareDiscovery(
  rows: ScanRow[],
  tracked: ReadonlySet<string>,
  truncated: boolean,
): CompareResult {
  const trackedNorm = new Set([...tracked].map(norm));
  const buckets = emptyBuckets();
  const seen = new Set<string>();
  for (const r of rows) {
    const key = norm(r.symbol);
    if (!key || trackedNorm.has(key) || seen.has(key)) continue;
    seen.add(key);
    buckets.addCandidates.push(r.symbol);
  }
  return {
    rows: stamp(rows, trackedNorm),
    buckets,
    dropDetail: {},
    truncated,
    unevaluated: [],
  };
}

/** Args for {@link comparePrune}. */
export interface ComparePruneArgs {
  /** Coverage-eval rows — scope + columns, no filters: one row per
   *  scanner-covered symbol (unfiltered scope scan). */
  coverage: ScanRow[];
  /** Filtered-eval rows — scope + recipe filters: passers only. */
  matched: ScanRow[];
  /** The full tracked universe the eval was scoped to (array — the
   *  service holds the universe list; compareDiscovery takes a Set
   *  because its caller holds the membership view). */
  tracked: string[];
  /** UNION of both evals' rejected-chunk symbols (each evaluateUniverse
   *  call returns its own `unevaluated` — merge before passing, or
   *  coverage-chunk rejections masquerade as dead). */
  unevaluated: string[];
  /** Recipe no-data predicate over a coverage (or matched-fallback) row.
   *  Takes the caller's effective column lookup so the predicate and the
   *  page resolve cells identically under canonicalization drift. */
  noDataPred: (row: ScanRow, lookup?: ReadonlyMap<string, string>) => boolean;
  /** The run's effective column lookup (echo-merged per the store's
   *  mergeLookup) — forwarded to noDataPred so display and bucketing
   *  agree on which key holds a metric. */
  columnLookup?: ReadonlyMap<string, string>;
  /** Caller-derived via isScanTruncated on the eval results. */
  truncated: boolean;
}

/**
 * Prune compare — the tracked universe re-checked against a recipe.
 * See file header for the two-eval semantics; the caller runs both
 * evals and hands over the row sets.
 */
export function comparePrune(args: ComparePruneArgs): CompareResult {
  const trackedNorm = new Set(args.tracked.map(norm));
  const covered = new Set(args.coverage.map((r) => norm(r.symbol)));
  const matched = new Set(args.matched.map((r) => norm(r.symbol)));
  const unevaluatedNorm = new Set(args.unevaluated.map(norm));

  // First row per normalized symbol wins for noDataPred/dropDetail —
  // evaluateUniverse dedupes by trimmed ticker case-sensitively, so a
  // case-variant pair could collide here; one-row-per-symbol holds in
  // practice and the order is at least deterministic.
  const coverageBySymbol = new Map<string, ScanRow>();
  for (const r of args.coverage) {
    const key = norm(r.symbol);
    if (!coverageBySymbol.has(key)) coverageBySymbol.set(key, r);
  }
  // Matched-row fallback for noDataPred — a symbol whose coverage chunk
  // rejected but matched chunk fulfilled still gets its (matched) row
  // predicate-checked, so a blank-metric passer can't keep silently.
  const matchedBySymbol = new Map<string, ScanRow>();
  for (const r of args.matched) {
    const key = norm(r.symbol);
    if (!matchedBySymbol.has(key)) matchedBySymbol.set(key, r);
  }

  const buckets = emptyBuckets();
  const dropDetail: Record<string, Record<string, string>> = {};
  const surfaced: string[] = [];

  const seenTracked = new Set<string>();
  for (const symbol of args.tracked) {
    const key = norm(symbol);
    if (!key || seenTracked.has(key)) continue;
    seenTracked.add(key);
    const inCoverage = covered.has(key);
    const isMatched = matched.has(key);
    // Returned evidence wins over a stale unevaluated entry — a row in
    // either response is proof of coverage; but a covered symbol whose
    // MATCHED chunk rejected was never screened (below).
    if (!inCoverage && !isMatched) {
      if (unevaluatedNorm.has(key)) surfaced.push(symbol);
      else buckets.deadSymbols.push(symbol);
      continue;
    }
    const row = coverageBySymbol.get(key) ?? matchedBySymbol.get(key);
    // No-data before pass: a matched row whose key metrics read blank
    // is drift/gap (the predicate's purpose), not a clean keep.
    if (row && args.noDataPred(row, args.columnLookup)) {
      buckets.noDataSymbols.push(symbol);
      continue;
    }
    if (isMatched) continue; // passed the screen
    // covered ∧ ¬matched: union membership can only mean the matched
    // chunk rejected — the symbol was never screened, so its verdict
    // is unknown, not "failed". Verify-before-drop, same as dead.
    if (unevaluatedNorm.has(key)) {
      surfaced.push(symbol);
      continue;
    }
    buckets.dropCandidates.push(symbol);
    dropDetail[symbol] = { ...row!.values };
  }

  // A matched symbol that isn't tracked is still an add candidate —
  // rare in a scoped eval (scope is the universe) but truthful.
  const seen = new Set<string>();
  for (const r of args.matched) {
    const key = norm(r.symbol);
    if (!key || trackedNorm.has(key) || seen.has(key)) continue;
    seen.add(key);
    buckets.addCandidates.push(r.symbol);
  }

  // Display rows: coverage ∪ matched deduped — the compare panel shows
  // metrics for every covered symbol plus any unscoped match.
  const displayRows: ScanRow[] = [];
  const seenRows = new Set<string>();
  for (const r of [...args.coverage, ...args.matched]) {
    const key = norm(r.symbol);
    if (!key || seenRows.has(key)) continue;
    seenRows.add(key);
    displayRows.push(r);
  }

  return {
    rows: stamp(displayRows, trackedNorm),
    buckets,
    dropDetail,
    truncated: args.truncated,
    unevaluated: surfaced,
  };
}
