**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Core Infra  
**Thread Slug:** core-infra  
**Issue:** #556  
**Thread Parent:** #554  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-09-24  
**Last Updated:** 2026-09-24  

# Test Plan: Paper Trading Infra — FE

## E2E User Journeys

- User accepts a staged signal ticket as paper → cohort + equity trade created; queue shows PAPER badge; no RH order.
- User launches a strategy instance from the builder → instance doc written to new path → visible on dashboard after next open pass.
- User opens paper trade dashboard → sees account header, trades grouped by selected dimension, cohort drill-down shows expression/variant outcomes.

## Integration Tests

- `OrderComponent` + `OrderTicketStore` + mocked `PaperTradingService`: accept-as-paper flow calls the callable, updates ticket state, renders the PAPER badge; error path shows snackbar.
- `StrategyBuilderService` reads/writes `paper-trading/instances/items` — path-level assertion on Firestore calls (mock Firestore per existing spec pattern).
- Dashboard component + `PaperTradingStore` with mocked callables: renders groups, cohort view, variant run rows.

## Unit Tests

- `PaperTradingStore` reducers/selectors: filtering by source/instance/cohort/variant, stats mapping, loading/error states.
- Variant-run display helpers: governing vs shadow labeling, exit-event formatting, P&L formatting.
- Badge/affordance logic: which tickets show the paper action (staged signal tickets only).

## Test Seams

- Highest seam: component + store via TestBed with the callable-backed service mocked — same pattern as existing savant-trader specs.
- Lower seams: pure selector/display functions.

## Existing Test Coverage

- `strategy-builder.*.spec.ts`, `options-strategy-dashboard.component.spec.ts`, order-page specs — updated paths/assertions continue to cover the moved surfaces.

## Edge Cases

- Empty ledger → dashboard empty state.
- Callable failure on accept → error surfaced, ticket unchanged, no partial UI state.
- Trade with no variant exits yet → variant section shows ACTIVE runs only.
- Paper badge never renders on RH-submitted tickets and vice versa.
