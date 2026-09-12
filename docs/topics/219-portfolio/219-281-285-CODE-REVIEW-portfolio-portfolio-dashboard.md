**Topic:** Portfolio Dashboard — Init Impl  
**Topic Slug:** `portfolio-dashboard`<br>
**Thread:** Portfolio Dashboard — Init Impl  
**Thread Slug:** `init-impl`<br>
**Issue:** #281  
**Thread Parent:** #274  
**Topic Parent:** #219  
**Task:** #285  
**Domain:** PORTFOLIO  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-12  
**Last Updated:** 2026-09-12

---

# Code Review: Task #285 — Routing + Shell (PortfolioDashboardComponent)

## Summary

Three review axes ran in parallel against the routing + shell implementation:

- **Standards** — file size, duplication, type contracts, pattern conformance, dead code.
- **Spec** — PRD acceptance criteria, IMPL plan routing/shell section, test plan coverage.
- **Thermo-nuclear** — abstraction quality, race conditions, error handling, test quality, architectural risk.

### Files reviewed

- `src/app/core/common/interfaces.ts` — added `PORTFOLIO_DASHBOARD` to `AppRoutes` enum
- `src/app/core/core-routes.ts` — added route with `authGuard`, changed default redirect
- `src/app/core/common/constants.ts` — added `NAV_MENU_ITEMS` entry
- `src/app/features/portfolio-dashboard/portfolio-dashboard.component.ts` — new shell component
- `src/app/features/portfolio-dashboard/portfolio-dashboard.component.html` — template
- `src/app/features/portfolio-dashboard/portfolio-dashboard.component.scss` — styles
- `src/app/features/portfolio-dashboard/portfolio-dashboard.component.spec.ts` — 12 tests
- `src/app/features/portfolio-dashboard/portfolio-dashboard.store.ts` — modified (loadError signal, refresh error handling)
- `src/app/features/portfolio-dashboard/portfolio-dashboard.types.ts` — modified (loadError field)
- `src/app/features/portfolio-dashboard/portfolio-dashboard.store.spec.ts` — modified (loadError tests)

## Findings by Severity

### Critical

#### C1 — `ngOnInit` fire-and-forget bypassed store's refresh guard
- **File:** `portfolio-dashboard.component.ts` (original)
- **Finding:** `ngOnInit` called `loadInitialData()` which directly invoked `loadAccounts()`, `loadPhase1()`, `loadPhase2()` — bypassing the store's `refreshing` concurrency guard. Concurrent loads could interleave `patchState` calls.
- **Resolution:** **FIXED.** Component now calls `store.refresh()` which is guarded. `loadInitialData` method removed.

### Major

#### M2 — `onRefresh` ignored Promise (unhandled rejection)
- **File:** `portfolio-dashboard.component.ts` (original)
- **Finding:** `onRefresh()` called `store.refresh()` without catching the returned Promise. Since `refresh()` rethrows on `loadAccounts` failure, this produced unhandled promise rejections.
- **Resolution:** **FIXED.** `onRefresh()` now calls `this.store.refresh().catch(() => {})`.

#### M3 — `loadInitialData` silently swallowed all errors
- **File:** `portfolio-dashboard.component.ts` (original)
- **Finding:** Empty `catch` block meant total `loadAccounts` failure showed only the empty state — no error message, no retry affordance.
- **Resolution:** **FIXED.** Added `loadError: string | null` signal to store state. `refresh()` now catches top-level errors and sets `loadError`. Template renders an error banner with a Retry button when `loadError` is set.

#### M6 — Store `refresh()` did not catch errors despite comment claiming it did
- **File:** `portfolio-dashboard.store.ts` (original)
- **Finding:** Header comment said "refresh() catches top-level failures and sets globalLoading false" but implementation only used `try/finally` for the `refreshing` flag — errors rethrew.
- **Resolution:** **FIXED.** `refresh()` now wraps load calls in `try/catch`, sets `loadError`, and ensures `globalLoading` is false. Comment updated to match implementation.

#### M7 — TestBed isolation fragile
- **File:** `portfolio-dashboard.component.spec.ts` (original)
- **Finding:** `TestBed.resetTestingModule()` was only called inside one test, not in `afterEach`. Risk of state bleed between tests.
- **Resolution:** **FIXED.** Added `afterEach(() => TestBed.resetTestingModule())`.

#### M8 — Shell component mixed store wiring and formatting
- **File:** `portfolio-dashboard.component.ts` (original)
- **Finding:** `formatCurrency` instantiated `new Intl.NumberFormat` on every call.
- **Resolution:** **FIXED.** Formatter cached as component property `currencyFormatter`.

