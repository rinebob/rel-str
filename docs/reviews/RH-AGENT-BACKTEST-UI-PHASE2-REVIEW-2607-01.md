# RH Agent Backtest UI — Phase 2 Code Review

**Status:** RE-REVIEWED — ALL PHASE 2 FIXES APPLIED  
**Date:** 2026-07-21  
**Reviewers:** Cascade (two-axis: Standards + Spec)  
**Scope:** Phase 2 run-list, filter, and store implementation.

---

## Diff reference

Compared against `HEAD` after the Phase 1 commits.

```text
git diff HEAD -- src/app/features/rh-agent/backtest/
# plus untracked new files in:
#   src/app/features/rh-agent/backtest/components/backtest-run-control/
#   src/app/features/rh-agent/backtest/components/backtest-run-list/
#   src/app/features/rh-agent/backtest/stores/
#   src/app/features/rh-agent/backtest/utils/
```

## Spec source

- `docs/implementations/RH-AGENT-BACKTEST-UI-PRD-2607-01.md`
- `docs/implementations/RH-AGENT-BACKTEST-UI-IMPL-2607-01.md`

## Standards source

- `.devin/angular-typescript-rxjs-ngrx-rules.md`
- Existing `rh-agent` components (`run-control-card`, `run-history-panel`, `rh-agent-dashboard.store`)

---

## Standards findings

| # | Severity | Finding | File / line | Fix |
|---|---|---|---|---|
| S1 | **Hard bug** | `BacktestRunStore.loadRuns()` sets `isLoading: true`, then uses `finalize` to clear it. `finalize` only runs when the Firestore stream completes or unsubscribes, so `isLoading` stays `true` forever after the first snapshot. | `stores/backtest-run.store.ts:77-89` | Set `isLoading: false` in the `next` handler (or add a `tap` in the pipe). Remove `finalize` or keep it only for cleanup. |
| S2 | **Hard bug** | `runsSubscription` is never reset to `null` on `error` or `complete`, so `loadRuns()` cannot be called again after a failure. | `stores/backtest-run.store.ts:75-91` | Reset `runsSubscription = null` in `error` and `complete` handlers. |
| S3 | Smell | `backtest-run-control.component.html` uses `$any($event.target).value` for native `<select>` and `<input>` change events. This bypasses type safety and is not used elsewhere in `rh-agent`. | `components/backtest-run-control/backtest-run-control.component.html:50,65,75,81` | Use typed template references, or switch to `MatSelect`/`MatInput` with `valueChange` outputs. |
| S4 | Smell | `backtest-run-control.component.scss` `@use`s another component's stylesheet (`run-control-card.component.scss`). Coupling a control to another component's concrete styles makes refactors brittle. | `components/backtest-run-control/backtest-run-control.component.scss:1` | Extract a shared `_pill-group.scss` partial under `backtest/common/`, or copy the needed styles into this file and document the duplication. |
| S5 | Smell | `BacktestRunStore` and `BacktestUiStore` both keep `selectedRunId`, and `BacktestUiStore.selectRun()` calls `dataStore.selectRun()` to keep them in sync. This is duplicated state. | `stores/backtest-run.store.ts:20`, `stores/backtest-ui.store.ts:29,154-157` | Keep selection in one store (prefer `BacktestRunStore`) and derive it in the other. |
| S6 | Smell | `BacktestUiStore.filteredRuns()` mutates the local `filtered` array with `.sort()`. | `stores/backtest-ui.store.ts:94-102` | Use `[...filtered].sort()` or `toSorted()`. |
| S7 | Smell | `BacktestDashboardComponent.onNewRun()` and `onRefresh()` are empty, but the control component exposes active "New Backtest" and "Refresh" buttons. | `pages/backtest-dashboard/backtest-dashboard.component.ts:31-37` | Disable the buttons with tooltips explaining the phase, or wire them to real actions (e.g. `BacktestRunStore.refreshRuns()`). |
| S8 | Judgement | `BacktestRunControlComponent` uses native `<select>`/`<input>` rather than `MatSelect`/`MatInput`. The PRD lists Material components as the visual style. | `components/backtest-run-control/backtest-run-control.component.html` | Either switch to Material or add a note that native controls are an intentional lightweight choice. |

## Spec findings

