**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Multi-symbol input  
**Thread Slug:** multi-symbol-input  
**Issue:** #1268  
**Thread Parent:** #1244  
**Topic Parent:** #1243  
**Task:** #1262  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-06-23  
**Last Updated:** 2026-06-23  

## Scope

Pair parser + plotted-set store slice (no UI surface — the page is unchanged). Covers:

- `parsePlottedEntries(text, symbol)` — `(openDate, contractId)` pairs per line (comma/space/tab), bare OCC IDs, dedupe keeping earliest `openDate`, rejections tagged `invalid-contract` / `invalid-date` / `wrong-underlying`
- `withPlottedContracts` store feature — `loadPlotted` (concurrency-6 worker pool, per-contract failure tolerance, `{done,total}` progress), `removePlotted`, `clearPlotted`, `setDisplayWindow`, `setHoveredContract`, `focusPlotted`
- Computeds: `plottedList`, `isMultiMode`, `renderedSeries` (position-window clip at `openDate`), `allDates` (rendered union + marker endpoints)

Out of scope (later tasks): chart rendering (#1263), textarea + chips UI (#1264), connected hover (#1265).

## Prerequisites

- Repo checkout with `npm install` done.
- No credentials, services, or running app required — all checks are offline (jest + tsx).

## Start instructions

```bash
# from repo root
npx tsx scripts/verify/options-plotted-pairs-1262.ts     # scenario 1
npx jest src/app/features/savant-trader/utils/plotted-pairs.util.spec.ts --coverage=false     # scenario 2
npx jest src/app/features/savant-trader/stores/plotted-contracts-feature.spec.ts --coverage=false   # scenario 3
```

## Test scenarios

### 1. Parser contract — verify script

**Feature:** `parsePlottedEntries` acceptance + rejection contract.  
**Steps:** run `npx tsx scripts/verify/options-plotted-pairs-1262.ts`.  
**Expected:** 11 `OK` lines covering separator variants, bare ID, dedupe-earliest-openDate, all three rejection reasons, raw-line echo on rejections, valid-survives-invalid.  
**Result:** PASS — `=== ALL 11 CHECKS PASSED ===` (exit 0).

### 2. Parser unit spec

**Feature:** parser edge cases — blank lines, lowercase→uppercase normalization, impossible calendar dates, empty input.  
**Steps:** `npx jest src/app/features/savant-trader/utils/plotted-pairs.util.spec.ts --coverage=false`.  
**Expected:** 12 tests pass.  
**Result:** PASS — 12/12.

### 3. Store feature spec

**Feature:** plotted-set lifecycle. Covers: initial state; per-entry fetch + `loaded` status; dedupe/no-refetch with earliest-openDate merge; partial failure (one `error`, others `loaded`); `removePlotted`; `clearPlotted` (set + hover cleared); `displayWindow`/`hoveredContractId` setters; `renderedSeries` position-clip + bare-ID exemption + lifetime mode; **resurrection guards** (remove/clear while fetch in flight → no zombie entries, progress stays null); **error re-queue** on re-paste; `allDates` union + expiration marker endpoint.  
**Steps:** `npx jest src/app/features/savant-trader/stores/plotted-contracts-feature.spec.ts --coverage=false`.  
**Expected:** 13 tests pass.  
**Result:** PASS — 13/13.

### 4. Regression smoke

**Feature:** no collateral damage to the options viewer or surrounding savant-trader surface.  
**Steps:** `npx jest src/app/features/savant-trader --coverage=false`.  
**Expected:** all suites pass.  
**Result:** PASS — 131 files / 2606 tests.

### 5. Typecheck

**Steps:** `npx tsc --noEmit -p tsconfig.app.json`.  
**Expected:** no errors.  
**Result:** PASS.

## Traceability

| Criterion (Task #1262) | Scenario |
|---|---|
| Parser accepts `date,OCCID` / `date OCCID` / bare `OCCID`; rejects invalid contract/date/wrong-underlying with tokens reported | 1, 2 |
| Duplicate contractIds merge, earliest `openDate` kept | 1, 2 |
| `loadPlotted` concurrency-bounded fetches + `{done,total}` progress | 3 |
| Per-contract failure tolerance | 3 |
| `removePlotted` / `clearPlotted` / `setDisplayWindow` / `setHoveredContract` / `focusPlotted` | 3 |
| `isMultiMode` ≥ 2 | 3 |
| `PlottedEntry` in `shared/options-contract-contracts.ts` | 1, 2 (import resolves), 5 |
| PRD: plotted set dedupes by OCC ID | 1, 3 |
| PRD: same-underlying validation | 1, 2 |
| PRD: clip-to-entry data behavior (position window) | 3 (`renderedSeries`) |

## Refinement pass

Not applicable — no user-facing surface. UI acceptance lands with #1263–#1265.

## Findings

None. Deferred items recorded on the code-review doc: cross-batch progress conflicts (single caller in v1), `focusPlotted`↔remove coherence (decision at #1264).
