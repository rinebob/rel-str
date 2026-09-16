**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Option chain percent change grid
**Thread Slug:** initial-impl<br>
**Issue:** #342  
**Thread Parent:** #327
**Topic Parent:** #326  
**Task:** #345  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-16  
**Last Updated:** 2026-09-16  

---

# Code Review: Task #345 — FE `computePctChange` + `pctChangeToColor`

## Summary

Task #345 adds two pure utility functions and their unit tests:
- `computePctChange` — matches contracts across start/target snapshots,
  computes percentage price change, applies filters, returns a grid
- `pctChangeToColor` — maps a pctChange value to a CSS color on a
  diverging red-neutral-green scale

Three review axes were run: Standards, Spec, and Thermo-nuclear.

## Findings by severity

### Critical (resolved during review)

1. **`pctChangeToColor` did not honor p5→red / p95→green for one-sided
   ranges** — The original implementation always pivoted on 0, which
   broke when the entire range was positive or negative. Rewrote to use
   a three-anchor diverging scale when the range straddles 0, and a
   direct red-to-green interpolation for one-sided ranges. Added tests
   for all-positive, all-negative, p5=0, and p95=0 cases.

### Major (resolved during review)

2. **Missing delta bypassed the delta filter** — If `start.delta` was
   missing and a `deltaGte`/`deltaLte` filter was set, the contract was
   still retained. Fixed: missing delta now fails the filter. Added test
   for this case.

3. **`Map<string, PctChangeCell>` used a fragile ad-hoc string key** —
   The key format `${strike}-${expiration}` was an implementation detail
   that tests and future consumers had to replicate. Added an exported
   `cellKey(strike, expiration)` helper and updated all tests to use it.

### Minor (resolved during review)

4. **`PctChangeFilter.type` used string literal instead of `OptionType`** —
   Changed from `type: 'call' | 'put'` to `type: OptionType` to keep
   one source of truth. Updated all tests to use `OptionType.CALL` /
   `OptionType.PUT`.

5. **`_neutralColor` was an idiosyncratic one-line function** — Replaced
   with a `NEUTRAL_COLOR` constant. Also extracted `RED`, `GREEN`
   constants and `lerp` / `rgb` helpers for clarity.

6. **`PctChangeCell.delta` defaulted to 0 for missing values** — Changed
   to `delta: number | null` so missing delta is distinguishable from
   a true zero delta. Added test verifying `cell.delta` is `null` when
   delta is missing and no delta filter is set.

### Minor (deferred)

7. **`computePctChange` is a single multi-concern function** — At 87
   lines it handles matching, filtering, percentile computation, and
   grid construction. Could be decomposed into `matchContractPairs`,
   `applyPctChangeFilter`, `buildPctChangeGrid`. Deferred: the function
   reads clearly as one flow, is the primary test seam, and decomposition
   would add indirection without improving testability for this task.

8. **Local helpers duplicate existing patterns** — `toNum` is similar
   to `parseNum` in `contract-observation.utils.ts`, `percentile`
   duplicates inline code in `st-zigzag.stats.ts`, and `daysBetween`
   duplicates date math in `contract-observation.utils.ts`. Deferred:
   promoting these to shared utilities is a separate refactor. `toNum`
   is actually stricter (rejects `''`) and could become the canonical
   version in a future cleanup.

9. **No source consumers yet** — The new functions are only imported by
   their own specs. Expected for a utility-only task; Task #346 (FE
   service + store) and Task #347 (grid component) will wire them in.

## Test results

- **Unit tests (`ng test --include="**/option-chain-pct-change/**/*.spec.ts"`):**
  36/36 PASS (23 pct-change + 13 color-mapping)
- **Angular build (`ng build`):** PASS
- **Pre-existing FE test failures:** The `swing-analysis` directory
  (untracked Topic #261 work) causes TS compilation load errors that
  prevent the full test suite from running. This is pre-existing and
  unrelated to Task #345. Verified by temporarily moving the directory
  out of the src tree — all 36 Task #345 tests pass cleanly.

## Verdict: PASS

All critical and major findings resolved during review. Deferred
findings are intentional design decisions or separate refactors.
All 36 unit tests pass. Angular build passes.
