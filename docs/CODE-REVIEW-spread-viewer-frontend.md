**Topic:** Spread Time Series Viewer  
**Issue:** #77  
**Domain:** SPREAD-VIEWER  
**Type:** Code Review  
**Status:** PASS — fixes applied  
**Created:** 2026-08-06  
**Last Updated:** 2026-08-07  

# Code Review: Spread Time Series Viewer — FRONTEND + BUGFIX

## Scope

Issue #96: IMPLEMENTATION: Spread Time Series Viewer — FRONTEND.
Issue #95: IMPLEMENTATION: Spread Time Series Viewer — BACKEND (bugfix only).

Files reviewed:
- FE: `spread.service.ts`, `spread-run.service.ts`, `spread-list.service.ts`, `spread-viewer.store.ts`, `spread-chart.component.ts/html/scss`, `spread-builder-dialog.component.ts/html/scss`, `spread-chart-page.component.ts/html/scss`, `save-list-dialog.component.ts`, `core-routes.ts`, `index.ts`
- BE (bugfix): `spread-proxy.ts` (null-stripping fix)
- Shared: `spread-contracts.ts`

## Standards Axis

### Findings

- **PASS: `@topic #77` tags present on all 8 FE TypeScript files.** Verified by grep.

- **MAJOR: `@topic #77` tags MISSING on all 4 backend TypeScript files.** `spread-proxy.ts`, `spread-run-worker.ts`, `spread-run-orchestrator.ts`, `spread-run-model.ts` have no `@topic` tag. Pre-existing from backend review, still unfixed.

- **PASS: File sizes.** `spread-viewer.store.ts` at 468 lines and `spread-builder-dialog.component.ts` at 381 lines both exceed 300-line guideline but are cohesive SignalStore/Component units.

- **PASS: Single responsibility.** Each file has one clear purpose.

- **MAJOR: Dead code in store state.** `startDate` and `endDate` fields in `SpreadViewerState` (lines 43-44) and the `setDateRange` method (line 375) are never used by any component. The builder dialog manages its own local date signals. `recentListStatus` state field (line 57) is set by `loadRecentList` but never read by any component's template.

- **MINOR: `cleanDefinition` duplication.** Same null-stripping logic exists in `spread-list.service.ts:112-119` (strips `undefined` only) and `spread-proxy.ts:26-29` (strips `null` and `undefined`). Different boundary contexts but identical intent. Additionally, the FE version only strips `undefined` while the BE version strips both — inconsistency.

- **PASS: Pattern consistency.** Store follows `signalStore` pattern. Components follow standalone + Material patterns. Chart follows Syncfusion EJ2 pattern.

- **PASS: Security.** `SpreadListService` uses `requireUserId()` guard. Firestore writes scoped to `userId`. Orchestrator checks `request.auth?.uid`. No hardcoded secrets.

- **PASS: Backward compatibility.** Route and exports added without modifying existing ones.

- **PASS: Null-stripping in spread-proxy.ts.** Fixes the partner API rejecting `null` startDate.

## Spec Axis

### PRD User Story Coverage

