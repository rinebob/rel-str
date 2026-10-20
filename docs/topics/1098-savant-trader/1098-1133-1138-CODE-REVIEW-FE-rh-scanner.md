**Topic:** Savant Trader  
**Topic Slug:** savant-trader  
**Thread:** FE Blueprint — RH Scanner Page  
**Thread Slug:** rh-scanner  
**Issue:** #1133  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Task:** #1138  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

# Code Review — #1138 Scanner compare engine

**Verdict: PASS** (after in-review remediation of one HIGH + two MEDIUMs)

Files under review:

- `src/app/features/savant-trader/utils/scanner-compare.util.ts` (new)
- `src/app/features/savant-trader/utils/scanner-compare.util.spec.ts` (new)
- `src/app/features/savant-trader/scanner/scanner-recipes.spec.ts` (+2 specs)

Three axes ran in parallel against the uncommitted diff: Standards,
Spec-fidelity (issue #1138 checklist + IMPL §2 + TEST + PRD ACs +
CONTEXT.md domain terms), and adversarial correctness ("thermo-nuclear"
set-operations/pass). Remediations below; re-verified 49/49 scanner
specs + zero tsc diagnostics on scanner files.

## Remediated

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | HIGH (spec+thermo convergent) | Dead check consulted only `coverage` — a tracked symbol returned by the filtered eval but missing from coverage landed in `deadSymbols` *and* in `rows` stamped tracked (self-contradictory; also violates PRD #16 "absent from every batch response") | `!covered && !matched` → dead; spec added |
| F2 | MEDIUM | `noDataPred` ran after the `matched` early-continue, but canonicalization-drift (the predicate's purpose, #1137 review F5) is precisely `matched ∧ blank` — such symbols silently kept, unflagged | Reordered: returned-evidence → noData → matched-pass → drop; spec added |
| F3 | MEDIUM | `res.unevaluated` emitted verbatim — a covered symbol stale-listed as unevaluated was bucketed AND surfaced as unknown (double-report) | Surfaced list now filtered to tracked ∧ ¬covered ∧ ¬matched; spec asserts it |
| F4 | MEDIUM | `unevaluated` arg contract undocumented — caller must union BOTH evals' rejected-chunk lists or coverage-chunk rejections masquerade as dead | JSDoc + file header state the union requirement; store method doc updated |
| F5 | LOW | `dropDetail[symbol] = row.values` aliased live row state — mutating a display row corrupted the detail | `{ ...row.values }` copy + mutation spec |
| F6 | LOW | Display-row dedupe only against coverage — case-variant matched dups produced 2 rows / 1 addCandidate | Full norm-dedupe over coverage ∪ matched + rows-composition spec |
| F7 | LOW | Standards: `EMPTY_BUCKETS` named like data const (factory), normalization doc overstated evaluateUniverse parity, missing blank-symbol guards, asymmetric `tracked` typing undocumented, missing CompareResult JSDoc, spec import order, vacuous-adjacent truncation block, misleading `qualityNoData` fake name | All fixed (`emptyBuckets()`, reworded header, `!key` guards, arg JSDoc, interface JSDoc, import reorder, divergent-region pin added, `blankKeyMetrics`) |
| F8 | LOW | Real `noDataPred` untested — a QUALITY_LOOKUP regression would silently route blank rows to drops | Recipes spec: canonical-lookup true/false cases incl. blank/non-numeric cells |
| F9 | LOW (docs) | IMPL §2 signature/semantics stale (single-eval model, `dead ∪ unevaluated` formula TEST forbids) | IMPL §2 rewritten: two-eval signature, bucket semantics incl. `returned = covered ∪ matched`, unevaluated separate, store method two-eval note; Last Updated bumped |
| F10 | LOW | Spec gaps: matched-only-not-dead, matched∧blank→noData, rows composition, partial-page truncation (300>100) | All four pinned in spec |

## Accepted / documented, not fixed

- **`dropDetail` carries the whole coverage-row map** (incl. `Name`) —
  superset of "failing values"; keys are wire column names (canonical
  where renamed) so the panel labels via `columnLookup` — documented.
- **`coverageBySymbol` first-wins** under case-variant dups —
  deterministic; one-row-per-symbol holds under evaluateUniverse's
  output; comment added.
- **Ticker punctuation variants** (`BRK.B` vs `BRK-B`) not folded —
  matches evaluateUniverse/parseScanRows convention; flagged as a
  data-quality caveat for the upstream universe owner, not fixed.
- **`truncated` on prune** is nearly always false (150-symbol scope
  chunks can't hit the 200-row cap) — noted in args doc.
- **`matched`-but-uncovered ∧ unevaluated** overlap now resolves to
  keep (matched evidence) — covered by the reorder.

## Spec-fidelity summary

- All four #1138 checklist items: implemented + spec'd.
- TEST edge cases: buckets×4, dead-vs-noData, unevaluated-separate,
  both truncation caps + partial-page, empty universe/results, dedupe,
  case/whitespace normalization — all present.
- PRD ACs satisfiable: #14/#15 drop + failing values (dropDetail =
  coverage row values, spec asserts real keys), #16 dead = absent from
  every response (now literally `covered ∪ matched`), #17 no-data
  distinct, #5 addCandidates = matched-minus-tracked.
- Documented deviations (two-eval signature, `truncated` as input flag,
  `unevaluated` on CompareResult) judged *more* spec-faithful than the
  original IMPL sketch — IMPL §2 updated to match.

## Forward notes

- #1139 store must run evaluateUniverse twice per universe
  (coverage then filtered) and **union both `unevaluated` lists** —
  now spelled out in IMPL §3 and `ComparePruneArgs.unevaluated` JSDoc.
- #1141 relay should assert dropDetail values non-blank for at least
  one drop candidate (proves the coverage eval populated columns).
