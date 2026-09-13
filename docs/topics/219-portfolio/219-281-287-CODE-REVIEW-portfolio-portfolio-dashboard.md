# Code Review — Task #287: Integration + wiring

**Topic:** #219 — Portfolio Dashboard
**Thread:** #274 — Portfolio Dashboard / Initial Implementation
**Blueprint:** #281 — Portfolio Dashboard FE Implementation
**Task:** #287 — Integration + wiring — store-to-component wiring, loading/error states, toggles, pre-fetch, empty states
**Domain:** PORTFOLIO
**Topic Slug:** portfolio-dashboard
**Stage:** 7_QA
**Status:** PASS
**Date:** 2026-09-12

## Scope

Files changed in this task:
- `src/app/features/portfolio-dashboard/portfolio-dashboard.component.ts`
- `src/app/features/portfolio-dashboard/portfolio-dashboard.component.html`
- `src/app/features/portfolio-dashboard/portfolio-dashboard.component.scss`
- `src/app/features/portfolio-dashboard/portfolio-dashboard.component.spec.ts`
- `src/app/features/portfolio-dashboard/portfolio-dashboard.types.ts` (added `'orders'` to `SectionName`)
- `src/app/features/portfolio-dashboard/portfolio-dashboard.store.ts` (added `'orders'` combined retry)

## Standards axis

### Findings

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | Major | Spec file exceeds 400-line smell threshold | **Deferred** — splitting requires extracting store mock helpers; tracked for follow-up refactor |
| 2 | Minor | `formatCurrency()` mixed into component | **Deferred** — pre-existing pattern from prior tasks; extraction to shared pipe tracked for follow-up |
| 3 | Minor | Duplicated combined order loading/error expressions | **Fixed** — extracted `ordersLoading` and `ordersError` computed signals |
| 4 | Nit | Duplicated `refresh()` catch handler | **Deferred** — minor; pre-existing pattern |
| 5 | Nit | Redundant null guard in `pd-negative` class binding | **Deferred** — pre-existing from Task #285 |
| 6 | Minor | Wiring tests call component methods directly | **Fixed** — updated to use `triggerEventHandler` on child DebugElements |
| 7 | Minor | `protectedSymbols` test only asserts element exists | **Deferred** — input binding verified via computed signal; full input assertion tracked for follow-up |

## Spec axis

### Acceptance criteria

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Shell connects to store and passes data to sections | **MET** | All 5 section components wired with data, loading, error inputs |
| 2 | Per-section loading indicators | **MET** | Each section receives `[loading]` from store section state |
| 3 | Per-section error messages with retry | **MET** | All sections wire `(retry)` to `onRetrySection`; combined orders retry fixed to use `'orders'` |
| 4 | Closed positions toggle wired | **MET** | `(toggleClosed)` → `onToggleClosedPositions()` → `store.toggleClosedPositions()` |
| 5 | Order history toggle wired | **MET** | Button click → `onToggleOrderHistory()` → `store.toggleOrderHistory()` |
| 6 | Pre-fetch (phase 2) fires after initial load | **MET** | `store.refresh()` runs `loadAccounts → loadPhase1 → loadPhase2` sequentially |
| 7 | Tab switching shows pre-fetched data instantly | **MET** | `selectAccount` is synchronous; all data pre-fetched in store |
| 8 | Empty states | **MET** | Shell: no accounts; child tables: no positions/orders |
| 9 | Rapid tab switching handles race conditions | **MET** | `selectAccount` synchronous; `retrySection` captures accountIndex; `refreshing` flag guards refresh |
| 10 | Aggregate summary from loaded accounts | **MET** | Store skips null/undefined; returns null totals when no data. **Minor gap deferred**: no visual indicator for partially unavailable accounts |

### Findings

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| A | Major | Open Orders / Order History retry always fired `equityOrders`, never `optionOrders` | **Fixed** — added `'orders'` SectionName + combined retry in store that re-fetches both |
| B | Minor | Summary bar doesn't visually indicate unavailable accounts | **Deferred** — tracked for follow-up; requires store-level unavailable count selector |
| C | Nit | No tests for pre-fetch timing or race conditions | **Deferred** — store-level tests cover refresh ordering; UI race tests tracked for follow-up |

## Thermo-nuclear axis

### Findings

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | Critical | Hard-coded `equityOrders` retry for combined tables | **Fixed** — same as Spec finding A |
| 2 | Major | Wiring tests call component methods, not child output events | **Fixed** — updated to `triggerEventHandler` |
| 3 | Major | Store mock can't simulate tab selection changes | **Deferred** — mock refactoring tracked for follow-up |
| 4 | Major | Shell becoming "god shell" — extract `PortfolioAccountTabComponent` | **Deferred** — significant refactor; tracked for follow-up |
| 5 | Major | Hand-rolled untyped store mock | **Deferred** — mock refactoring tracked for follow-up |
| 6 | Minor | Duplicated combined order loading/error expressions | **Fixed** — extracted computed signals |
| 7 | Minor | Tests assert child existence, not input values | **Deferred** — partial fix applied; full input assertion tracked for follow-up |
| 8 | Minor | Order history toggle missing ARIA state | **Fixed** — added `aria-expanded` and `aria-pressed` |
| 9 | Minor | Order history table destroyed/recreated on toggle | **Deferred** — table has no internal state to preserve; acceptable for now |
| 10 | Minor | Toggle/retry handlers lack loading guards | **Deferred** — store's `refreshing` flag prevents concurrent refresh; retry during refresh is low-risk |
| 11 | Minor | `onRetrySection` can pass stale `selectedAccountIndex` | **Deferred** — child is within selected tab; signal matches at event time |
| 12 | Nit | One-line pass-through toggle methods | **Deferred** — kept for testability and future guard insertion |
| 13 | Nit | Test factory over-uses `_set...` helpers | **Deferred** — mock refactoring tracked for follow-up |

