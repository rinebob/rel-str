**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST ZigZag Indicator  
**Thread Slug:** st-zigzag  
**Issue:** #331  
**Thread Parent:** #322  
**Topic Parent:** #261  
**Task:** #339  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# Code Review — SHARED: Port ZigZag to standalone Pine with leftDepth/rightDepth split

## Summary

Three review axes (Standards, Spec, Thermo-nuclear) ran in parallel against
`rb-ps/rb-ta/ind/rb-st-zigzag.pine` (601 lines), a standalone Pine v6
indicator ported from the TradingView ZigZag Library v9
(`docs/topics/261-indicator-lib/reference/zigzag-lib-source.pine`, 588 lines).

The port preserves the source structure with one documented structural
change: the single `depth` input is split into `leftDepth` + `rightDepth`
to support asymmetric pivot confirmation.

## Findings by severity

### Critical
None.

### Major
None remaining. One major finding was identified by all three axes and
**fixed during review**:

- **`findProjectionPivot` bounds check used `math.max(leftDepth, rightDepth)`
  instead of `leftDepth`** — the older-side (left) bounds check at lines
  388, 394, 409 used `math.max(leftDepth, rightDepth)`, but the left-side
  validation loop only reads `leftDepth` bars. When `rightDepth > leftDepth`,
  valid projection candidates were silently rejected. **Fixed**: removed the
  `depth` variable; both bounds checks now use `leftDepth` directly. The
  right-side scan continues to use `rightDepth` via `math.min(rightDepth, pIndex)`.

### Minor
- **`minval = 2` on inputs makes `math.max(2, ...)` clamps in `update()`
  unreachable from the UI** (lines 569, 571 vs 484–485). The source used
  `minval = 1` with a runtime clamp. The clamps are kept as defensive code;
  the `minval = 2` is the source of truth for the UI. Acceptable.
- **`Settings.new()` uses 11 positional args** (lines 588–595). Correct but
  brittle. Pine v6 does not support named user-type construction, so this
  is the only option. Acceptable.
- **`findPivotPoint` `rightDepth == 0` branch is unreachable** (lines 92–93)
  because `rightDepth` is clamped to `>= 2` in `update()` and `minval = 2`
  on the input. Harmless dead code preserved from the source. Acceptable.

### Nit
- **File size 601 lines** exceeds the project soft target of 400 lines.
  Justified: the implementation plan explicitly calls for a single
  self-contained Pine file, and the source library is 588 lines. The +13
  line delta is from the extra `rightDepth` input/field plumbing and the
  `indicator()` vs `library()` declaration. Tracked as a known boundary
  exception.

## Test results

**Testing deferred** per the test plan
(`261-322-325-TEST-INDICATOR-LIB-shared-indicator-lib-st-zigzag.md`):
Pine scripts have no automated unit or integration test harness. Manual
verification against TradingView charts is the only test seam.

**Manual verification status:**
- ✓ Script compiles in TradingView Pine Editor (user-confirmed)
- ✓ Script runs on a chart (user-confirmed)
- ⚠ Asymmetric depth verification (`leftDepth ≠ rightDepth`) — **not yet
  performed**. Recommended test cases before `8_LIVE`:
  - `leftDepth = 5, rightDepth = 5` vs TradingView built-in `depth = 10`
  - `leftDepth = 3, rightDepth = 7`
  - `leftDepth = 7, rightDepth = 3`
  - `projectionPivots = false`
  - `allowZigZagOnOneBar = false`

## Verdict: PASS

All three review axes found no critical or remaining major findings after
the `findProjectionPivot` fix. The minor and nit findings are acceptable
with justification. Testing is deferred per the test plan (Pine has no
automated test harness); manual verification of compilation and basic
chart rendering is confirmed. Asymmetric depth verification is recommended
before `8_LIVE` but is not blocking for `7_QA`.

## Acceptance criteria status

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `rb-st-zigzag.pine` created in `rb-ps/rb-ta/ind/` | MET |
| 2 | Standalone Pine v6 indicator (not library) | MET |
| 3 | `depth` split into `leftDepth` + `rightDepth` inputs | MET |
| 4 | `findPivotPoint` uses asymmetric left/right depths | MET |
| 5 | Projection pivots included (`findProjectionPivot`, `updateProjectionPivot`) | MET |
| 6 | All display settings preserved | MET |
| 7 | MPL 2.0 license header + TradingView attribution preserved | MET |
| 8 | Manual verification against TradingView charts | DEFERRED (compile + basic render confirmed; asymmetric depth verification pending) |
