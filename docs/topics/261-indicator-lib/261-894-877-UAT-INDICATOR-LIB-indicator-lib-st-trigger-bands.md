# UAT — Trigger Bands contract, callable wiring and dot markers (#877)

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Implement ST Trigger Bands in ST Indicator Library  
**Thread Slug:** st-trigger-bands  
**Issue:** #894  
**Thread Parent:** #862  
**Topic Parent:** #261  
**Task:** #877  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

## Scope

Task #877 puts Trigger Bands into the indicator-series pipeline: `TriggerBandsPoint` (bands + six flags), `dotMarkers.triggerBands` (pullback and breakout dots, version `TB`), `computeSymbolIndicatorSeries` wiring for daily/weekly/monthly, and the callable's response filtering (`indicator-series-filter.ts`). It has no user-facing surface; chart rendering is #879/#880. Covered: PRD #863 stories 3 (dot data) and 4 (per-bar state for strategies), and 5 (opt-in request gating), at data/contract level.

## Prerequisites

- Repo `C:\aa\projects\rel-str`, dependencies installed in `functions/` and at the root.
- Scenarios 3 and 4 need Application Default Credentials with read access to the rel-str Firestore `symbol-data` collection and the IPv4-only Node preload (`AGENTS.md`).
- No feature flags, seed data or UI.

## Scenarios

### 1. Pipeline and filtering tests (automated)

- **Steps:** `cd functions` then `npx tsx --test ../tests/functions/st-trigger-bands-series.test.ts`
- **Expected:** 14 tests, 14 pass. Covers: one point per bar with matching dates for D/W/M; present for sub-30-bar intervals; bands and six flags equal the engine on a hand-worked fixture; non-finite bands become null; existing families unchanged; dot count/types/indices/placement (long below the bar low, short above the bar high); empty for fewer than 3 bars; `filterResponse` returns Trigger Bands only when `TRIGGER_BANDS` is requested and never for the default set or a strategies-only request; default sets unchanged.
- **Result:** PASS, 14/14 (2026-10-07).

### 2. Regression suites (automated)

- **Steps:** `cd functions` then `npx tsx --test ../tests/functions/st-trigger-bands.test.ts ../tests/functions/std-dev-lines.test.ts ../tests/functions/signal-detection-zero-cross.test.ts`; then from the repo root `npx jest tests/functions/screenshot-capture --coverage=false` (the assembler consumes the callable's response shapes).
- **Expected:** all pass.
- **Result:** PASS, 74/74 and 147/147 (2026-10-07; Jest run during review, same code).

### 3. Real-data pipeline verification

- **Steps:** from `functions/`: `npx tsx scripts/verify/indicator-lib-877-callable.ts AAPL`
- **Expected:** `21/21 checks passed`: for daily, weekly and monthly, one point per bar aligned to bar dates, bands and all six flags equal `computeStTriggerBands`, dot count equals the flag count, dot placement and tag correct, last point is the last bar; the default request returns no Trigger Bands; the opt-in request returns series and dots for every interval; payload sizes printed. Exit 0.
- **Result:** PASS, 21/21 (2026-10-07): 1,823 daily / 379 weekly / 101 monthly bars; payload default 2,675 KiB vs 3,567 KiB with Trigger Bands (+33%).

### 4. Build and typecheck

- **Steps:** `cd functions` then `npm run build` and `npx tsc --noEmit -p .`; from the repo root `npx tsc --noEmit -p tsconfig.app.json` (the mirrored FE contract).
- **Expected:** no errors.
- **Result:** PASS (2026-10-07).

## Not covered

- The deployed `getSymbolIndicatorSeries` HTTP callable (needs a deploy; the script exercises the same computation and filtering code with real cached bars, not the HTTP wrapper).
- On-the-wire (compressed) payload size; only uncompressed JSON size was measured.

## Traceability

| Criterion | Scenario |
|---|---|
| `TriggerBandsPoint` fields in both type files | 1, 4 |
| `DotMarker.version 'TB'`, `dotMarkers.triggerBands` in both type files | 1, 4 |
| `indicators.triggerBands` for D/W/M, independent of the 30-bar gate | 1, 3 |
| One dot per breakout/pullback flag with plan signal types | 1, 3 |
| Filtering: returned only when `TRIGGER_BANDS` is requested; defaults unchanged | 1, 3 |
| Existing families unchanged (regression) | 1, 2 |
| Integration/callable-filter tests and build pass | 1, 4 |
| PRD story 4: per-bar flags available for strategies | 1, 3 |

## Regression / smoke

- Neighbouring indicator and signal suites and the screenshot assembler: scenario 2.
- No existing function signature changed; `filterResponse` and the default sets moved to a new module with unchanged behavior for the existing families (scenario 1 checks the defaults).
