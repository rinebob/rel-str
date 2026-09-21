**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Add previous/next symbols capability to Swing Analysis  
**Thread Slug:** symbol-prev-next  
**Issue:** #453  
**Thread Parent:** #451  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Test Plan  
**Status:** Approved  
**Created:** 2026-09-20  
**Last Updated:** 2026-09-21  

# Test Plan — FE: Previous/next symbol navigation

## E2E User Journeys

- Journey 1: Analyst opens swing-analysis → clicks next → chart/table/stats reload for the adjacent tracked symbol with unchanged slot params → `N of M` increments.
- Journey 2: Analyst selects PRIMARY in the filter → pages through only PRIMARY symbols in list order → wraps at the end.
- Journey 3: Analyst viewing a tradable-looking chart clicks a list chip → symbol moves into that list (persisted) → reflected on return visit.
- Journey 4: A symbol fails to load → error state shows → analyst clicks next → next symbol loads normally.

## Integration Tests

- `SwingAnalysisStore` + mocked `RelStrDbV2Service`/`ChartService`/`SwingAnalysisService`: nav methods drive `setSymbol` with correct target; pivots/swings/stats recompute path invoked.
- Store + mocked `SymbolListStore` state: `navSequence` reacts to `navFilter` and `symbolLists` changes; chips' toggle updates sequence when membership changes.
- Page component + stores: buttons emit nav calls; indicator renders position; filter select sets `navFilter`.

## Unit Tests

- `navSequence` ordering: alphabetical for `ALL`; stored list order for a filter; stale symbols (in list, not tracked) dropped.
- `navIndex`/`navPosition`: in-sequence, out-of-sequence (`— of M`), empty sequence.
- `nextSymbol`/`prevSymbol` index math: normal step, wrap at both ends, out-of-sequence entry points (next → first, prev → last), empty no-op.
- Symbol dedupe/uppercase normalization on tracked-symbol load.

## Test Seams

- Highest seam: `SwingAnalysisStore` specs with `RelStrDbV2Service`, `ChartService`, `SwingAnalysisService`, `SymbolListStore` mocked — covers nav + filter + recompute delegation without network.
- Lower seams: pure ordering/index helpers; `swing-analysis-page` TestBed spec for controls and chips.

## Existing Test Coverage

- `swing-analysis.store.spec.ts` covers `setSymbol` + recompute — nav tests extend this suite's mock scaffolding.
- `group.store.spec.ts` / `symbol-list-actions` usage in `symbol-row.component.spec.ts` show `SymbolListStore` mocking precedent.

## Edge Cases

- Empty state: no tracked symbols loaded (service failure) → nav disabled, indicator `— of 0`.
- Error state: failed `setSymbol` mid-nav — indicator and buttons remain functional.
- Loading state: rapid prev/next clicks — stale bar-load subscriptions cancelled (existing behavior, regression-tested).
- Filter switching while viewing an out-of-list symbol.
- Membership toggle on a symbol not in any list vs moving between lists (exclusive move semantics preserved).
