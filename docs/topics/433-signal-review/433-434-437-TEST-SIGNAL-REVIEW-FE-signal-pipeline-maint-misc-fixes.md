**Topic:** Signal Pipeline Maintenance  
**Topic Slug:** signal-pipeline-maint  
**Thread:** Misc fixes  
**Thread Slug:** misc-fixes  
**Issue:** #437  
**Thread Parent:** #434  
**Topic Parent:** #433  
**Domain:** SIGNAL-REVIEW  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-09-19  
**Last Updated:** 2026-09-19  

# Test Plan — FE: Misc fixes lane

## E2E User Journeys

- Journey 1: User views a prior (non-latest) run on signal-review → ACR buttons enabled → Accept a symbol → staged ticket appears in order queue with the viewed run's context.
- Journey 2: User opens signal-order → header shows per-group counts and staged dollar total → row fields render real data.

## Integration Tests

- `signal-review.facade` + `group.store`: viewing a non-latest completed run enables mutations; accept stages a ticket via `OrderTicketStore` with viewed-run `runId`/`barDate` in `signalContext`.
- `order-queue.component` + ticket inputs: header aggregates reflect grouped tickets; row rendering for each source/status combination.

## Unit Tests

- Pure functions: any extracted aggregate/total helpers (per-group counts, staged dollar sum with NaN/missing `dollarAmount` guards).
- `isViewedRunCompleted`-style gate: true for any completed viewed run, false for non-completed/no run.

## Test Seams

- Highest seam: component TestBed specs (`order-queue.component.spec.ts`, signal-review page spec) — render real inputs, assert DOM.
- Lower seams: facade/store specs (`signal-review.facade.spec.ts`) with mocked stores/services — assert mutation paths and ticket staging.

## Existing Test Coverage

- `order-queue.component.spec.ts` — existing spec file to extend for header aggregates + row fields.
- `signal-review.facade.spec.ts` — existing spec to extend for prior-run mutations.
- `group.store` specs — extend for the redefined actionable gate.

## Edge Cases

- No completed runs / no viewed run → actions remain disabled.
- Viewed run still in progress → actions disabled.
- De-accept on prior run removes the staged ticket.
- All groups empty → header shows zero states sensibly; empty-state body unchanged.
- Ticket with missing `dollarAmount`/`quantity` → no fabricated values; staged-$ total unaffected.
- Non-standard `ticket.source` → badge renders real source or is omitted, never `???`.
