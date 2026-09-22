**Topic:** Flex Chart Maintenance  
**Topic Slug:** flex-chart-maint  
**Thread:** Fix Log Scale Y-Axis  
**Thread Slug:** fix-log-y-axis  
**Issue:** #476  
**Thread Parent:** #469  
**Topic Parent:** #468  
**Task:** #478  
**Domain:** FLEX-CHART  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

## Scope

Task **#478** — synthetic data mode + edge-case presets for the sandbox: `synthetic-data.ts` (seeded generator), `synthetic-data.spec.ts`, and the sandbox component/template/spec diffs adding the real/synthetic mode toggle and preset select.

## Standards

No documented-standard violations. Findings (all addressed unless noted):

- **Walk-poisoning bug** — `prevClose = bar.close` read the post-`corrupt` close, so the zeroed bar at index 250 zeroed the entire tail (251–499). **Fixed**: carry the pre-corruption close; spec strengthened to assert exactly one fully-zeroed bar and a live tail.
- Timezone fragility — `date` was built from `toISOString()` while `x` was local-midnight; they'd disagree in UTC+ zones. **Fixed**: `date` built from local components; spec asserts the invariant.
- Magic numbers in `corrupt` (250/40/97/-1.5) — judgement call, documented by the block comment; left as-is.
- `debugVisibleText` re-implements visible hi/lo — accepted for a debug readout.

## Spec

Issue #478 acceptance criteria:

1. Deterministic generator, no backend calls — **met** (mulberry32; spec proves determinism and `loadBars$` not called in synthetic mode).
2. Mode toggle swaps datasets — **met** (`dataMode` signal; both branches feed `[chartData]`).
3. Presets: ≥10x range, low-priced, ≤0 values — **met** (wide-ratio ~150x, penny mean-reverting ~$0.15, non-positive bad ticks); spec asserts each.
4. Same config/indicators path — **met**: identical `FlexChartDataset`/`config` input path. `indicators: []` is a deliberate sandbox choice (PRD US2/US9 overlay verification is #482's acceptance pass, not this task's).

Minor mismatches fixed in review: interval buttons now disabled in synthetic mode (generated bars are daily cadence — W/M labels would lie); `chartStore` loading/error banner gated to real mode; dataset regeneration memoized to preset changes only; `[value]` on the preset select.

## Thermo-Nuclear

- The walk-poisoning major (above) — **fixed**.
- Viewport collapse under ≤0 lows is the *intended* stress: `toLogAxis(0) → -3` drags the range down, compressing real bars into the top of the axis. Accepted — the preset exists to show exactly this; a floor-aware `computeViewport` clamp is a separate decision if real bad ticks warrant it.
- Re-fetch on synthetic→real return is wasteful but harmless for a sandbox — accepted.
- Spec fixture `makeDataset` carries extra fields vs `FlexChartDataset` — mirrors the real store payload; accepted.

## Test results

`npx jest flex-chart --coverage=false` — **12 suites, 150 tests, all passing.**

Full suite: 1579/1580 pass; the 3 failing suites (`symbol-profiles.feature`, `swing-compare`, `option-chain-pct-change.store`) are in files untouched by this change — unrelated in-flight work on other topics.

## Verdict

**PASS** — after the fixes above.
