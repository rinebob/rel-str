---
description: Refactor RH Agent signal-review filters and state management
---

# RH Agent Signal Review Filter Refactor

## Metadata

- **Author**: Cascade (AI pair programmer)
- **Date**: 2026-07-11
- **Status**: In planning
- **JIRA-equivalent**: N/A
- **Related docs**:
  - `RH-AGENT-THERMO-2607-01_rh-agent-thermonuclear-review-remediation.md`
  - `RH-AGENT-USER-WORKFLOW-2607-01_daily-signal-review.md`

## Goal

Move the new timeframe/direction filters for the grouped signal review from the component layer into the store/data layer, eliminate duplicated filter logic, and clean up the state-management boundaries so the signal-review page has a single source of truth for visible rows and counts.

## Current Problems

1. **Filter logic copy-pasted in four components**
   - `signal-review.component.ts` (`visibleRowsMap`)
   - `group-panel.component.ts` (`hasDirection`, `visibleLongCount`, `visibleShortCount`)
   - `symbol-row.component.ts` (`filteredLatestSignals`)
   - `symbol-signal-history.component.ts` (`recentSignals`)

2. **Filter state lives in the page component**
   - `signalFilter` is a local signal in `SignalReviewComponent`.
   - It is drilled through `signal-review-header → signal-review → group-panel → symbol-row → symbol-signal-history`.
   - Row filtering happens *after* `groups` is computed, so store-level counts (`longCount`, `shortCount`, header totals) no longer match visible rows.

3. **State boundaries are blurred**
   - `activeRunId` / `activeRunMarketDate` exist in both `RhAgentGroupStore` and `RhAgentTriageStore` and are manually synced.
   - `SignalReviewComponent` injects five stores and re-implements load orchestration in `ngOnInit`.
   - `RhAgentGroupStore` mixes domain data (`signalSymbols`, `allSymbols`) with page UI state (`selectedSymbol`, `quickChartSymbol`, `showAllSymbols`, `fullGroupToggles`).

4. **History cache key duality**
   - `RhAgentSymbolHistoryStore` caches both `symbol` and `symbol::runId`.
   - The group-building logic knows the cache-key construction rule.

5. **Miscellaneous code-quality issues**
   - Orphaned `clearTriage` output in `signal-review-header`.
   - Hardcoded hex colors in the header SCSS.
   - `track $index` in `symbol-signal-history`.
   - No unit tests for filtering logic.

## Target Architecture

### State ownership

| Concern | Owner |
|---|---|
| Active run context (runId, marketDate) | `RhAgentGroupStore` (single source of truth) |
| Symbol/group domain data | `RhAgentGroupStore` |
| PACR triage statuses | `RhAgentTriageStore` |
| User-defined symbol lists | `RhAgentSymbolListStore` |
| Per-symbol signal history cache | `RhAgentSymbolHistoryStore` |
| Page-local UI (filters, selection, expansion, quick chart) | `SignalReviewUiStore` (new) |

### Data flow

1. User picks a run → `RhAgentGroupStore.setActiveRun(runId, marketDate)`.
2. Store loads signal symbols, symbol lists, and triage decisions.
3. `RhAgentGroupStore.groups` computed derives rows from:
   - `signalSymbols`, `allSymbols`, `showAllSymbols`
   - `groupDimension`, `fullGroupToggles`
   - `symbolLists`, `activeListFilter`
   - `triageStore.statuses`
   - `historyStore` caches
   - **`signalFilter` (new input to `buildSymbolGroups`)**
4. Header and group panels read already-filtered counts from `groups`.
5. Symbol rows receive pre-filtered `row.signals`; no per-component re-filtering for row inclusion.
6. `symbol-signal-history` may still apply filter for display, but via a canonical helper.

## Files Affected

### Read/write

- `src/app/features/rh-agent/common/rh-agent.constants.ts`
- `src/app/features/rh-agent/utils/rh-agent.utils.ts`
- `src/app/features/rh-agent/stores/rh-agent-group.store.ts`
- `src/app/features/rh-agent/stores/signal-review-ui.store.ts` (new)
- `src/app/features/rh-agent/pages/signal-review/signal-review.component.ts`
- `src/app/features/rh-agent/pages/signal-review/signal-review.component.html`
- `src/app/features/rh-agent/components/signal-review-header/signal-review-header.component.ts`
- `src/app/features/rh-agent/components/signal-review-header/signal-review-header.component.html`
- `src/app/features/rh-agent/components/signal-review-header/signal-review-header.component.scss`
- `src/app/features/rh-agent/components/group-panel/group-panel.component.ts`
- `src/app/features/rh-agent/components/group-panel/group-panel.component.html`
- `src/app/features/rh-agent/components/symbol-row/symbol-row.component.ts`
- `src/app/features/rh-agent/components/symbol-row/symbol-row.component.html`
- `src/app/features/rh-agent/components/symbol-signal-history/symbol-signal-history.component.ts`
- `src/app/features/rh-agent/components/symbol-signal-history/symbol-signal-history.component.html`

