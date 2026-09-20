**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Auto run/save swings  
**Thread Slug:** auto-run-save-swings  
**Issue:** #419  
**Thread Parent:** #416  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** TEST  
**Status:** Complete  
**Created:** 2026-09-19  
**Last Updated:** 2026-09-19

# TEST — FE: Auto run/save swings

## Test Seams

| What | Seam | Why |
|------|------|-----|
| Batch loop orchestration, progress, error capture | `SwingAnalysisStore` unit tests (mocked `ChartService` + `SwingAnalysisService`) | Highest confidence-per-cost: the loop is pure orchestration, fully testable at store seam |
| Symbol list normalization | Pure function unit tests | String parsing edge cases |
| Batch UI (text box, button, progress, results) | Component TestBed | Binding + disabled-state behavior |
| Saved-sets browser (filter, multi-select, load) | Component TestBed + store unit tests | Filter logic in computed signals; load path in store |
| Firestore paths/serialization | Service unit tests (existing pattern) | Composite doc id `{symbol}_{paramsId}` already covered |

## Unit test targets — store

`runBatch`:
- no-ops when `batchRunning` is true or list is empty
- normalizes input: `"aapl, msft\n  QQQ  "` → `['AAPL','MSFT','QQQ']`, dedupes
- per symbol: calls `loadBars$` once, saves once per active config (dual → 2 saves, single → 1)
- does NOT call `setSymbol` / does not touch `symbol`, `bars`, `pivots`, `swings`, `stats` state
- progresses `batchProgress.done` per symbol; ends `batchRunning=false`
- bars-load failure on one symbol → recorded in `batchResults` with error, loop continues to next symbol
- save failure → same handling
- empty bars result → symbol recorded as failed/skipped
- snapshots configs at run start (config change mid-run doesn't affect in-flight run — verify via a config mutation between symbol 1 and 2)

`loadSwingSets`:
- patches `savedSets` from service result; error path sets `error`

`loadSwingSetsIntoSlots`:
- rejects docs spanning multiple symbols (no-op or error state)
- same-symbol: replaces `configs` with doc configs (N slots), recomputes all slots on current bars
- different-symbol: runs setSymbol flow first, then applies doc configs
- does not call `saveAnalysis`
- N>2 configs render correctly in derived arrays (pivots/swings/stats arrays sized N)

## Component test targets

- textarea input normalizes and feeds `runBatch` with parsed symbols
- Run button disabled while `batchRunning` or empty input
- progress line reflects `batchProgress`
- results list shows ✓/✗ per symbol
- saved-sets panel: expands → calls `loadSwingSets`; symbol filter narrows the doc list; Load button disabled for cross-symbol or zero selection; click calls `loadSwingSetsIntoSlots` with checked docs

## Integration / edge cases

- Two consecutive batch runs: second completes after first finishes
- Batch while user edits configs — batch uses snapshot; page state unaffected
- Load N sets then toggle dualMode — no crash; toggle collapses to 1 slot
- `savedAt` ordering in picker (most recent first)
- Bad ticker mid-list doesn't abort the run

## E2E / manual UAT

- Run a real 3-symbol batch against the emulator or live Firestore; confirm docs appear as `swing-sets/{symbol}_{paramsId}`
- Load 3 saved sets for one symbol — three overlays render on the chart
