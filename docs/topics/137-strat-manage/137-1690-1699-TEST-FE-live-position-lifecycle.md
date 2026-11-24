**Topic:** Strategy Manager  
**Topic Slug:** strat-manage  
**Thread:** Live Position Lifecycle  
**Thread Slug:** live-position-lifecycle  
**Issue:** #1699  
**Thread Parent:** #1690  
**Topic Parent:** #137  
**Domain:** FE  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# TEST-FE: dashboard remediation specs + UAT

## Scope

`options-strategy-dashboard` store + component specs for column semantics, population filter, leg display, links; manage-table name binding. Store-driven (dumb component per convention).

## E2E User Journeys

- Dashboard: open table shows signed net `Current` + `currentValueAsOf` freshness + debit-aware premium; a debit row shows its cost, not `$0.00`.
- Population: `SIGNAL` scopes stats AND filters the position tables to signal-source option rows; `STRATEGY` shows instance-driven rows; `ALL` unions.
- Row click → manage instance view and/or analysis route — no dead ends.
- A 4-leg position exposes all legs.

## Integration Tests

- Store: population filtering over mixed rows; derived fields; selector/table coherence.
- Component: row → router link construction (instance + analysis targets).

## Unit Tests

- Signed `Current` formatting — credit negative-liability vs debit asset; posture label/fork.
- Premium column — credit collected vs debit paid; never `$0.00` on live rows.
- Leg detail render — 4-leg row exposes all strikes/expirations; primary leg anchors sort.
- `currentValueAsOf` staleness display.
- `variantDisplayName` binding — CDS name correct (regression pin).
- Link targets — instance id → correct routes.

## Test Seams

- Store stubs at the service seam (`listStrategyPositions`/`getPaperStats` fakes) — established pattern.
- Router: `provideRouter([])` + navigate/serializeUrl assertions (the #1307 pattern).

## Test data / fixtures

- Wire rows: credit spread, debit spread, 4-leg IC, signal-source option row (trigger=SIGNAL), stopped-instance row.

## Existing Test Coverage

- `options-strategy-dashboard.store`/component specs — extend; the Results-dialog and analysis-link specs from #1549 stay green.

## Edge Cases

- `currentValueAsOf` absent → honest "—", not a fabricated "now".
- Population=SIGNAL with zero signal rows → honest empty table (labeled), not strategy rows leaking through.

## Verify relay

- `npx jest` suite green → UAT doc at `/proj qa` (route `/options/strategy-dashboard`, nav path stated, concrete instance/position data from the deployed corpus — e.g. the `QQQ-*` manage instances).
