**Topic:** Savant Trader  
**Topic Slug:** savant-trader  
**Thread:** FE Blueprint — RH Scanner Page  
**Thread Slug:** rh-scanner  
**Issue:** #1156  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Task:** #1138  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

# UAT — #1138 Scanner compare engine

**Task under QA:** #1138 (FE-IMPL: compare engine util)  
**Prereqs:** task at `7_QA`; review PASS
(`1098-1133-1138-CODE-REVIEW-FE-rh-scanner.md`); QA issue #1156 open.  
**Result: PASS** — all four scenarios green with fresh evidence.

## Scenarios

### 1. Focused jest suites — compare engine + neighbors

    npx jest src/app/features/savant-trader/scanner \
              src/app/features/savant-trader/utils/scanner --coverage=false

Expect: all suites pass — compare bucket specs (add/drop/dead/no-data),
unevaluated separation, case/whitespace normalization, empty universe/
results, dropDetail scoping + copy semantics, both truncation caps +
partial-page, plus the catalog collision-guard and real-noDataPred specs.

Result: PASS — 49/49 (compare 22, rows 9+, recipes 18).

### 2. TypeScript diagnostics on touched files

    npx tsc --noEmit -p tsconfig.json | grep -i scanner

Expect: zero scanner diagnostics (pre-existing unrelated diagnostics in
`scripts/bulk-swing-sweep.ts` and `indicator-config-dialog` are
out-of-scope user work).

Result: PASS — zero scanner diagnostics.

### 3. Bucket semantics vs. issue checklist / PRD ACs

Walk the spec file against the issue body:

- compareDiscovery: tracked flags stamped, addCandidates =
  matched ∧ ¬tracked deduped — spec'd + impl'd ✓
- comparePrune: dead = tracked ∧ ¬(covered ∪ matched) ∧ ¬unevaluated
  (PRD #16 "absent from every batch response"); noData = returned ∧ blank
  (before the matched-pass — drift case); drop = covered ∧ ¬matched ∧
  ¬noData with dropDetail = coverage-row values (PRD #15 "metric values
  that failed them"); unevaluated surfaced separately, never dead ✓
- truncated: caller derives via shared `isScanTruncated`; boundary specs
  pin total-items cap, 200/200 row cap, and the partial-page
  (300 > 100) region ✓
- Edge cases per TEST: all four buckets, dead-vs-no-data, unevaluated
  separation, empty universe/results, dedupe/case normalization ✓

Result: PASS.

### 4. Diff footprint

Expect: scoped to the task — two new compare files, one recipes-spec
addition (collision guard + noDataPred specs, both flagged in review),
IMPL doc §2 signature/semantics correction.

Result: PASS — `scanner-compare.util.ts`, `scanner-compare.util.spec.ts`
(new); `scanner-recipes.spec.ts` (+2 specs); FE IMPL doc §2 + store
method note (documented in review F9).

## Live-probe evidence (design input, not a gate)

Two-eval prune semantics verified against the real backend during
implementation: scoped+filtered `preview_scan` (ANY_OF
[AAPL,MSFT,GME,INTC,BB] + quality filters) returned only MSFT/GME —
confirming absent symbols can't be split into dead/failed without the
unfiltered coverage eval. The probe also surfaced the
column/filter `display_title` collision wire error, now guarded by a
catalog spec.
