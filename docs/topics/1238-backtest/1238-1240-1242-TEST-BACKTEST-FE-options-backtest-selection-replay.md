**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Domain:** BACKTEST  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-25  
**Last Updated:** 2026-10-25  

# Test Plan — FE: Selection Replay

## E2E User Journeys

- Journey 1: User opens the Selection Replay surface → runs list shows replay runs with template name, symbols, status, progress.
- Journey 2: User launches a replay run from the run dialog (template + symbols + startDate) → run appears in the list → detail view shows per-symbol contract lists.
- Journey 3: Contract-list table shows pick rows in date order; `no-selection` marker rows render in place (not omitted); coverage header shows pick/miss counts, range, gridVersion.
- Journey 4: Consecutive days selecting the same contractId show a repeat label; each remains its own row.
- Journey 5: User clicks a row's inspect action → dialog fetches `getHistoricalOptionsContract$` and renders the mark line; loading → chart; error state names the contractId.

## Integration Tests

- Runs service → Firestore listeners: fixture run docs + list docs populate the runs list and detail view; status/progress update live.
- Run dialog → `optionsReplayStart` (Firebase `Functions` stub provider): template selection + symbols + startDate produce the correct request payload; response navigates to detail.
- Table → dialog → `getHistoricalOptionsContract$` stub: row action fetches once for that `contractId`, feeds the series input; repeated clicks don't refetch while open (or refetch-per-open — whichever the impl picks, assert it).
- Store/service seam: `ContractListRow[]` fixtures (pick + marker + repeats) → table rows correct without any backend.

## Unit Tests

- Row rendering mapper: pick row → all columns; `no-selection` row → marker cells; `repeatsPrevious` → repeat badge present/absent correctly.
- Coverage-header derivation from `pickDocMeta` + row counts (displayed counts match meta vs. computed — impl picks one source; assert consistency).
- Template dropdown: bound to `REPLAY_TEMPLATES`, shows name + description, emits `templateId`.
- Dialog states: loading, loaded (series passed to chart), error, empty-series; contractId surfaced in error text.
- Runs list: status→display mapping; progress `completedLists/totalLists`; failed-count badge.

## Test Seams

- Highest seam: runs service + mocked Firestore listener — covers list → detail → table without backend.
- Dialog seam: `getHistoricalOptionsContract$` stubbed at the service level; assert the series object the chart input receives, not rendered chart internals.
- Pure seams: row→cell mapper, coverage-header derivation, repeat-badge predicate.
- Table tests render fixture rows directly — no store needed.

## Existing Test Coverage

- `backtest-run.service` / backtest list component specs are the precedent for Firestore-listener test patterns — mirror them.
- Options chart viewer specs (`options-contract-chart.component.spec.ts`, store specs) are precedent for `getHistoricalOptionsContract$` stubbing.
- Keep existing signal-sim dialog/list specs untouched — replay surface is additive; the only shared-file risk is the run-dialog entry point.
