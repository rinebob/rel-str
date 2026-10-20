**Topic:** Savant Trader  
**Topic Slug:** rh-scanner  
**Thread:** RH Scanner Page  
**Thread Slug:** rh-scanner-page  
**Issue:** #1130  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Task:** #1131  
**Domain:** SHARED  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-19  
**Last Updated:** 2026-10-19  

# Code Review — #1131: Scanner wire + domain contracts

## Verdict: PASS (after in-review remediation)

No blocking findings remain. Five actionable findings across the three axes
were remediated in-flight; the one would-be structural finding was a
scope-boundary false positive (work explicitly assigned to sibling task
#1132). All remaining findings are nit/accepted.

## In-scope files

- `shared/robinhood-mcp-contracts.ts` — scanner wire types
- `shared/scanner-contracts.ts` — recipe/proposal domain types + helpers
- `shared/scanner-contracts.spec.ts` — unit spec
- `functions/scripts/verify/rh-scanner-contracts-1131.ts` — live verify
- `tsconfig.json`, `functions/tsconfig.json`, `jest.config.js` — `@st/scanner` alias
- `1098-1099-1125-{IMPL,TEST}-SAVANT-TRADER-SHARED-*.md` — task docs

`shared/st-collections.ts` and `firestore.rules` are explicitly assigned to
task #1132 and are **not** part of this diff — correctly absent.

## Axis summaries

### Standards — PASS (soft findings remediated)

- **major (remediated):** `parseCurationProposal` hand-rolled shallow
  validation — `dropDetail` was cast to `Record<string, Record<string, string>>`
  after checking only that it was a plain object. Now reuses canonical
  `isPlainObject`/`isStringArray` from `shared/robinhood-mcp-utils.ts` and
  validates the nested per-ticker shape before narrowing.
- **minor (remediated):** `chunkSymbols` could loop forever on `size <= 0`.
  Guard added; spec covers the rejection.
- **minor (remediated):** verify script used `filters: unknown[]`, erasing
  request-side type safety at the seam it exists to check. Now `ScanFilter[]`.
- **nit (remediated):** verify script re-derived truncation logic inline with
  a literal `200` — added comment noting the re-derivation is intentional
  (importing the function's own logic can't catch a bug in it); the literal
  stays, matching `PREVIEW_SCAN_ROW_CAP`.
- **judgment (accepted):** helper exports (`isEnumFilter`, `isExpressionFilter`,
  `serialize/parseCurationProposal`) have few production consumers today —
  they are the typed seam for tasks #1136–#1141, verified by spec rather than
  by premature wiring. Right-sized, not speculative.

### Spec — PASS (all criteria met)

- All named deliverables present: `ScanEnumFilter`, `ScanExpressionFilter`,
  `ScanFilter`, `ScanColumn`, `ScanSort`, `PreviewScanArgs`, `ScanResultRow`,
  `ScanAppliedFilter`, `PreviewScanResult`, `PreviewScanResponse`,
  `ScanRecipe`, `CurationProposalBuckets`, `CurationProposal`,
  `PREVIEW_SCAN_ROW_CAP`; helpers `isEnumFilter`, `isExpressionFilter`,
  `chunkSymbols`, `isScanTruncated`, `serialize/parseCurationProposal`.
- Wire schema verified against the live tool catalog, not the plan sketch:
  `preview_scan` accepts `filters` + `columns` only — no `sort`/`limit`.
  `ScanSort` is correctly modeled as a client-side recipe post-sort field,
  and `sorted_by` as a display string. IMPL doc updated to record this.
- **minor (remediated):** spec lacked expression-column coverage; added a
  case proving `ScanColumn` can carry both `display_name` and `expression`.
- **nit (remediated):** spec comment referenced `st-scanner/proposals`
  without the `/items` anchor segment; clarified the path belongs to #1132.

### Thermo-nuclear — PASS (main finding is a scope-boundary false positive)

- **structural claim — rejected:** "missing `st-scanner` paths + rules" is
  explicitly assigned to sibling task #1132 in the approved Blueprint
  (#1130) and issue body. Not a gap in this task.
- **minor (remediated):** FE IMPL doc derived truncation independently
  (`totalItems ≥ 400 || results === 200`), diverging from the shared helper.
  Doc now directs implementers to `isScanTruncated` from `@st/scanner` —
  single canonical rule.
- All other thermo findings overlapped the Standards items above; no
  remaining over/under-build concerns. File sizes well under limits
  (largest is ~200 lines).

## Test evidence

- `npx jest shared/scanner-contracts.spec.ts` — **13/13 pass** (added
  expression-column case after review began).
- `cd functions && npm run typecheck` — **clean**.
- Root `tsc --noEmit` — **zero scanner-related errors**; residual errors are
  all in concurrent threads' files (`gallery-cards.*`, `bulk-swing-sweep.ts`,
  `indicator-config-dialog`, `core-routes`).
- Live verify `npx tsx scripts/verify/rh-scanner-contracts-1131.ts` —
  **7/7 pass** against the real RH MCP session (enum + symbol-scoped scans).
- Broader jest run — 42 suites pass; 1 failure in
  `screenshot-capture-contracts.spec.ts` is unrelated (concurrent options/
  screenshot thread drift: `PositionType` now has 4 members vs. expected 1).

## Out of scope — deferred findings (not #1131)

- `tests/tsconfig.json` residual ~44 errors across other threads' test
  fixtures (`live-snapshot-pass`, `read-callables`, `signal-date-writer`,
  etc.). `.test.ts` files are a typecheck dead zone — worth a `/proj triage`.
- `screenshot-capture-contracts.spec.ts` failure above — belongs to the
  options/screenshot thread.
