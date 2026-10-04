**Topic:** Gallery Order Ticket View  
**Topic Slug:** order-ticket-gallery-view  
**Thread:** Gallery View Page  
**Thread Slug:** gallery-view-page  
**Issue:** #753  
**Thread Parent:** #744  
**Topic Parent:** #743  
**Task:** #754  
**Domain:** GALLERY-VIEW  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-04  
**Last Updated:** 2026-10-04  

# Code Review — FE: Gallery route, page shell, facade/UI-store seam (#754)

## Scope

Uncommitted change set for task #754: `dev/gallery` route (`core/common/interfaces.ts`, `core/core-routes.ts`), `pages/gallery-view/`, `components/gallery-header/`, `components/gallery-card/`, `stores/gallery.facade.ts`, `stores/gallery-ui.store.ts`, `utils/gallery-cards.util.ts`, plus spec files for each seam. Review-fix touches: `stores/symbol-history.store.ts` (exported run-cache helpers), `utils/utils.ts` (exported `MARKET_CAP_TIER_ORDER` + `marketCapTierRank`).

## Standards axis

### Findings

- **minor (fixed)** — §2 "Shared constants must exist once": `MARKET_CAP_ORDER` in `gallery-cards.util.ts` duplicated `MARKET_CAP_TIER_ORDER` in `utils/utils.ts`. Fixed — canonical map exported with `marketCapTierRank()` accessor; both sites use it.
- **major (fixed)** — Feature Envy / contract-detail leak: facade reverse-parsed `SymbolHistoryStore`'s internal `${symbol}::${runId}` cache keys. Fixed — store now owns `runHistoryCacheKey`/`signalsBySymbolForRun`/`hasPendingRunHistory`; internal key building uses the helper too.
- **minor (fixed)** — `loadConfig` subscription had no error handler (both existing consumers handle errors) and a redundant `take(1)` (service already takes 1). Fixed — error path logs + snackbar.
- **minor (judgement call, not fixed)** — `enterGallery`, the auto-select effect, and `pageInitializing` largely mirror `SignalReviewFacade` equivalents (~25 lines in two places). Consistent with the codebase's facade pattern; a shared run-entry helper is the natural extraction if a third facade appears. Noted for future consolidation.
- **nits** — `SENTINEL` naming (matches `signal-review-header`'s identical convention); `GalleryCard` carrying `side`/`direction`/`key` as three encodings of one fact (defensible — template ergonomics); dead tuple element in sort key (fixed); duplicated `profile()`/`signal()` fixtures across spec files (acceptable).

### Verified clean

All facade calls match real store/service signatures. `track` key uses `id + timeframe + signalType` (collision-safe — multiple signalTypes can share a barDate). Route mirrors the `FLEX_CHART_SANDBOX` precedent. Tests follow AGENTS.md conventions (`jest.fn`, `setTimeout(0)` macrotask flush, no `fakeAsync` on native awaits).

## Spec axis

### Per-AC verdict

- **AC1 — MET.** `dev/gallery` lazy `loadComponent` route under `authGuard`.
- **AC2 — MET.** Facade/UI-store seam; `enterGallery()` resolves latest completed run and eager-loads signals (via `GroupStore` → per-symbol history), decisions (`loadRecentDecisions`), lists (`loadSymbolLists` via the symbols load), tickets (`loadTickets`), config (`loadConfig`). Caveat noted: auto-select bails when any run is already active — matches signal-review prior art and is intentional shared session context.
- **AC3 — MET.** One card per symbol+side; opposite directions → two cards. Tested.
- **AC4 — MET (after fix).** Header shows timeframe/direction pills, list filter, sort selector; grid renders detail shells. **Defect found & fixed:** the 'Not triaged' option silently returned nothing on cold entry because `untriagedSymbols` derives from `trackedSymbols()`, which nothing on the gallery path loads. Fixed by delegating to the canonical `shouldShowInListFilter`/`isUntriaged` — untriaged is derived from exclusive-list membership, no tracked-universe load needed.
- **AC5 — MET.** Initializing, no-signals, all-filtered-out states + load-error state added during review. Tested.

### Coverage gap (fixed)

TEST doc named `gallery-card.component.spec.ts` as a component seam — added during review.

## Thermo-nuclear axis

### Findings

- **major (fixed)** — `pageInitializing` missed the per-symbol history fan-out: `symbolsLoading` clears when profiles land, but cards can't render until `loadSignalHistoryForRun` resolves — guaranteed "No signals for this run" flash. Fixed — `hasPendingRunHistory` folds pending run-scoped loads into `pageInitializing`; regression test added.
- **major (fixed)** — 'Not triaged' filter bug + duplicated `matchesList` (see Spec AC4) — deleted `untriaged` from `GalleryListContext`; canonical helper owns the predicate.
- **major (fixed)** — cache-key reverse-parse (see Standards major) — key format now store-owned.
- **minor (noted)** — duplicated auto-select effect across two root facades; run-selection policy could live once in `GroupStore`. Deferred — matches existing pattern, no third consumer yet.
- **minor (noted)** — `GalleryUiStore` is `providedIn: 'root'` page-local state relying on `resetForPage()`; component-level provision would make reset dead code. Deferred — mirrors `SignalReviewUiStore` pattern.
- **minor (fixed)** — `@for track` needed `+occ.signalType`; sort per-comparison `findIndex` hoisted to a precomputed rank `Map`.
- **nit (fixed)** — `symbolsError` now surfaces as an error empty state.

### Landed correctly

Clean page→facade→store layering; pure, well-tested utils; card-type-agnostic shell without premature union abstraction; honest I/O header/card components.

## Test results

Full suite green: **174 suites / 2529 tests** (`npx jest --coverage=false`; one transient torn-file failure in an unrelated spec mid-edit by the user, green on re-run). `ng build` clean. Gallery seams covered by 5 spec files including regression tests for every review-found defect.

## Findings summary

| Severity | Count | Status |
|---|---|---|
| critical | 0 | — |
| major | 3 | all fixed |
| minor | 6 | 3 fixed, 3 noted for future consolidation |
| nit | 6 | 4 fixed, 2 judgement calls |

## Round 2 (2026-10-04) — verification pass on remediated code

Second full pass over the post-fix state. All first-pass fixes verified landed; new findings:

- **major (fixed)** — `runHistoryCacheKey` duplicated `getCacheKey` in `utils.ts` — two owners of the `${symbol}::${runId}` format, and pure helpers exported from a `signalStore` file. Fixed — `signalsBySymbolForRun`/`hasPendingRunHistory` moved to `utils.ts` beside `getCacheKey`; the store builds keys via `getCacheKey` and the facade imports from the canonical helper home.
- **minor (fixed)** — residual one-frame empty-state flash: `pageInitializing` went false in the window between `runsReceived` emission and the auto-select effect's `setActiveRun`. Fixed — `!runId && (!runsReceived() || !!latestCompletedRun())`; regression test added. (Same latent gap exists in `signal-review.facade.ts` — noted, out of scope.)
- **minor (fixed)** — `marketCapTierRank`'s `tier in` check unsound for inherited keys (`'constructor'`) → `Object.hasOwn`.
- **minor (noted, product call)** — gallery keeps the already-active shared `GroupStore` run rather than re-anchoring to latest — mirrors signal-review prior art; intentional shared session context.
- **minor (noted)** — duplicated auto-select effect / enter-orchestration across two facades; extract `GroupStore.ensureActiveRun()` if a third facade appears.

## Verdict

**PASS** — two review rounds; all majors and actionable minors remediated with regression tests. Remaining items are documented judgement calls consistent with existing codebase patterns.
