# CODE-REVIEW — #1085 FE slices + compare mode

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1085  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Blueprint:** #1080  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

## Result: PASS

Two review rounds (three axes each: Standards, Spec, Thermo-nuclear)
plus the full test suite. Round 1 found three majors + minors —
remediated in-diff. Round 2 found two real store defects + one
theater test — remediated in-diff and re-verified by both remaining
axes as CLEAN; nothing critical, major, or unresolved remains.

## Round 2 — remediated in-diff

- **Stale compare rows under a new target's label** — `loadCompareDataset`
  patched `compareDatasetId` immediately but left the previous target's
  `compareRows`/`compareColumns` until the fetch landed — wrong data
  rendered under the new chip label for the whole CSV download. The
  load-start patch now clears both; a `Subject`-driven spec covers the
  A→B switch (analysis.store.ts).
- **In-flight compare load survived a delete** — `deleteDataset` cleared
  the compare slot but never unsubscribed `compareSub`, so a late
  landing repopulated `compareRows`/`compareColumns` after the clear →
  phantom "compare skipped columns" notice with no compare active. Now
  unsubscribes when the deleted doc was the compare target; spec covers
  delete-during-load.
- **Test theater** — a component spec emitted `compareSelected` then
  asserted its own spy; dropped (the page spec covers the real
  `selectionChange → store.loadCompareDataset` wiring).
- **Nits picked up on the way** — dead `MatButtonModule` import in
  slice-menu; overclaiming test title; `loadCompareDataset` self-guard
  early-out making the no-self-compare invariant airtight at the store
  boundary, not just the picker. All spec'd.

## Remediated in-diff

- **Histogram legend lied in compare mode** — the baseline `e-series`
  hardcoded `name="full set"` while the overlay checkbox and page
  computed said "compare set". The series now binds
  `[name]="baselineLabel()"` so the legend always matches the data
  (analysis-histogram.component.html). `baselineLabel` input typed
  `'full set' | 'compare set'`.
- **Compare-side filters ran against unknown columns** —
  `filteredCompareRows` applied the active filter chain to compare rows
  with no column check, so a slice predicate on a column the compare
  dataset lacks silently emptied the compare side (AC3's skip-notice
  semantics only covered the primary dataset). The store now records
  `compareColumns` at compare load, `filteredCompareRows` skips
  predicates on absent columns, and `skippedCompareColumns` surfaces
  them (analysis.store.ts). Spec'd.
- **Tools row split responsibility** — the save-slice form lived in the
  page while slice management had its own component. Extracted
  `components/analysis-workbench/workbench-tools.component.ts` — a dumb
  component owning the save form (name + note), slice menu, compare
  picker/chip, and both skip notices; the page only wires store ↔
  component. Spec'd (7 tests).
- **Self-compare hole** — `openDataset` didn't clear `compareDatasetId`,
  so opening the compare target rendered a dataset against itself. The
  store now unsubscribes + clears the compare slot (id, rows, columns)
  when the compare target becomes the active dataset. `deleteDataset`
  clears `compareColumns` too. Spec'd.
- **`skippedSliceColumns` invisible after the snackbar** — the store
  recorded skipped columns but the UI relied on a transient toast. The
  tools row now renders persistent `.skip-note` chips (role="status")
  for both the slice side and the compare side.
- **Menu rows were plain divs** — apply entries are now real
  `mat-menu-item`s (auto-close on apply, roving focus); delete stays a
  plain button so multi-delete doesn't dismiss the menu.
- **Stale save draft** — cancel/close now resets the name + note
  signals; reopening starts empty. Spec'd.
- **Dead `null` union on `onCompare`** — removed with the extraction;
  `compareSelected` emits `AnalysisDatasetDoc` straight to the store.
- **Test erosion** — `as unknown as AnalysisSlice` fixtures replaced
  with fully-typed ones; `updatedAt` added; page spec drives the view
  switch via real `.view-btn` clicks and asserts histogram inputs via
  `By.directive` instead of casting the component; new coverage for
  compare select → `loadCompareDataset`, chip ✕ → `clearCompare`,
  delete → `deleteSlice`, both skip notices, and `canApply=false`
  manage-only mode; store spec asserts the snackbar names the skipped
  column.
- **Doc drift** — IMPL §5 referenced `matMenuContent`; rewritten to
  describe the as-built (`mat-menu-item` semantics, extraction,
  compare-column parity, self-compare guard, persistent notices).

## Round 2 — accepted nits

- **`skippedCompareColumns` empty-compareColumns degenerate** — a
  compare dataset reporting zero columns silently drops every
  predicate; unreachable with real manifests.
- **Duplicate-column skip renders `"x, x"`** — two predicates on one
  missing column list it twice; same in `applySlice`. Cosmetic.
- **`closeDataset` keeps the compare slot** — deliberate (swap primary
  against a fixed baseline), and `openDataset` now clears on
  self-compare; remaining case is the chip reappearing after opening a
  different dataset, which is the intended swap.
- **`addFilter`/`removeFilter` don't reset `skippedSliceColumns`**
  unlike `setFilters`/`clearFilters` — unreachable from the UI (the
  table funnels through `setFilters`).

## Open findings (minor / nit — accepted)

- **`filteredCompareRows` with `compareColumns: []` degenerates to
  unfiltered** — when no compare dataset is loaded the set is empty so
  output is `[]` anyway; harmless ordering artifact, spec covers the
  real case.
- **`row()`/`doc()` fixtures now span four analysis specs** — same
  shared-fixture-builder follow-up noted in #1084's review.
- **Compare picker can't re-select the just-cleared dataset without a
  template re-render** in one edge path — mat-select clears on
  `compareDataset` set; acceptable for v1.
- Nits: `.skip-note` styling is bare italic text (matches the page's
  other inline notices); slice menu's `mat-menu-item` inside a wrapping
  `.slice-item` div skips the CDK's direct-child assumption but
  Material's menu query is descendant-based so focus still roves —
  covered by tests.

## Test results

- `workbench-tools.component.spec.ts` — 6/6 (new)
- `slice-menu.component.spec.ts` — 5/5
- `analysis.component.spec.ts` — 121/121
- `analysis.store.spec.ts` — new: compare-side column skip, self-
  compare clear + load-guard, snackbar names skipped column, A→B
  switch clears stale rows, delete cancels in-flight compare load
- All `analysis*` suites — **green** (round-2 touched suites: 128/128)
- Full suite — **253/253 suites, 4275/4275 tests** (pre-remediation
  run; the analysis batch above covers the post-remediation diff)
- `tsc --noEmit` — clean on the changed surface (two pre-existing
  errors in `scripts/bulk-swing-sweep.ts` and
  `indicator-config-dialog.component.ts` are clean-vs-HEAD and
  unrelated to this diff)
- `ng build` (AOT) — clean

## AC accounting

- AC1 (slice saved on AMAT applies to an all-symbols dataset, filters
  identically) — `applySlice` keeps/splits predicates by `columns()`;
  store spec verifies identical filtering on matching columns.
- AC2 (compare mode: overlaid histograms + side-by-side stats) — stats
  render two `.compare-col` blocks; histogram binds
  `baselineRows = filteredCompareRows()` labeled "compare set" vs the
  filtered "full set" overlay. Verified in the browser by the user.
- AC3 (missing-column slice → skip notice, never silent) — primary side
  records `skippedSliceColumns` → snackbar + persistent `.skip-note`;
  compare side skips by `compareColumns` → `skippedCompareColumns`
  notice. Both spec'd.
