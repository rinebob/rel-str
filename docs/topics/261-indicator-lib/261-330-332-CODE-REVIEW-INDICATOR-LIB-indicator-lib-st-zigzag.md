**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST ZigZag Indicator  
**Thread Slug:** st-zigzag  
**Issue:** #330 (FE Blueprint)  
**Task:** #332  
**Thread Parent:** #322  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-15  
**Last Updated:** 2026-09-16  
**Review Round:** 3  

---

# Code Review: Task #332 — ZigZag Engine (Round 3)

## Summary

Three review axes (Standards, Spec, Thermo-nuclear) reviewed the pure
ZigZag engine after two rounds of fixes. The engine is split into
focused modules, the projection logic is Pine-equivalent, NaN guards
are in place, tests use exact assertions, and the last-pivot
invalidation divergence is documented.

**Verdict: PASS** — no critical or major findings. Only minor and nit
findings remain, none of which block shipping.

## Files Reviewed

Implementation:
- `st-zigzag.utils.ts` (21 lines) — shared math helpers
- `st-zigzag.types.ts` (107 lines) — shared types and defaults
- `st-zigzag.pivots.ts` (350 lines) — pivot detection + projection
- `st-zigzag.swings.ts` (76 lines) — swing derivation
- `st-zigzag.stats.ts` (143 lines) — distribution summaries + histograms
- `st-zigzag.engine.ts` (29 lines) — public API facade

Tests:
- `st-zigzag.pivots.spec.ts` (339 lines)
- `st-zigzag.swings.spec.ts` (120 lines)
- `st-zigzag.stats.spec.ts` (137 lines)
- `st-zigzag.engine.spec.ts` (91 lines) — end-to-end

## Test Results

- 40/40 tests pass across 4 spec files
- TypeScript compiles clean (no st-zigzag errors)

## Round 1 → Round 3 Resolution Summary

| Round 1 Finding | Round 3 Status |
|---|---|
| Critical: Projection left-confirmation truncated | Resolved — full leftDepth check |
| Critical: No NaN guards | Resolved — filtered in isPivotPoint, calcDev, stats |
| Major: File 540 lines | Resolved — split into 6 files |
| Major: deriveSwings discards first swing | Resolved — allows [confirmed, projection] |
| Major: Swing volume hard-coded to 0 | Resolved — deriveSwings accepts bars array |
| Major: Histogram bin sizes data-dependent | Resolved — fixed 1% and 5-bar bins |
| Major: Projection lacks Pine fallback | Resolved — secondary scan with right-side check |
| Major: Last-pivot invalidation not documented | Resolved — DIVERGENCE FROM PINE note in header |
| Major: Test assertions too loose | Resolved — exact values where deterministic |
| Major: Missing tests (NaN, projection, volume) | Resolved — all added |
| Major: computeDistributionSummary not NaN-robust | Resolved — filters non-finite |
| Minor: calcDev zero guard | Resolved — returns NaN |
| Minor: magnitudeAbsolute signed | Resolved — uses Math.abs |
| Minor: DEFAULT_CONFIG not exported | Resolved — exported from types and engine |
| Nit: Comment mismatch | Resolved |
| Nit: _rightDepth unused | Resolved — now used as rightDepth |
| Nit: Tie-breaker undocumented | Resolved — comment added |

## Round 3 Findings (all minor/nit — non-blocking)

### Minor (acceptable for ship)

1. **`pivots.ts` 350 lines** — over 300-line target but well under 400-line smell threshold. The projection logic justifies the size. Acceptable.

2. **`pivots.spec.ts` 339 lines** — over 300-line target. Acceptable for a comprehensive test file.

3. **NaN/`nz` divergence not called out** — ST rejects non-finite prices while Pine's `nz()` treats them as 0. This is a safer, more defensive choice. Documenting it as a Pine divergence would be nice but isn't required.

4. **Volume accumulation divergence** — ST sums actual bars between pivots; Pine uses rolling `sumVol`. ST's approach is more precise for batch computation. Acceptable.

5. **No dedicated right-side rejection test** — the projection invalidation test covers the newest-wins behavior, but a test explicitly for right-side rejection would strengthen coverage. Non-blocking.

6. **Stats test doesn't assert all distribution fields** — stdDev, p10, p25, p75, p90 not explicitly tested. Non-blocking — the percentile function is exercised via median.

7. **PRD wording mismatch** — PRD describes confirmation window as `leftDepth+1` to `leftDepth+rightDepth` but implementation uses standard `1..leftDepth` and `1..rightDepth`. Implementation is correct; PRD should be updated. Non-blocking for this task.

### Nit

8. **Redundant guards in isValidProjection** — `candidateIndex < leftDepth` and `idx >= bars.length` are defensive but redundant. Acceptable.

9. **A few remaining loose assertions** — `toBeGreaterThanOrEqual` in end-to-end test (structural checks). Acceptable for integration tests.

10. **`makeBars` duplicated across spec files** — could extract to shared helper. Non-blocking.

11. **`DEFAULT_CONFIG` in types file** — types file says "No runtime logic" but contains a const. Acceptable — it's a default config, not logic.

12. **Double re-export of PriceBar** — types → engine. Harmless indirection.

## Verdict

**PASS** — All critical and major findings from rounds 1-2 are resolved.
The remaining minor and nit findings are non-blocking and acceptable
for ship. The engine is pure, Pine-equivalent (within documented
divergences), well-tested (40/40), and cleanly modularized.