### Read-only reference

- `src/app/features/rh-agent/stores/rh-agent-triage.store.ts`
- `src/app/features/rh-agent/stores/rh-agent-symbol-list.store.ts`
- `src/app/features/rh-agent/stores/rh-agent-symbol-history.store.ts`
- `src/app/features/rh-agent/services/rh-agent-signal.service.ts`

## Phases

### Phase 1 — Canonical filter helper

1. Add `filterSignals(signals, filter)` and `matchesSignalFilter(signal, filter)` to `rh-agent.utils.ts`.
2. Add `signalMatchesProfileFallback(filter, profile)` helper for the “no loaded signals” case used by `visibleRowsMap`.
3. Update all four duplicated filter sites to call the helper.
4. No behavior change.

**Acceptance:** `ng build` passes; filtering behavior identical.

### Phase 2 — `SignalReviewUiStore`

1. Create `src/app/features/rh-agent/stores/signal-review-ui.store.ts`.
2. Move into it from `SignalReviewComponent`:
   - `signalFilter`
   - `expandedGroups`
   - `allExpanded`
   - `toggleExpandAll()` / `onExpandAll()` logic
3. Keep `selectedSymbol` and `quickChartSymbol` in `RhAgentGroupStore` for now (they cross pages indirectly), or move them later if scope allows.
4. Expose `visibleGroups` or keep `groups` in group store; the UI store only owns filter + expansion.

**Acceptance:** Page still works; component is thinner.

### Phase 3 — Move filter into `buildSymbolGroups`

1. Add `signalFilter?: SignalFilter` to `BuildSymbolGroupsInput`.
2. Apply filter during row construction in `buildSymbolGroups`:
   - For rows with loaded signals, keep the row if any signal matches the filter.
   - For rows without loaded signals, apply the same profile fallback used by `visibleRowsMap`.
3. Compute group `longCount` / `shortCount` from the already-filtered visible rows.
4. Remove `visibleRowsMap` from `SignalReviewComponent`.
5. Remove `filter` drilling through `group-panel` and `symbol-row`; only header and history components need it.
6. Update header counts to derive from `groups` when they should reflect the active filter.

**Acceptance:** Filtering works end-to-end; header/group counts match visible rows; build passes.

### Phase 4 — Clean up state boundaries

1. Remove duplicate `triageStore.setActiveRun` call from `SignalReviewComponent.ngOnInit`; rely on `groupStore.setActiveRun`.
2. Consider centralizing active-run context in `RhAgentGroupStore` only and having `RhAgentTriageStore` read it (optional, depends on risk).
3. Move loading orchestration out of the component into `RhAgentGroupStore` or a `SignalReviewFacade`.
4. Fix orphaned `clearTriage` output (wire or remove).

**Acceptance:** Component injects at most 3 stores; no duplicate load calls.

### Phase 5 — Polish and tests

1. Extract a `signal-filter-pills` component from the header.
2. Replace hardcoded hex colors with theme CSS variables.
3. Use stable `track` expression in `symbol-signal-history`.
4. Fix `symbolListStore.toggleSymbolInList` in-place mutation.
5. Add unit tests for `filterSignals`, `buildSymbolGroups`, and `SignalReviewUiStore`.

**Status:** Items 1–4 done. Item 5 tests written but not yet executed.

**Acceptance:** Build + tests pass; no orphaned outputs; theming consistent.

## Thermo-Nuclear Review Follow-Up

A second thermo-nuclear review identified remaining structural issues. These are now part of the refactor scope.

### Original tasks not fully completed