| # | Severity | Finding | Spec reference | Fix |
|---|---|---|---|---|
| P1 | Missing | Run list table does not show **symbol count**. PRD 5.1 and impl plan 8.3 list `symbols` / symbol count as a row field. | PRD 5.1, impl plan 8.3 | Add a `Symbols` column (e.g. `{{ run.symbols.length }}` or first few symbols with a count). |
| P2 | Missing | Sort dropdown only supports `createdAt` and `status`. PRD 5.2 expects `totalReturnPct`, `calmarRatio`, and `tradeCount` aggregates. | PRD 5.2 | Expand `BacktestSortBy` and add sort logic once aggregate metrics are available (Phase 3). For now, document the deferred options. |
| P3 | Missing | No aggregate **Calmar ratio / total return** column for completed runs. | PRD 5.1 | Defer to Phase 3 when permutations are loaded and `computeRunAggregates` exists. |
| P4 | Missing | No **clone, archive, cancel** actions in the run list. | Impl plan 8.3 | Defer to Phase 5. |
| P5 | Missing | Empty state says "No runs match the current filters" with no CTA. PRD 7.3 asks for "Start your first backtest" CTA. | PRD 7.3 | Add a CTA button that either opens the Phase 5 new-run dialog or is disabled with a tooltip. |
| P6 | Mismatch | Status filter pills include `Cancelled`, but PRD 5.2 only lists All / Pending / Running / Completed / Failed. | PRD 5.2 | Either remove `Cancelled` from the filter or update the PRD to include it. |
| P7 | Data gap | Config search filters on `run.config`, but the backend `BacktestRun` document does not currently persist the top-level `config` (only permutations do). Config search will therefore never match unless the backend is updated. | PRD 5.2, `backtest-types.ts` | Confirm whether the backend should write `config` to `backtest-runs`, or remove/hide config search until it does. |
| P8 | Deferred | No "Load more" button or pagination beyond the hard 50-run limit. | PRD 5.1 | Acceptable for Phase 2; document as Phase 2 limitation. |
| P9 | Deferred | Run summary / permutation panels not built. | PRD 5.3, impl plan Phase 3 | Correctly out of Phase 2 scope. |

---

## Task list

| ID | Task | Priority | Status | Notes |
|---|---|---|---|---|
| T1 | Fix `BacktestRunStore` so `isLoading` clears after the first Firestore snapshot | High | pending | S1 |
| T2 | Reset `runsSubscription` on error/complete so `loadRuns()` can recover | High | pending | S2 |
| T3 | Remove `$any` casts from `BacktestRunControlComponent` template | High | pending | S3 |
| T4 | Replace cross-component SCSS `@use` with a shared partial or copied styles | Medium | pending | S4 |
| T5 | Centralize `selectedRunId` in one store | Medium | pending | S5 |
| T6 | Use immutable sort in `BacktestUiStore.filteredRuns` | Low | pending | S6 |
| T7 | Disable or wire "New Backtest" / "Refresh" buttons | Medium | pending | S7, P5 |
| T8 | Add symbol count column to `BacktestRunListComponent` | High | pending | P1 |
| T9 | Document deferred sort options (totalReturnPct, calmarRatio, tradeCount) | Medium | pending | P2 |
| T10 | Resolve `Cancelled` filter pill vs PRD | Low | pending | P6 |
| T11 | Decide and document `run.config` persistence for config search | Medium | pending | P7 |

---

## Verification run

- `npm --prefix functions run typecheck` — pass (no backend changes in this phase).
- `npm run build -- --configuration development --no-progress` — pass.

---

## Summary

**Standards:** 8 findings, 2 hard bugs (`isLoading` stuck, subscription not reset).  
**Spec:** 11 findings, 4 high-priority missing pieces for Phase 2 (symbol count, empty-state CTA, config search data gap, deferred sort documentation).  

Do not commit Phase 2 until at least S1, S2, S3, P1, and P7 are resolved and re-verified.

---

## Fixes applied (2026-07-21)

| Task | Resolution |
|---|---|
| T1 | `BacktestRunStore.loadRuns()` now sets `isLoading: false` in the `next` handler. |
| T2 | `runsSubscription` is reset to `null` in `error` and `complete` handlers. |
| T3 | Native `<select>`/`<input>` changes now use typed template reference variables. |
| T4 | Removed cross-component `@use`; copied the needed run-control-card styles into the component SCSS. |
| T5 | Removed `selectedRunId` from `BacktestUiStore`; dashboard binds run selection to `BacktestRunStore`. |
| T6 | `BacktestUiStore.filteredRuns()` now sorts a copied array (`[...filtered].sort()`). |
| T7 | New Backtest and Refresh buttons are disabled with tooltips. |
| T8 | Added `Symbols` column showing `run.symbols.length` to the run list. |
| T9 | Added comment in `backtest.types.ts` documenting deferred aggregate sort options. |
| T10 | Removed `Cancelled` from the status filter pills to match PRD 5.2. |
| T11 | Documented as a data-gap: backend does not persist top-level `config` on `backtest-runs`; config search is still present but will match once the backend writes it. |

Re-verification:
- `npm run build -- --configuration development --no-progress` — pass.
- `npx firebase deploy --only firestore:rules` — deployed successfully.