### Deferred (out of scope for Task #285)

#### D4 — Store `providedIn: 'root'`
- **Finding:** Feature-specific SignalStore registered as root singleton pulls store + client into main bundle.
- **Resolution:** **DEFERRED.** Store scope is a Task #284 concern; changing it would break shipped tests. Track for a future optimization pass.

#### D5 — Public store load methods not re-entrant
- **Finding:** `loadAccounts`, `loadPhase1`, `loadPhase2` are public and unguarded.
- **Resolution:** **DEFERRED.** Store API is Task #284's domain. The component now funnels all loads through `refresh()`, mitigating the practical risk.

### Minor

#### m9 — `formatCurrency` created new `Intl.NumberFormat` per call
- **Resolution:** **FIXED** (see M8 above).

#### m10 — Redundant non-null assertion `summary().totalPnL!`
- **Resolution:** **FIXED.** Template now uses `(summary().totalPnL ?? 0) < 0` to satisfy Angular template type checking.

#### m12 — `aria-live` regions lacked `aria-atomic`, spinner lacked `aria-label`
- **Resolution:** **FIXED.** Added `aria-atomic="true"` to all live regions, `aria-label` to spinner.

#### Standards minor — `CommonModule` imported but unused
- **Resolution:** **FIXED.** Removed import; template uses `@if`/`@for` control flow.

#### Standards minor — Unused mock spies (`toggleClosedPositions`, `toggleOrderHistory`, `retrySection`)
- **Resolution:** **FIXED.** Removed from mock.

#### Standards minor — Unused `createStore()` helper in spec
- **Resolution:** **FIXED.** Removed.

#### Standards nit — Unused `let i = $index` in `@for`
- **Resolution:** **FIXED.** Removed.

### Nits (not fixed — pre-existing or cosmetic)

- Standards nit — Commented-out `AppRoutes` enum values in `interfaces.ts` (pre-existing).
- Standards nit — Commented-out `NavItem` definitions in `constants.ts` (pre-existing).
- Thermo-nuclear nit 17 — Menu text casing (`Portfolio Dashboard` title-cased vs others lower-case). Intentional for a feature name.
- Thermo-nuclear nit 18 — `AppRoutes` enum indentation inconsistency (pre-existing).
- Thermo-nuclear nit 19 — Tab label built inline. Acceptable for a shell; can extract in Task #286.
- Thermo-nuclear minor 11 — `loadPhase2` non-null assertions for quote errors (store, Task #284 domain).
- Thermo-nuclear minor 13 — Default redirect double-hop for unauthenticated users. Acceptable — guard handles it.
- Thermo-nuclear minor 14 — Wildcard `**` redirect indirect. Pre-existing pattern.
- Thermo-nuclear minor 16 — Store selectors recompute on every `accounts` change. Task #284/#286 concern.

## Spec Axis — Acceptance Criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `AppRoutes.PORTFOLIO_DASHBOARD = 'portfolio-dashboard'` | **MET** |
| 2 | New route in `core-routes.ts` with `authGuard` | **MET** |
| 3 | Default redirect changed to `portfolio-dashboard` | **MET** |
| 4 | `NAV_MENU_ITEMS` entry `name: 'portfolio-dashboard'`, `text: "Portfolio Dashboard"` | **MET** |
| 5 | Shell renders aggregate summary bar, refresh button, `MatTabGroup` | **MET** |
| 6 | Shell injects store and calls `loadAccounts()` + `loadPhase1()` on init | **MET** (via `refresh()`) |
| 7 | Shell calls `loadPhase2()` after phase 1 | **MET** (via `refresh()`) |
| 8 | Refresh button triggers `store.refresh()` | **MET** |
| 9 | Tab selection triggers `store.selectAccount(index)` | **MET** |
| 10 | `positions-view` route and sidenav entry unchanged | **MET** |

All 10 acceptance criteria are **MET**.

## Test Results

- **93/93 tests pass** (12 component + 26 store + 16 selectors + 38 util + 1 new)
- **Angular build passes**
- New tests added:
  - Component: error banner rendering, refresh via `store.refresh()` only
  - Store: `loadError` set on failure, cleared on success, `globalLoading` false on error

## Verdict

**PASS**

All critical and major findings were fixed before the gate. No critical or major findings remain. Minor findings are fixed or deferred with justification. All acceptance criteria are met. Tests are green. Build passes.