| Original task | Why it is not done | Plan |
|---|---|---|
| Phase 4: "Move loading orchestration out of the component into `RhAgentGroupStore` or a `SignalReviewFacade`" | `SignalReviewComponent.ngOnInit` still contains the auto-select `effect` that watches `agentStore.latestRun()` | Move orchestration behind a facade or into `RhAgentGroupStore` |
| Phase 4: "Component injects at most 3 stores" | `SignalReviewComponent` still injects 6 stores/services | Consolidate behind `SignalReviewFacade` or fold responsibilities |
| Phase 4: "Consider centralizing active-run context in `RhAgentGroupStore` only" | `RhAgentTriageStore` still owns its own `activeRunId`/`activeMarketDate` | Remove run context from triage store; pass run context as method parameters |
| Phase 3: "Update header counts to derive from `groups` when they should reflect active filter" | Header still shows total signal counts, not filtered counts | Decide on semantics and wire counts from filtered `groups` if that is the desired behavior |
| Phase 5: "Build + tests pass" | Jest tests were added but not executed | Run `npx jest` for the new spec files |

### New tasks from thermo-nuclear review

1. **`SignalReviewUiStore.allExpanded` should be a computed**
   - Currently stored and updated manually; derive it from `expandedGroups`.

2. **Decouple `RhAgentGroupStore` from `SignalReviewUiStore`**
   - Domain grouping should not depend on a page-local UI store. Pass `signalFilter` into `buildSymbolGroups` from the page layer instead of injecting `SignalReviewUiStore`.

3. **Introduce `SignalReviewFacade` to reduce component store count** ✅
   - Created `SignalReviewFacade` in `src/app/features/rh-agent/stores/signal-review.facade.ts`.
   - It injects all page-specific stores and exposes a minimal API for the component.
   - `SignalReviewComponent` now injects only `SignalReviewFacade`.

4. **Decide fate of `fullGroupToggles`** ✅
   - Removed `fullGroupToggles` state, `toggleFullGroup` method, `showFullGroup` group property, and the latent per-group behavior. `buildSymbolGroups` now uses only `showAll` to include non-signal symbols.

5. **Remove duplicated run context from `RhAgentTriageStore`** ✅
   - Removed `activeRunId`/`activeMarketDate` from `RhAgentTriageState`.
   - `setStatus`, `setGroupStatus`, and convenience methods now receive `marketDate` as a parameter.
   - Replaced `setActiveRun` with `syncStatusesForDate(marketDate)`.
   - `loadPersistedDecisions` accepts an optional `currentDate` to apply non-REVIEW statuses.
   - `RhAgentGroupStore.setActiveRun` now triggers `loadPersistedDecisions` for the current run's date.
   - Updated callers in `SignalReviewFacade`, `ChartReviewComponent`, and `AgentOrderComponent` to pass market date from `RhAgentGroupStore`.

6. **Refine `SignalReviewHeaderComponent` inputs** ✅
   - Replaced the `filter: SignalFilter` input with explicit `timeframe` and `direction` inputs.

7. **Move run-selection orchestration out of the component into the facade** ✅
   - `SignalReviewFacade.enterPage()` now handles fullscreen, existing-run load, and auto-select fallback from `RhAgentStore.latestRun()`.
   - `SignalReviewComponent.ngOnInit` is a single `facade.enterPage()` call.

8. **Consider decomposing `buildSymbolGroups`**
   - It now filters by list, showAll/fullGroup, signal filter, groups, sorts, builds rows, filters signals, and computes counts. If another concern is added, split it into a pipeline.

9. **Run new unit tests**
   - `rh-agent.utils.spec.ts`
   - `signal-review-ui.store.spec.ts`

## Thermo-Nuclear Re-Review Findings (2026-07-12)

A re-review of the refactored code identified the following new issues, in suggested fix order:

### HIGH

1. **Duplicated filter logic in `RhAgentGroupStore.filteredProfileCounts`** ✅
   - Extracted `buildFilteredCandidates()` in `rh-agent.utils.ts` to share candidate creation and list-filtering between `buildSymbolGroups` and `filteredProfileCounts`.

2. **Dead `timeframe` state in `RhAgentTriageStore`** ✅
   - Removed `timeframe` from `RhAgentTriageState` and `initialState`; removed the unused `setTimeframe()` method.

### MEDIUM

3. **`SignalReviewFacade.enterPage()` creates an `effect` inside a method** ✅
   - Moved the auto-select effect into the facade constructor with guards so it is registered once. `enterPage()` now only toggles fullscreen and triggers symbol/runs loading.

4. **`flatSymbols` is unstable while histories load** ✅
   - Added `filteredProfiles` and `flatFilteredSymbols` computeds in `RhAgentGroupStore`, derived from the same stable profile-filtered set used for header counts. `SignalReviewFacade.flatSymbols` now uses `flatFilteredSymbols` instead of `groups()`.