## Fixes applied

1. **Critical: Combined orders retry** — Added `'orders'` to `SectionName` type. Added `case 'orders'` in `store.retrySection` that re-fetches both `equityOrders` and `optionOrders` with `Promise.allSettled`. Updated both `app-open-orders-table` and `app-order-history-table` to emit `(retry)="onRetrySection('orders')"`.

2. **Minor: Deduplicated order loading/error** — Added `ordersLoading` and `ordersError` computed signals to `PortfolioDashboardComponent`. Both order tables now bind to these instead of repeating `sel.equityOrders.loading || sel.optionOrders.loading`.

3. **Minor: ARIA state on history toggle** — Added `[attr.aria-expanded]` and `aria-pressed` to the Show/Hide History button.

4. **Minor: Wiring tests use child output events** — Updated `toggleClosedPositions` and `retrySection` tests to use `fixture.debugElement.query(...).triggerEventHandler(...)` instead of calling component methods directly.

## Deferred findings

The following findings are tracked for follow-up refactoring (Thread #276 or a dedicated refactor thread):

- Extract `PortfolioAccountTabComponent` to reduce shell complexity
- Refactor store mock to be typed and support tab selection simulation
- Split spec file to stay under 400 lines
- Extract `formatCurrency` to a shared pipe/utility
- Add visual indicator for unavailable accounts in summary bar
- Add tests for pre-fetch timing and race conditions
- Add full input-value assertions in wiring tests
- Simplify redundant null guard in `pd-negative` binding

## Verification

- **Tests:** 151/151 pass (portfolio-dashboard suite)
- **Build:** Angular production build passes
- **UI:** Dev server verified, section components render in account tabs

## Verdict: PASS

All critical and major findings fixed or deferred with rationale. Minor findings addressed where low-risk. Deferred findings tracked for follow-up.

---

## Re-review (round 2)

**Date:** 2026-09-12
**Trigger:** Post-fix review after quote/order parsing fixes, Cost Basis + Value columns, totals footer row, and closed-position toggle fixes.

### Additional changes reviewed

- Quote parsing: unwrap nested `quote` key in equity/option quote parsers
- Order parsing: pass `'orders'` container key to `extractList` for `get_equity_orders`/`get_option_orders`
- Option positions parsing: pass `'results'`/`'option_positions'` container keys to `extractList`
- Option order normalization: fall back to `processed_quantity` when `cumulative_quantity` is absent
- Cost Basis column (avgCost × |qty|) added to both position tables
- Value column (currentPrice × |qty|) added to both position tables
- Totals footer row (sum of Cost Basis, Value, PnL, weighted-avg PnL%) in both position tables
- Closed-position toggle support added to option positions table
- `unconfirmed` added to `LIVE_ORDER_STATES`

### Re-review findings and resolutions

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| R1 | Major | `aria-pressed` was a literal string, not a binding | **Fixed** — changed to `[attr.aria-pressed]="showOrderHistory()"` |
| R2 | Major | Show Closed toggle disappeared when all equity positions were closed | **Fixed** — added `hasAnyPositions` computed; outer condition uses it, inner uses `hasPositions` |
| R3 | Major | Option positions table had no closed-position support | **Fixed** — added `closed` to `OptionPositionWithPnL`, `showClosed`/`toggleClosed` to component, wired in shell |
| R4 | Major | `unconfirmed` order state dropped from both open and history | **Fixed** — added to `LIVE_ORDER_STATES` |
| R5 | Major | Aggregate PnL `hasPnL` guard too restrictive (`&&` instead of `\|\|`) | **Fixed** — changed to `\|\|` so single-asset-class accounts show PnL |
| R6 | Minor | `globalLoading` flickered between load phases | **Fixed** — `refresh()` now owns globalLoading lifecycle (true at start, false in finally) |
| R7 | Nit | Inaccurate test description | **Fixed** — renamed to match assertion |
| R8 | Major | Equity/option table duplication (formatters, totals) | **Deferred** — extraction to shared base/utility tracked for follow-up |
| R9 | Major | Missing tests for new parse fixes (orders container, processed_quantity, nested option quotes) | **Deferred** — added nested equity quote test; remaining test coverage tracked for follow-up |
| R10 | Minor | `ordersError` surfaces only one of two possible errors | **Deferred** — low-risk; combined retry re-fetches both |
| R11 | Minor | `formatNumber` max 4 fraction digits may truncate fractional shares | **Deferred** — tracked for follow-up |

### Verification (round 2)

- **Tests:** 189/189 pass (portfolio-dashboard + robinhood-mcp suites)
- **Build:** Angular production build passes

### Verdict: PASS

All actionable critical/major findings fixed. Remaining deferred findings tracked for follow-up.