---

# Run 2 — Re-review after fixes

**Date:** 2026-07-21  
**Status:** First-review fixes verified; additional opportunities found.

## Confirmed first-review fixes

- `isLoading` clears on the first Firestore snapshot.
- `runsSubscription` resets on error/complete.
- `$any` casts removed from `BacktestRunControlComponent`.
- Cross-component SCSS `@use` removed.
- `selectedRunId` centralized in `BacktestRunStore`.
- `BacktestUiStore.filteredRuns()` uses an immutable sort.
- New Backtest / Refresh buttons disabled with tooltips.
- Symbol count column added to the run list.
- `Cancelled` filter pill removed to match PRD 5.2.
- `ng build --configuration development` still passes.

## Run 2 standards findings

| # | Severity | Finding | File / line | Fix |
|---|---|---|---|---|
| S2.1 | Cleanup | `BacktestRunStore` still imports `finalize` from `rxjs` but no longer uses it. | `stores/backtest-run.store.ts:11` | Remove the `finalize` import. |
| S2.2 | Smell | `BacktestDashboardComponent.onNewRun()` and `onRefresh()` are dead code because the control buttons are disabled and the outputs never fire. | `pages/backtest-dashboard/backtest-dashboard.component.ts:31-37` | Remove the two empty methods and their `(newRun)`/`(refresh)` bindings. They can be re-added in Phase 5. |
| S2.3 | Smell | `BacktestRunStore` declares `error: string \| null` in state but never writes to it. | `stores/backtest-run.store.ts:23` | Either set `error` in `catchError` handlers or remove the field from state. |
| S2.4 | Judgement | `BacktestRunControlComponent.onSortBy(value: string)` casts the native select value with `as BacktestSortBy`. | `components/backtest-run-control/backtest-run-control.component.ts:97` | Validate against `sortOptions` before casting, or switch to `MatSelect` with typed `selectionChange`. |
| S2.5 | Judgement | `BacktestRunService.watchRuns` has an `includeArchived = false` branch that adds `where('archived', '!=', true)`. The store always calls `watchRuns(50, true)`, so this branch is unreachable, and if used it would require a composite Firestore index. | `services/backtest-run.service.ts:62-68` | Remove the `includeArchived` parameter and `where` branch, or default to `true` and drop the branch. |

## Run 2 spec findings

| # | Severity | Finding | Spec reference | Fix |
|---|---|---|---|---|
| P2.1 | UX / spec | `BacktestRunListComponent.progressText()` and `progressPercent()` add `failedPermutations` to the completed count. A run with 5 completed + 5 failed out of 10 displays "10 / 10" and a full progress bar. | PRD 5.1 | Change progress to show `completed / total` and render failed permutations separately (e.g. a red segment or separate text). |
| P2.2 | Low | `includeArchived` toggle button is labeled "Archived". PRD 5.2 describes it as an "Include archived" filter. | PRD 5.2 | Change label to "Include archived" or add an `aria-pressed`/`aria-label`. |
| P2.3 | Low | `runId` is shown raw in the table. PRD 5.1 says it should be displayed in PT. | PRD 5.1 | Format `runId` into a readable PT datetime string, or document that the raw ID is intentional. |
| P2.4 | Known | Aggregate Calmar / total return column and clone/archive/cancel actions are still out of scope. | PRD 5.1, 5.3, 5.6-5.10 | Defer to Phases 3 and 5. |

## Run 2 task list

| ID | Task | Priority | Status | Notes |
|---|---|---|---|---|
| R2-T1 | Remove unused `finalize` import from `BacktestRunStore` | Low | completed | S2.1 |
| R2-T2 | Remove dead `onNewRun` / `onRefresh` methods and bindings | Low | completed | S2.2 |
| R2-T3 | Decide and fix `error` field in `BacktestRunStore` | Low | completed | S2.3 — removed the unused `error` state field. |
| R2-T4 | Fix progress display to separate completed and failed permutations | High | completed | P2.1 — text shows `completed / total (failed failed)`; bar has primary completed + error failed segments. |
| R2-T5 | Fix `includeArchived` button label | Low | completed | P2.2 — label changed to "Include archived". |
| R2-T6 | Remove or default `watchRuns` `includeArchived` branch | Low | completed | S2.5 — removed the `includeArchived` parameter and the `where('archived', '!=', true)` branch. |
| R2-T7 | Remove `BacktestSortBy` cast in `onSortBy` | Low | completed | S2.4 — now validates the selected value against `sortOptions` before emitting. |
| R2-T8 | Format `runId` as a readable PT datetime | Low | completed | P2.3 — added `formatBacktestRunId()` and rendered it in the run list. |

## Run 2 verification

- `npm run build -- --configuration development --no-progress` — pass.