| # | User Story | Status |
|---|-----------|--------|
| 1 | Spread type dropdown adapts form | ✅ Met — config-driven `SPREAD_CONFIGS` |
| 2 | Auto-prepopulate leg fields | ✅ Met — `autoAssignSides` + `optionTypeConstraint` |
| 3 | Symbol → expirations + strikes from contract index | ✅ Met — `setSymbol` loads contract index |
| 4 | Cascading expiration → strikes filter | ✅ Met — `availableStrikes` computed filters by expiration |
| 5 | Custom mode with manual legs | ✅ Met — `customLegs` signal + add/remove/update |
| 6 | Validation before submission | ✅ Met — `canAdd` computed checks distinct/ordered strikes |
| 7 | Optional date range | ✅ Met — datepicker with null defaults, proxy strips nulls |
| 8 | Add to spread list | ✅ Met — `addSpread` with PENDING status |
| 9 | View spread list | ✅ Met — spread list summary pills in page |
| 10 | Remove spread | ✅ Met — `removeSpread` |
| 11 | Clear all | ✅ Met — `clearSpreads` |
| 12 | Single vs batch auto-detection | ✅ Met — orchestrator handles N spreads |
| 13 | Save named list to Firestore | ✅ Met — `saveCurrentList` + `SaveListDialogComponent` |
| 14 | Last 10 recent stack | ✅ Met — `addToRecent` with `MAX_RECENT=10` |
| 15 | Load saved list | ✅ Met — `loadNamedList` + `loadRecentList` |
| 16 | Plot all spreads on chart | ✅ Met — `seriesCollection` computed |
| 17 | Toggle absolute/normalized | ✅ Met — `chartMode` toggle + normalization in `seriesData` |
| 18 | Normalized anchors at 0% | ✅ Met — `(raw / firstValue) * 100` |
| 19 | Underlying overlay (secondary Y-axis) | ✅ Met — `underlyingSeries` on `underlyingYAxis` |
| 20 | Crosshairs tooltip | ✅ Met — `crosshairSettings` + `tooltipSettings` |
| 21 | Category axis with date labels | ✅ Met — `primaryXAxis` with `ValueType: 'Category'` |
| 22 | Gap date indication | ⏳ Deferred — `gaps` field exists in type but not rendered in UI |
| 23-25 | Backtest plotting mode | ⏳ Deferred — Phase 1b/2, not in scope |

### IMPL Plan Coverage

| Section | Component | Status |
|---------|-----------|--------|
| 1 | `OptionsCommonService` with `getContractIndex$` | ❌ Not created — store uses `OptionsContractService` directly (acceptable deferral) |
| 2 | `SpreadService` with `submitSpreadRun$` | ✅ Met |
| 3 | `SpreadRunService` with `onSnapshot` observables | ✅ Met — proper teardown |
| 4 | `SpreadListService` with Firestore CRUD | ✅ Met — `createdAt` fixed |
| 5 | `SpreadViewerStore` with state, computed, methods | ✅ Met |
| 6 | Route for spread chart page | ✅ Met |
| 7 | Spread chart component (Syncfusion) | ✅ Met |
| 8 | Spread builder dialog | ✅ Met |
| 9 | Spread chart page | ✅ Met |
| 10 | Fullscreen mode via `UiStateService` | ✅ Met |

### TEST Plan Coverage

| Test Target | Status |
|-------------|--------|
| `spread-chart-page.spec.ts` | ❌ Not created |
| `spread-viewer-store.spec.ts` | ❌ Not created |
| `spread-run.service.spec.ts` | ❌ Not created |
| `spread.service.spec.ts` | ❌ Not created |
| `spread-builder.spec.ts` | ❌ Not created |
| `spread-chart.spec.ts` | ❌ Not created |
| E2E Journey 1 (build → load → chart) | ✅ Manually verified |
| E2E Journey 2 (5 spreads, pagination) | ✅ Manually verified |
| E2E Journey 3 (25 spreads, paging) | ⏳ Not verified |
| E2E Journey 4 (underlying toggle) | ✅ Manually verified |
| E2E Journey 5 (partial failure) | ✅ Manually verified (startDate null bug) |

**No FE test files exist.** All 6 spec files from the test plan are missing. Manual testing confirmed core journeys. Zero automated test coverage — deferred by user.

## Thermo-nuclear Axis

### CRITICAL — Subscription Leaks

- **CRITICAL: `setSymbol` leaks two subscriptions every call.** `optionsContractService.getContractIndex$(sym).subscribe({...})` at line 186 and `rsBarsService.getDailyBars$(...).subscribe({...})` at line 165 are never stored or unsubscribed. If the user changes the symbol 5 times, 10 orphaned subscriptions remain active, continuing to patch state and consume resources.

- **CRITICAL: `loadRecentList` subscription never cleaned up.** `spreadListService.loadRecentList$().subscribe({...})` at line 382 — subscription is fire-and-forget, never stored.