5. **Method calls in `signal-review.component.html`** ✅
   - Added `timeframe` and `direction` computeds to `SignalReviewFacade`; updated `signal-review.component.html` to bind to them directly.

6. **Page UI state still lives in `RhAgentGroupStore`**
   - `selectedSymbol`, `quickChartSymbol`, `showAllSymbols`, and `signalFilter` are page-local concerns, mixed with domain run/symbol data.
   - **Fix**: move them to `SignalReviewUiStore` (or a dedicated page store) and keep `RhAgentGroupStore` focused on run/symbol domain data.

7. **`selectedSymbolProfile` ignores `allSymbols`**
   - It only searches `signalSymbols()`. In `showAllSymbols` mode, a selected non-signal row returns `null`.
   - **Fix**: search the merged signal + all-symbol set.

### LOW

8. **Outdated `RhAgentGroupStore` header comment**
   - Still mentions "Track per-symbol signal history" and "Track show full group toggle per group."
   - **Fix**: update the file-level comment to match the current responsibilities.

9. **`chart-review` / `agent-order` don't guarantee active run context**
   - Both fall back to `todayDate()` when `groupStore.activeRunMarketDate()` is null. Direct navigation may load decisions for the wrong date.
   - **Fix**: mirror `SignalReviewFacade.enterPage()` run-loading logic, or add a shared run-context guard.

10. **`initializeTradeRows` reads `acceptedSymbols` synchronously after async load**
    - In `agent-order.component.ts`, `loadPersistedDecisions` is fire-and-forget; the next line reads `acceptedSymbols()` before the network returns.
    - **Fix**: react to `acceptedSymbols` in a computed/effect instead of reading it immediately.

## Open Questions / Decisions Needed

1. **Counts behavior** ✅: Header counts now reflect the active filter (list filter, showAll, timeframe/direction). To avoid a loading "countdown" while per-symbol histories stream in, counts are derived from symbol profile data instead of the history-backed `groups()`. This means they are stable immediately but may differ slightly from visible rows if profile data is stale.
2. **Active run ownership**: Do we want to consolidate `activeRunId` fully into `RhAgentGroupStore` in this PR, or only stop the duplicate `setActiveRun` calls?
3. **Triage persistence simplification**: Out of scope for this refactor? Suggested as follow-up.
4. **`selectedSymbol` / `quickChartSymbol`**: Keep in `RhAgentGroupStore` or move to `SignalReviewUiStore`?

## Acceptance Criteria (overall)

- [x] `ng build --configuration development` passes.
- [ ] `npm --prefix functions run typecheck` passes (no shared-code impact expected, but verify).
- [x] Signal review filtering behaves identically to before for all combinations of timeframe/direction.
- [x] Header counts match the active filters and are stable on page load (derived from profile data; group-panel counts continue to derive from visible rows).
- [x] No method calls in templates; no duplicated filter logic across components.
- [x] Component injects at most 3 stores (`SignalReviewFacade` only).
- [x] Orphaned `clearTriage` output is removed or wired.
- [x] At least one new unit test covers `filterSignals` or `buildSymbolGroups` filtering.
- [ ] New Jest tests pass.
- [x] `SignalReviewUiStore.allExpanded` is derived, not stored.
- [x] `RhAgentGroupStore` no longer injects `SignalReviewUiStore`.
- [x] `RhAgentTriageStore` no longer stores `activeRunId`/`activeMarketDate`.

## Risk Register

| Risk | Mitigation |
|---|---|
| Refactor touches many files and introduces regressions | Phase-by-phase implementation with build verification after each phase |
| Count semantics change and surprise users | Preserve total-signal counts in header unless explicitly decided otherwise |
| Store split breaks cross-page state | Keep `providedIn: 'root'`; test navigation to review/order pages |
| Tests do not exist for baseline | Add tests for the canonical helper first, then for the integrated path |

## Changelog

- **2026-07-11**: Initial plan created.
- **2026-07-11**: Phase 1–5 implemented. Phase 5 tests written but not run.
- **2026-07-12**: Thermo-nuclear review follow-up added; identified remaining store-coupling and orchestration issues to fix.
- **2026-07-12**: Converted `GroupDimension` from string-union type to enum to support future dimensions.
- **2026-07-12**: Replaced imperative `querySelector` scroll logic with `ScrollTargetService` + `ScrollIntoViewDirective` so scrolling participates in Angular change detection.
