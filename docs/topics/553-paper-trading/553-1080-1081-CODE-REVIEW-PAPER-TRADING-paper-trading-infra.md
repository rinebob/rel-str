# CODE-REVIEW — #1081 FE analysis service + store

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1081  
**Blueprint:** #1080  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Task:** #1081  
**Domain:** PAPER-TRADING  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-19  
**Last Updated:** 2026-10-19  

## Verdict: PASS (one finding fixed during review)

## Scope

Working-tree diff covering only the #1081 files (the tree also holds
unrelated #1007/#1008/#1024/gallery work — excluded):

- `src/app/features/savant-trader/services/analysis.service.ts` (new)
- `src/app/features/savant-trader/services/analysis.service.spec.ts` (new)
- `src/app/features/savant-trader/stores/analysis.store.ts` (new)
- `src/app/features/savant-trader/stores/analysis.store.spec.ts` (new)
- `src/app/features/savant-trader/utils/analysis-rows.util.ts` (new — pure
  filter/sort helpers extracted from the store)
- `firestore.rules` (authed update+delete on `analysis-datasets` anchor;
  create stays callable-only)
- `storage.rules` (authed delete on `analysis-datasets/` objects)
- `package.json` / `package-lock.json` (`papaparse@5.7.0` + `@types/papaparse`)
- FE IMPL doc (§1 as-builts)

## Standards

- Firestore patterns verified against `AllocationBucketService` precedent —
  `requireUserId` auth gate, `runInInjectionContext`, `updateDoc` merge,
  `query`/`orderBy`. Storage `getDownloadURL` matches the trade-journal
  precedent. Store is the established `signalStore` shape with the
  paper-trading store's subscription-cancel pattern.
- File sizes under threshold: service ~200, store ~375 (pure row
  filter/sort extracted to `analysis-rows.util.ts`, ~68), util pure.
- No duplicated contracts — coerces via shared `COLUMN_TYPES` keyed by
  `ANALYSIS_COLUMNS`; no FE re-declaration of the manifest.
- No `any`/`as never` in production code. One localized
  `as unknown as TradeAnalysisRow` at the CSV coercion boundary — necessary
  (a malformed/legacy CSV can legitimately yield null for nominally
  non-null fields; every manifest key is still populated). Specs use
  `as jest.Mock` casts consistent with codebase spec style.
- Tests exercise public behavior at seams (`@angular/fire/*` + `fetch`
  boundary; real papaparse), not implementation details.

## Spec (all #1081 ACs traced)

- Index list ordered `generatedAt` desc; `updateTagsNotes` merge; delete
  removes Storage object then index doc, tolerates `object-not-found`
  (generating/failed datasets) — spied both.
- `loadDataset$` — `gcsPath` → `getDownloadURL` → `fetch` → real papaparse;
  header-name binding survives reorder + appended columns; absent manifest
  columns → null; every manifest key present; returns `{rows, columns}`
  for missing-column slice detection.
- Slice CRUD — list / save (Firestore auto-id) / update / delete on
  `analysisSlicesPath()`.
- Store — datasets/activeDataset/rows/columns/filters/slices/compare/
  sorts/loading/error; `filteredRows` AND composition (enum ∈, numeric
  range, date range); nulls never match bounded filters; same filters on
  compare rows; sort chain = #1067 asc→desc→removed, additive; slice apply
  skips absent-column predicates → `skippedSliceColumns` + snackbar notice;
  race-cancel on open/close/compare loads; stale compare + skipped-column
  state cleared on delete/close.

## Findings

Fixed during review:

- **minor → fixed** — `updateTagsNotes` diverged between layers: service
  wrote `notes: null` when the arg was omitted while the store's
  optimistic patch left `notes` untouched. Now `notes?: string | null` —
  omitted = don't touch, `null` = explicit clear; spec pinned.

Held clean / nits (no change):

- `openDataset` doesn't pre-guard `status !== 'ready'` — a generating
  dataset surfaces a Storage error cleanly; the UI gate is #1082's scope.
- `updateSlice$` has no store consumer yet — rename/save-as is #1085; in
  scope per the task body and spec-covered.
- Redundant `take(1)` after `requireUserId` — harmless, matches the
  allocation-bucket precedent.

## Test results

- Targeted specs: **37/37** green (service + store).
- `npx tsc -p tsconfig.app.json --noEmit`: clean.
- Full suite: **3,940/3,942** — the 2 failures are pre-existing,
  out-of-scope drift in concurrent working-tree changes:
  `screenshot-capture-contracts.spec` (PositionType expanded for options
  work; spec not yet updated) and `sidenav-menu.component.spec` (new
  DS Gallery dev route; spec not yet updated). Neither file is in the
  #1081 diff.

## Deploy note

Rules changes are **already deployed** (firestore + storage, user-run).
`firestore.indexes.json` drift vs live indexes/TTL remains a separate
housekeeping item — unrelated to this task.