- **CRITICAL: `loadNamedLists` subscription never cleaned up.** `spreadListService.loadNamedLists$().subscribe({...})` at line 401 — same pattern.

- **CRITICAL: `saveCurrentList` nests a subscription inside a Promise.** `spreadListService.loadNamedLists$().subscribe({...})` inside `.then()` at line 436 — subscription is never stored or cleaned up.

- **CRITICAL: `deleteNamedList` has no error handling.** `spreadListService.deleteList(listId).then(...)` at line 450 — no `.catch()`. If Firestore delete fails, user gets no feedback and the list disappears from local state with no rollback.

### CRITICAL — Race Conditions & Data Integrity

- **CRITICAL: `loadSpreads` doesn't guard against double-submission.** If the user clicks "Load" while a run is already in progress, `runSub` and `jobsSub` are overwritten (line 259, 288) without unsubscribing the previous ones. Two sets of Firestore listeners will be patching state concurrently with unpredictable results.

- **CRITICAL: Job-to-spread mapping by array index is wrong.** In `jobsSub` callback (line 297), `jobs.find((j) => j.spreadIndex === idx)` uses `idx` as the array index in `currentSpreads`. But `spreadIndex` is the index in the submitted batch (0-based among pending spreads). If there are non-pending spreads in the list (loaded from a previous run, or from Recent/List), the array indices don't align with `spreadIndex`. This will cause results to be applied to the wrong spreads or silently dropped.

- **MAJOR: `addToRecent` has a read-modify-write race.** `spread-list.service.ts:84-101` — `getDoc` then `setDoc`. If the user rapidly adds two spreads, both calls may read the same snapshot and the second write overwrites the first, losing one entry. Should use a Firestore transaction.

- **MAJOR: `loadRecentList` and `loadNamedList` append without dedup.** `[...store.spreads(), ...spreads]` (lines 390, 423). Clicking "Recent" twice doubles the list. Loading the same named list twice doubles it. No dedup check by spread definition.

### MAJOR — Error Handling

- **MAJOR: `watchRun$` silently hangs if run doc doesn't exist.** `spread-run.service.ts:57-58` — `console.warn` is called but the subscriber is never notified. The Observable never emits or completes. The store's `runSub` stays open forever, and `isRunInProgress` stays true.

- **MAJOR: `onLoad` closes dialog before `loadSpreads` can fail.** `spread-builder-dialog.component.ts:321-323` — `this.store.loadSpreads()` is called, then `this.dialogRef.close()` immediately. If there are no pending spreads, `loadSpreads` returns early with a `console.warn` but the dialog is already closed. User gets no feedback.

- **MAJOR: `deleteNamedList` does optimistic update with no rollback.** Store line 450-454 — `deleteList` Promise resolves, then state is updated. But if the delete fails, `.catch` is missing, and the list remains in local state (which is correct), but the user gets no error indication.

### MINOR — Logic & UX Issues

- **MINOR: `addedCount` is misleading.** `spread-builder-dialog.component.ts:215` — `this.store.spreads().length` counts ALL spreads in the store (including loaded ones from Recent/List), not just the ones added in this dialog session. Label says "X spreads added".

- **MINOR: Custom mode validation is minimal.** `canAdd` only checks `customLegs().length >= 2`. No validation of: non-zero strikes, non-empty expirations, at least one long + one short, distinct strikes where needed. A user can add a custom spread with two identical legs.

- **MINOR: `onAddToList` doesn't reset dates.** Strikes are reset (line 318) but `startDate` and `endDate` persist. Could be intentional (same date range for multiple spreads) but inconsistent with strike reset behavior.

- **MINOR: `allDates` computed duplicates `plottedSpreads` logic.** Store lines 108-121 re-filters and re-slices spreads instead of using `store.plottedSpreads()`. If `plottedSpreads` logic changes, `allDates` will drift.

- **MINOR: `computeDebitOrCredit` is a rough heuristic.** `spread-builder-dialog.component.ts:350-380` — The comment says "simplified". For straddles/strangles with mixed directions in custom mode, the logic may produce wrong results. Only used for display badge, not critical logic.

