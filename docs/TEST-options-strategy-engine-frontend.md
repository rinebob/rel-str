**Topic:** Options Position Strategy Engine  
**Issue:** #108  
**Domain:** OPTIONS  
**Area:** FE  
**Type:** Test Plan  
**Status:** Complete  
**Created:** 2026-08-13

# Test Plan: Options Position Strategy Engine (FE)

**Note on E2E automation:** no E2E framework (Cypress or otherwise) is currently installed in this repo. The journeys below describe scenarios to validate, but for this Topic they are implemented as component-harness/store-level tests with mocked services (see Test Seams below), not real browser E2E runs. Standing up an E2E framework (likely Cypress, per prior discussion) is out of scope here and deferred to a future, dedicated effort.

## E2E User Journeys

- Journey 1: User navigates to the options strategy dashboard → sees a table of currently open positions with strike, expiration, DTE remaining, premium collected, current value, and unrealized P&L.
- Journey 2: User views the closed/assigned positions table → sees outcome (expired worthless / assigned), realized P&L, and for assigned positions, the resulting share position's live unrealized P&L.
- Journey 3: User toggles the equity curve between per-symbol and combined view → chart and max-drawdown figure update to reflect the selected scope.
- Journey 4: User loads the dashboard with zero positions yet opened (before the first scheduled run) → empty-state messaging, no chart errors.

## Integration Tests

- `OptionsStrategyDashboardStore` + `listStrategyPositions` callable: store correctly separates open vs. closed positions from the callable response into their respective table-bound signals.
- `OptionsStrategyDashboardStore` + `getStrategyEquityCurve` callable: switching the per-symbol/combined toggle triggers a new callable request with the correct `instanceId` param (present vs. omitted) and updates the chart signal.
- Dashboard component + store: loading/error states propagate correctly from store to template (spinner/error banner shown appropriately).

## Unit Tests

- Pure functions: any FE-side formatting/derivation helpers (e.g., DTE-remaining display, currency formatting) — no P&L or drawdown math (that's BE-computed per the implementation plan).
- Services: `options-strategy.service.ts` Angular wrapper correctly maps callable request/response shapes.
- Store: `OptionsStrategyDashboardStore` state transitions (loading → success, loading → error, filter change → refetch).

## Test Seams

- Highest seam: component-level test harness rendering the dashboard component with a mocked store, verifying table/chart rendering against known fixture data.
- Lower seams: store unit tests with a mocked `options-strategy.service.ts`; service unit tests with a mocked callable response.

## Existing Test Coverage

- No existing FE tests cover this dashboard (new feature). The charting setup reused from `@c:\aa\projects\rel-str\src\app\features\rh-agent\pages\option-chart\option-chart.component.ts` already has its own test coverage for the underlying chart rendering primitives — this plan does not duplicate those, only tests the new data-binding/toggle logic specific to this dashboard.

## Edge Cases

- Empty state: no open positions, no closed positions, no equity curve data yet (day one, before first scheduled run).
- Error state: `listStrategyPositions` or `getStrategyEquityCurve` callable fails (network error, backend error) — dashboard shows an error state, not a blank/broken table or chart.
- Loading state: initial load and filter-change refetches both show an appropriate loading indicator without flashing stale data.
- Permission denied: unauthenticated access is blocked by `authGuard` at the route level (same as all other RH Agent routes) — verify the new route is guarded, not just assume it.
- Large data volume: equity curve spanning many months of daily points renders without performance degradation (relevant once this strategy has run long enough to accumulate real history).
