# Code Review — #1136 previewScan spec + row-model parser

**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** RH Scanner Page  
**Thread Slug:** rh-scanner-page  
**Issue:** #1136  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Task:** #1136  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-19  
**Last Updated:** 2026-10-19  

## Scope reviewed

- `src/app/core/robinhood-mcp/robinhood-mcp-client.service.ts` — Scanner
  section: `ScanRunResult`/`UniverseEvalResult`, `previewScanSpec`/
  `previewScan`, `evaluateUniverseSpec`/`evaluateUniverse`, shared
  `parseScanResult` gate.
- `src/app/core/robinhood-mcp/robinhood-mcp-client.service.spec.ts` —
  `describe('scanner')` block.
- `src/app/features/savant-trader/utils/scanner-rows.util.ts` — `ScanRow`,
  `parseScanRows`, `buildColumnLookup`, `canonicalColumnName`,
  `numericColumn`, `percentColumn`.
- `scanner-rows.util.spec.ts` — fixture verbatim from dep-prev-scan-01.

## Axes

### Standards — PASS (after remediation)

Compliant overall: doc-block headers, section banners, spec/parse ToolSpec
pattern, capture-verbatim fixture, file-internal jasmine idiom retained.
Fixed: merged duplicate `import type` lines in the util spec. Accepted:
describe groups two related methods under shared fixtures; result types
colocated beside `ToolSpec` (its own precedent); `#1098`/`#1136` ref mix.

### Spec — PASS (all checklist items; one deviation accepted)

Every checklist item implemented; TEST-doc unit coverage present. Accepted
deviations: `evaluateUniverse` returns `{rows, unevaluated, filtersApplied}`
(IMPL requires the caller to know unevaluated symbols; the shape is the
carrier); `evaluateUniverseSpec` now returns `ToolSpec<PreviewScanResult>`
not `ScanResultRow[]` — needed to surface `filters_applied` (F2/D1).

### Thermo-nuclear — findings remediated

- **F1 (remediated):** `display_title` echoes (dep-prev-scan-04) map a
  column's name to the title, which no row carries — the coercers now
  fall back to the raw display name when the mapped key is absent
  (presence wins over a wrong remap). Spec added.
- **F2 (remediated):** `filters_applied` was parsed off the wire then
  dropped — now surfaced as `filtersApplied` on both result types (first
  fulfilled chunk for `evaluateUniverse`); `sortedBy` on `ScanRunResult`.
- **F3 (remediated):** success-with-missing-`data.result` previously
  read as "evaluated, zero matches" — silent data loss for up to 150
  tracked symbols per chunk. Both specs now throw `RobinhoodMcpError`
  via `parseScanResult`. Spec added.
- **F4 (remediated):** whitespace-only cells coerced to `0` (would have
  counted as real data for the no-data bucket). Now null. Spec added.
- **F5 (partially):** `filters_applied` echo ↔ column expression match
  is now whitespace-normalized; backend-injected defaults
  (`session="all"`) can still miss — documented limitation.
- **F6 (remediated):** baked-in scope strip now matches
  `expression.trim().toLowerCase() === 'symbol'`.
- **F7 (documented):** batch-level transport failure rejects the whole
  call intentionally — degraded sessions surface as errors. JSDoc now
  says so; spec added.
- **F8 (remediated):** `evaluateUniverse` sanitizes input
  (trim/dedupe/drop-empty) and dedupes on trimmed ticker — consistent
  with `batchQuotes` precedent and `parseScanRows` normalization.
- **F9 (remediated):** new specs cover the missing-`data.result` throw,
  >20-chunk multi-group split, transport-reject propagation,
  `filtersApplied` surfacing, ANY_OF predicate literal, and the
  display_title echo counterexample.

## Test results

- `npx jest scanner-rows.util.spec.ts robinhood-mcp-client.service.spec.ts`
  → **100/100** (12 util + 88 client).
- Root `tsc --noEmit` → zero diagnostics on scanner/client files
  (other-session residuals unrelated).

## Verdict: PASS (two rounds, converged)

### Round 2 sweep (new-findings-only)

All R1 remediations verified correct by all three axes; no regressions.
R2 surfaced four LOWs + doc nits, remediated:

- **N1 (remediated):** element-level wire drift — `results:[null]` /
  `filters_applied:[null]` / non-string cells would `TypeError` through
  aggregation instead of surfacing as `RobinhoodMcpError`. Guards added:
  `parseScanResult` requires every row be an object; `parseScanRows`
  skips non-object rows; `buildColumnLookup` skips non-object echoes;
  `numericColumn` requires a string cell before trim. Spec added for the
  null-row throw.
- **N2 (remediated):** `norm()` stripped whitespace inside string
  literals — quote-aware strip now (whitespace outside quoted args only).
- **N3/doc nits (remediated):** `filtersApplied` JSDoc now says
  "first fulfilled chunk *with a non-empty echo*"; stale file-header
  "parallel fetch" → batch-endpoint wording; spec fixture pinned with
  `satisfies ScanRecipe`; misleading "across chunks" spec title corrected.
- **N4 (documented, deferred):** the injected `symbol ANY_OF` scope
  echoes inside `filtersApplied` — a future consumer rendering applied
  filters sees a ~150-value synthetic entry; strip `expression ===
  'symbol'` echoes at the page layer (#1137+) if surfaced. Also: a recipe
  whose identity IS an index scope evaluates tracked non-members as
  matches — noted for recipe-catalog authoring.

Post-R2 verification: **101/101** specs green; root tsc clean on touched
files.

### Round 1

Three axes converged after remediation. Remaining documented limitations:
backend-injected expression defaults can still miss the lookup join
(F5 residual — rows still key by `display_name`, so misses are benign);
`columnLookup` is response-derived — recipe-declared lookups stay
unresolved until the recipe-catalog task (#1137) decides.
