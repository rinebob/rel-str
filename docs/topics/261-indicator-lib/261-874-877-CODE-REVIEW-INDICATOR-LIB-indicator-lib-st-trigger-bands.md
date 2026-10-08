# Code Review — Trigger Bands contract, callable wiring and dot markers (#877)

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Implement ST Trigger Bands in ST Indicator Library  
**Thread Slug:** st-trigger-bands  
**Issue:** #874  
**Thread Parent:** #862  
**Topic Parent:** #261  
**Task:** #877  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

## Verdict: **PASS**

Standards **PASS** · Spec **PASS** · Thermo-nuclear **PASS**. No critical or major findings; one nit fixed in-loop, four minor/info items recorded. Reviewed inline (no sub-agents) against the PRD (#863), the BE implementation plan and the BE test plan.

## Scope

- `functions/src/st-cloud-function/indicator-computation.ts`: `TriggerBandsPoint`, `DotMarker.version 'TB'`, `dotMarkers.triggerBands`, `computeTriggerBandsSeries`, `generateTriggerBandsDotMarkers`, wiring in `computeSymbolIndicatorSeries`
- `functions/src/st-cloud-function/indicator-series-filter.ts` (new; extracted from `indicator-series.ts`) and `indicator-series.ts`
- `src/app/features/savant-trader/common/indicator.types.ts` (mirrored contract)
- `tests/functions/st-trigger-bands-series.test.ts` (14 tests), `functions/scripts/verify/indicator-lib-877-callable.ts` + guide, README row, `run-all.ts` registration
- BE implementation plan (offset and extraction notes)

## Standards

- Contract changed in both type files in the same task, with identical field names and types; `tsc --noEmit` clean for `functions/` and `tsconfig.app.json`.
- `filterResponse` extraction is a pure move plus one added branch; the other families' filtering is textually unchanged. The new module has no Firebase imports, which is what makes the filtering testable.
- Dot generation reuses `computeATR` and the zone-dot placement convention; helpers follow the file's existing style.
- No dead code, no type-erased fixtures. Tests follow the repo's node:test conventions and assert on external behavior.

## Spec

| Acceptance criterion (#877) | Result |
|---|---|
| `TriggerBandsPoint` fields in both type files | Met |
| `DotMarker.version` accepts `'TB'`; `dotMarkers.triggerBands` in both type files | Met |
| `indicators.triggerBands` for daily, weekly, monthly, independent of the 30-bar gate | Met (test: 7-bar daily returns bands while `zoneV1` stays null) |
| One breakout dot per breakout flag, one pullback dot per pullback flag, plan signal types | Met (`TRIGGER_BANDS_{LONG,SHORT}_{PULLBACK,BREAKOUT}`) |
| `filterResponse` returns series and dots only when `TRIGGER_BANDS` is requested; defaults unchanged | Met (5 filter tests) |
| Existing families unchanged | Met (zoneV1/zoneV2/trendBands equal `computeIndicatorSeries`; trend-strength dots, zone dots and HTF windows still present) |
| Integration and callable-filter tests pass; `npm run build` passes | Met |

PRD stories 4 (per-bar state available to strategies) is met at the contract level; story 3 (dots) is met at the data level, rendering is #880.

## Thermo-nuclear

- The `interval(...)` helper in `computeSymbolIndicatorSeries` removes three copies of the same object literal and keeps the Trigger Bands attachment in one place.
- The callable's own `onCall` handler is not unit tested (it needs Firebase); its filtering logic now is, and the real-data script exercises computation plus filtering end to end.

## Findings

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | Nit | `indicator-computation.ts` ~L477: missing blank line between `generateTriggerBandsDotMarkers` and the next comment block. | Fixed in-loop. |
| 2 | Minor | Trigger Bands series and dots are computed on every callable call, even when not requested (engine ~0.9 ms on 1,823 bars; whole compute ~45 ms). | Accepted: negligible, and avoids threading the filter into the compute layer. |
| 3 | Minor (advisory) | Payload when opted in, AAPL, uncompressed JSON: daily series 329 KiB + dots 381 KiB, weekly 68 + 75, monthly 18 + 19; total +892 KiB (+33%) on a 2.7 MB default. On-the-wire size not measured (callable response compression unverified). | Follow-up for #879/#880: request only the rendered intervals; if still heavy, derive dots on the FE from the flags (the FE has the bars) instead of sending them. |
| 4 | Minor | `signalType` strings (`TRIGGER_BANDS_*`) are literals in the BE and will be matched as literals by the FE converter (#880). | Accepted; #880 should define them once on the FE side and test against the BE strings. |
| 5 | Info | `StrategyFamily.TRIGGER_BANDS` and `signals.triggerBands` remain reserved and unused, by design (indicator only). | None. |

## Test results

- `npx tsx --test` (from `functions/`): `st-trigger-bands`, `st-trigger-bands-series`, `std-dev-lines`, `signal-detection-zero-cross`: **88/88 pass**.
- `npx jest tests/functions/screenshot-capture --coverage=false`: **147/147 pass** (the assembler consumes the callable's response shapes).
- `npx tsc --noEmit -p .` (functions) and `npx tsc --noEmit -p tsconfig.app.json`: clean. `npm run build` (functions): clean.
- `npx tsx scripts/verify/indicator-lib-877-callable.ts AAPL`: **21/21** (real bars, D/W/M).
- Not run: the full FE Jest suite (FE change is types only; app typecheck is clean).
