**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Trend Rider Zero Cross  
**Thread Slug:** trend-rider-zero-cross  
**Blueprint:** #318  
**Task:** #319  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-14  
**Last Updated:** 2026-09-14  

---

## Verdict: PASS

---

## Review Scope

Task #319 — BE: Trend Rider Zero Cross — BE signal detection + dot markers

Files reviewed:
- `functions/src/st-cloud-function/strategies/signal-detection.ts` — added `detectAllZoneZeroCrossSignals()`
- `functions/src/st-cloud-function/indicator-computation.ts` — wired zero-cross into `generateZoneSignals()`
- `tests/functions/signal-detection-zero-cross.test.ts` — new unit tests
- `scripts/verify/indicator-lib-zero-cross-detection.ts` — new verification script

---

## Standards Axis

### Findings

**Critical — signalType collision (RESOLVED AS NON-ISSUE)**  
The zero-cross `signalType` is identical to the confirmation `signalType` (e.g. `D_ST_TREND_RIDER_V1_LONG`). This was flagged as a collision risk because the backend stores signals in maps keyed by `signalType`. However, confirmation and zero-cross cannot fire in the same direction on the same bar — their `prevZone` requirements are mutually exclusive (confirmation requires `prevZone >= 1` for longs, zero-cross requires `prevZone < 0`). Different directions produce different signalTypes (`_LONG` vs `_SHORT`), so no collision occurs. This was an explicit product decision: "you don't need to differentiate they're all just trend rider signals."

**Major — merged signal array not sorted by index (FIXED)**  
The original merge `[...confirmationSignals, ...zeroCrossSignals]` produced signals grouped by source rather than chronological order. Fixed by adding `.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))` in `indicator-computation.ts`.

**Major — reason text does not distinguish zero-cross (NON-ISSUE)**  
The reason text uses "crossed zero" which is distinguishable from confirmation's "upticked"/"downticked". The `ST Trend Rider` prefix is consistent with the product decision that these are all Trend Rider signals.

**Minor — dead `ltfBars` parameter (DEFERRED)**  
`detectAllZoneZeroCrossSignals` accepts `ltfBars: OHLCV[]` but never reads it. This is consistent with the existing `detectAllStTrendRiderSignals` which also has this parameter unused. Removing it would require changing the existing function too — deferred to avoid scope creep.

**Minor — import style (NON-ISSUE)**  
Two named exports on one import line is clean and readable.

**Nit — redundant type annotations (PRE-EXISTING)**  
The explicit type annotations in `generateZoneSignals` map callbacks are pre-existing code, not introduced by this task.

---

## Spec Axis

### PRD Acceptance Criteria

| Criterion | Status |
|---|---|
| US1: `detectAllZoneZeroCrossSignals()` detects sign flips | MET |
| US1: Zero is neutral | MET |
| US1: NaN/null zones break the sequence | MET |
| US1: Same signalType as Trend Rider | MET |
| US1: Reason describes the zero-cross | MET |
| US1: Signals merged into existing zoneV1/zoneV2 arrays | MET |
| US2: DotMarkers via existing `generateZoneDotMarkers()` | MET |
| US2: DotMarkers merged into existing dotMarkers.zoneV1/zoneV2 | MET |
| US5: Parity with TS `detectZoneZeroCrossDots` semantics | MET |

All BE acceptance criteria MET.

---

## Thermo-Nuclear Axis

### Findings

**Critical — `detectLastBarSignals` never checks zero-cross (OUT OF SCOPE)**  
`detectLastBarSignals()` is used by the strategy worker (`st-trend-rider.strategy.ts`) for real-time last-bar alerts. It only calls `detectAllStTrendRiderSignals`, not `detectAllZoneZeroCrossSignals`. This means zero-cross signals won't trigger real-time alerts via the worker path. However, the PRD US4 (signal-review integration) is satisfied through the `generateZoneSignals` path, which feeds `SignalIntervalData.zoneV1/zoneV2` for signal-list, signal-table, and signal-history. The worker real-time alert path is a separate concern and out of scope for this task. Documented as a follow-up.

**Major — merged signal array not sorted (FIXED)**  
See Standards axis above. Fixed with `.sort()`.

**Major — verification script does not hit real pipeline (ACCEPTED)**  
The verification script calls `detectAllZoneZeroCrossSignals` directly with synthetic arrays. This is appropriate for unit-level verification. End-to-end pipeline verification requires deployed functions and real symbol data, which is a QA activity.

**Major — missing integration tests (PARTIALLY ADDRESSED)**  
Unit tests cover the pure detection function thoroughly (23 tests). The merge logic in `generateZoneSignals` is a simple array concat + sort — the complexity is in the detection, which is well tested. Full integration tests for `generateZoneDotMarkers` ATR placement would require importing private functions and constructing synthetic OHLCV bars. Deferred as the unit tests provide sufficient coverage for the detection logic.

**Minor — duplicate NaN test (FIXED)**  
Replaced the duplicate test with distinct edge cases: leading NaN, trailing NaN, multi-bar transit through zero.

**Minor — test not wired into package.json (FIXED)**  
Added `test:signal-detection` script to `functions/package.json`.

---

## Fixes Applied During Review

1. **Sort merged signal array** — Added `.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))` in `indicator-computation.ts` to ensure chronological order.
2. **Wire test into package.json** — Added `test:signal-detection` script.
3. **Fix duplicate NaN test** — Replaced with distinct edge cases (leading NaN, trailing NaN, multi-bar zero transit).
4. **Add missing edge case tests** — Added 3 new tests covering leading NaN, trailing NaN, and multi-bar transit through zero.

---

## Verification Results

- Unit tests: 23/23 pass
- Functions build: passes
- Verification script: 22/22 checks pass
- Typecheck: no errors in changed files (pre-existing errors in `broker-order-adapter.ts` are unrelated)

---

## Follow-Ups (Non-Blocking)

1. **Worker real-time alerts** — `detectLastBarSignals` should eventually include zero-cross detection for real-time last-bar alerts. Separate task.
2. **Dead `ltfBars` parameter** — Both detection functions have an unused `ltfBars` parameter. Cleanup when refactoring.
3. **Integration tests** — Full pipeline integration tests for `generateZoneDotMarkers` ATR placement with zero-cross signals.
