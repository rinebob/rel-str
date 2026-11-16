**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Pass Family Consolidation  
**Thread Slug:** pass-family-consolidation  
**Issue:** #1554  
**Thread Parent:** #987  
**Topic Parent:** #984  
**Domain:** DATA-PIPELINE  
**Type:** TEST  
**Area:** FE  
**Status:** Approved  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-16  

# Test Plan — Stats Pipeline Consolidation: FE

## E2E User Journeys

- Open `/options-strategy-dashboard` → stats card + equity curve load
  via `getPaperStats` for the default `src-STRATEGY` scope.
- Switch Population → Signals: stats card + curve reload from
  `stats-src-SIGNAL`; instance select disabled.
- Switch Population → All: `stats-all` loads — signal + strategy
  combined.
- Pick an instance under Strategies: scope `inst-{id}` loads;
  per-instance view unchanged from today.
- Pre-first-nightly state (src docs absent): empty state renders, no
  error banner.

## Integration Tests

- Store + service: `getPaperStats$` invoked with the derived scope
  string; `stats[0]` maps to both stats fields and equity-curve points.
- Component + store: population select patches `selectedPopulation`
  and triggers a reload; instance select patches only under Strategies.
- Service + callable boundary: request shape `{scope}` matches
  `GetPaperStatsRequest`; response `{stats: PaperStats[]}`.

## Unit Tests

- `options-strategy-dashboard.store`:
  - `statsScope` derivation — all population × instance combos
    (`all`, `src-STRATEGY`, `src-SIGNAL`, `inst-{id}`).
  - `selectPopulation` patch + reload trigger; `selectInstance`
    behavior under non-STRATEGY populations.
  - Response mapping — `stats[0]` present → stats + points;
    `stats: []` → empty state; error → error slot.
  - Field renames — `openTradeCount`/`closedTradeCount`/`updatedAt`
    drive the computeds (no `openPositionCount` references remain).
- Component: selects render with correct options + disabled states;
  stats card binds renamed fields.

## Test Seams

- Highest seam: store spec with mocked `PaperTradingService` (existing
  spec pattern — no callable needed).
- Lower seams: pure `statsScope` derivation; component with a store
  stub.

## Existing Test Coverage

- `options-strategy-dashboard.store.spec.ts` — updated: replaces
  `getStrategyEquityCurve$` fixtures with `getPaperStats$`; new
  population/scope tests added.
- `options-strategy-dashboard.component.spec.ts` — updated for the
  second select + field renames.
- `options-strategy.service` spec for `getStrategyEquityCurve$` —
  deleted with the wrapper.

## Edge Cases

- `stats: []` response (scope doc not yet written) → empty state, no
  crash.
- Population switched while a load is in flight → latest scope wins
  (existing stale-response guard if present, else note).
- Instance selected then population switched to Signals → stats show
  signal scope; switching back to Strategies restores the instance
  selection (state retained).
- No stats doc for `src-SIGNAL` (no signal trades yet) → empty state.
