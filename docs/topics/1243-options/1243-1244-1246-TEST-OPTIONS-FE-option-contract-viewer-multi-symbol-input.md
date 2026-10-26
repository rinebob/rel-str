**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Multi-symbol input  
**Thread Slug:** multi-symbol-input  
**Issue:** #1246  
**Thread Parent:** #1244  
**Topic Parent:** #1243  
**Domain:** OPTIONS  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-24  
**Last Updated:** 2026-10-24  

# Test Plan — FE: Multi-symbol input

## E2E User Journeys

- Journey 1: User pastes N `(date, contractId)` lines → Load → one mark line per contract on the main pane, strike-span markers visible, underlying overlaid
- Journey 2: User pastes a list containing invalid tokens and wrong-underlying IDs → valid contracts still render, rejected entries listed with reasons
- Journey 3: User pastes one pair → existing single-contract view renders (all panes) plus its span marker
- Journey 4: User clicks a plotted chip → chart flips to that contract's full single-contract view
- Journey 5: User removes a chip → its mark line + marker disappear, rest remain
- Journey 6: User toggles display window → clipped series extend to full lifetime and back
- Journey 7: User hovers a chip → its line/marker pop, other series dim; un-hover restores

## Integration Tests

- `parsePlottedEntries` + `loadPlotted` — valid entries produce plotted-contract state; rejections surface separately
- Store → chart: `plottedSeries` from mixed open-dated/bare contracts feed correct `allDates` union and marker spans
- Page → store: pasted text → parsed entries → `loadPlotted` invoked once; removal/focus/hover calls reach store
- `getHistoricalOptionsContract$` mocked at service level (Firebase `Functions` stub provider pattern per AGENTS.md)

## Unit Tests

- `parsePlottedEntries`: comma/space/newline separators; lowercase input uppercased; invalid OCC rejected; invalid date rejected; wrong-underlying rejected with the offending token reported; duplicate `contractId` merges to earliest `openDate`; bare `OCCID` accepted with `openDate: null`
- Union-of-dates + null-padding mapper: disjoint/overlapping ranges; marker dates (openDate/expiration) included in the union even when not observation dates
- Clip filter: `date >= openDate` in position mode; bare-ID contracts unaffected; identical marker spans in both modes
- Span-marker derivation: `{open, strike} → {expiration, strike}` endpoints; fallback to first observation when `openDate` absent
- Store: `loadPlotted` concurrency limit respected; one failed contract → `error` status on that entry, others still land; `loadPlotted` progress counter reaches `total`

## Test Seams

- Highest seam: store + mocked `OptionsContractService` — covers parse → load → plotted-state pipeline without the chart
- Component seam: TestBed render of the chart with a fabricated `plottedSeries` input — asserts series count, marker series, pane gating at N=1 vs N≥2
- Lower seams: pure parser/mapper/clip/marker functions — all inputs in, structures out

## Existing Test Coverage

- `options-contract-viewer.store.ts` specs cover single-contract load and catalog features — extend alongside, don't modify existing assertions beyond the input refactor
- `spread-viewer.store.spec.ts` is prior art for multi-series state; spread chart's union-of-dates mapping is prior art for the axis work
- Existing chart spec coverage for `options-contract-chart` — needs updates for the `plottedSeries` input shape

## Edge Cases

- Empty paste / all-rejected input → no fetch calls, full rejection notice
- Single-entry list → single-contract view, not multi mode
- `openDate` after expiration (bad input) → marker not rendered or clamped; contract still plots
- `openDate`/`expiration` not present in any contract's observation dates → markers still align (union includes them)
- Contract with zero observations → error/empty state on that entry, no crash
- Fetch failure mid-batch → remaining contracts still resolve; progress completes
- Duplicate `contractId` with different dates → one series, earliest open date marker
- ~50+ contracts → soft warn path; ~187-contract stress input doesn't hang (concurrency bound)