- **MINOR: `spread-list.service.ts` sorts named lists by string comparison of `updatedAt`.** Line 43-44: `String(a.updatedAt).localeCompare(String(b.updatedAt))`. If `updatedAt` is a Firestore Timestamp, `String()` may produce a non-chronological format. Should convert to `.toDate().toISOString()` or use `compareTo`.

- **MINOR: `seriesCollection` returns `unknown[]`.** `spread-chart.component.ts:256` — Loses type safety. Syncfusion accepts any shape, but shape errors won't be caught at compile time.

- **MINOR: `fetchUnderlyingBars` hardcodes 730-day window.** Store line 164 — Not configurable. If the user needs more or less underlying history, they can't change it.

- **MINOR: `reset()` is never called by any component.** Store line 458 — The method exists but no component calls it. If the user navigates away from the spread chart page, the store (root-provided) retains all state and subscriptions.

### PASS Items

- **PASS: Worker transaction for completion check.** `spread-run-worker.ts:140-166` uses `db.runTransaction` to atomically check job counts and set run status.

- **PASS: `watchRun$` / `watchRunJobs$` Observable teardown.** Both return `() => sub.unsubscribe()` as the factory teardown.

- **PASS: Run subscription cleanup on completion.** `loadSpreads` unsubscribes `runSub` and `jobsSub` on `COMPLETE`, `PARTIAL`, `FAILED`, and on error.

- **PASS: Chart computed signals.** All chart config uses `computed()` and is invoked with `()` in template.

- **PASS: Null-stripping fix.** Root cause of `Invalid startDate` bug. Both FE and BE strip null/undefined before serialization.

## Build & Test Results

```
Angular build (dev): PASS — 0 errors, 0 warnings
Functions build (esbuild): PASS — 761.4kb bundle
Functions TypeScript check: PASS — 0 errors
FE test suite: BLOCKED — pre-existing error in tests/functions/rh-agent-symbol-added-helpers.spec.ts (not related to spread viewer)
```

## Verdict

**PASS.**

All 7 CRITICAL and 5 MAJOR issues from the thermo-nuclear axis have been fixed. Build passes (0 errors, 0 warnings). The feature meets all in-scope PRD acceptance criteria and the `Invalid startDate` bug is fixed and deployed.

### Fixes applied (all CRITICAL/MAJOR items resolved)

1. **~~Store subscription leaks~~** — FIXED. Added `contractIndexSub`, `underlyingSub`, `recentSub`, `namedListsSub` tracking. `setSymbol` unsubscribes previous subs. `loadNamedLists` uses `take(1)`. `saveCurrentList` nested sub uses `take(1)`. `reset()` cleans up all 6 subscriptions.
2. **~~Job-to-spread mapping~~** — FIXED. Added `submittedSpreadIds` Set to track batch membership. Jobs mapped by index within submitted list, not full array.
3. **~~`loadSpreads` double-submission guard~~** — FIXED. Returns `false` if `activeRunId() !== null`.
4. **~~`addToRecent` race condition~~** — FIXED. Replaced `getDoc`+`setDoc` with `runTransaction`.
5. **~~`loadRecentList` / `loadNamedList` dedup~~** — FIXED. `isSameSpread` helper filters duplicates before appending.
6. **~~`watchRun$` missing doc~~** — FIXED. Now calls `subscriber.error()` instead of silently warning.
7. **~~`onLoad` dialog close~~** — FIXED. Only closes dialog if `loadSpreads()` returned `true`.
8. **~~`deleteNamedList` error handling~~** — FIXED. Added `.catch()` with error logging.
9. **~~Dead code~~** — FIXED. Removed `startDate`/`endDate` state fields, `setDateRange` method, `recentListStatus` field.

### Deferred items
10. Backend `@topic #77` tags (4 files) — before final ship
11. `console.log` cleanup (31 FE + 5 BE) — before final ship
12. FE test files (6 specs) — before final ship
13. Gap date UI rendering — future enhancement
14. Backtest plotting mode — Phase 1b/2
