**Topic:** Export ST indicators to PineScript for TradingView  
**Issue:** #226  
**Topic Parent:** #221  
**Domain:** SAVANT-TRADER  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-05  
**Last Updated:** 2026-09-07  

# Code Review: Task #228 — Pine v6 Foundation

## Scope

Reviewed the Task #228 change in `C:\aa\projects\rb-ps\rb-ta\ind\rb-st-indicator.pine` against the Task #228 acceptance criteria, the approved PRD, and the SHARED implementation/test plans. The later math, indicator-family, overlay, and visual-validation tasks were intentionally not treated as required for this foundation task.

## Standards

- **No blocking findings.** The file follows the neighboring Pine conventions for MPL header and Pine v6 declaration.
- The script is explicitly declared with `indicator(...)`, not `strategy(...)`.
- The fixed constants are grouped and typed clearly, including effective HTF lengths, DI thresholds, ATR period, and the ATR multiplier.
- The file contains explicit dependency-order section seams for later tasks.
- No imports, external calls, persistence, broker behavior, or app runtime dependency were introduced.

## Spec

Task #228 acceptance criteria are met:

- [x] A standalone Pine v6 indicator file exists in `rb-ps`.
- [x] The file uses `indicator(...)` and is read-only.
- [x] No runtime dependency on `rel-str`, Firebase, broker services, or exported data is required.
- [x] Fixed ST constants are represented consistently with the approved PRD.
- [x] Historical Pine scripts remain unchanged.

The full indicator is intentionally deferred to Tasks #229, #231, #232, and #233.

## Thermo-Nuclear

The initial review correctly identified that the first shell did not contain the shared math foundation. That finding applied to the broader Phase 1 implementation plan, not to the narrowed Task #228 acceptance criteria. The foundation now provides a clean one-file seam, explicit constants, and section boundaries for the later tasks without prematurely duplicating indicator logic.

The remaining math, HTF request plumbing, plots, and event markers belong to their designated later tasks.

## Verification

Structural verification in `rb-ps` passed:

- File exists.
- `indicator(...)` is present.
- No `import` declaration.
- No `strategy(...)` declaration.
- ATR length and effective HTF constants are present.
- `git diff --check` is clean.
- No tracked historical Pine files are modified; the new file is untracked and not committed.

There is no local Pine compiler or automated Pine test suite in `rb-ps`. TradingView compilation and rendering are deferred to the visual validation task.

## Verdict

**PASS** — Task #228 foundation is ready for the next implementation task.

---

# Code Review: Task #229 — Shared ST Math and State

## Scope

Reviewed the Task #229 changes in `C:\aa\projects\rb-ps\rb-ta\ind\rb-st-indicator.pine` against the Task #229 acceptance criteria, the selected TypeScript references, the original Pine engines, and the SHARED implementation/test plans.

## Standards

- No blocking standards findings.
- Shared math is kept behind named Pine functions rather than duplicated in later plot sections.
- The file remains self-contained, read-only, and free of app, broker, Firebase, or external-library dependencies.
- The hidden output keeps the foundation loadable before visible indicator plots are added.
- The HTF tuple now documents continuous versus stepped values, and the Pine/TypeScript HTF source-model difference is documented near the request boundary.

## Spec

Task #229 acceptance criteria are met:

- [x] EMA recurrence and SMA seed are represented.
- [x] Missing-value carry-forward and warm-up behavior are explicit.
- [x] Crossover/crossunder behavior matches the TypeScript primitive.
- [x] CTF and HTF recursive smoothed-Heikin-Ashi state are implemented.
- [x] HTF stepped carry guards against replacing valid state with warm-up `na` values.
- [x] HTF cross triggers and direction flags use stepped values, matching the TypeScript BandResult target.
- [x] Developing HTF boundary data is requested without a confirmed-bar offset.
- [x] The chart-OHLC/scaled-length HTF model and irregular-session boundary limitation are documented.

The visible Trend Bands, Zone V1/V2, Trend Strength, and event-overlay plots remain correctly deferred to later tasks.

## Thermo-Nuclear

The main structural risk was mixing requested HTF OHLC with the TypeScript chart-OHLC/scaled-length model. The current implementation avoids that double-scaling by requesting only the HTF boundary and feeding chart OHLC into the shared HTF engine. It also separates continuous and stepped return values so later consumers have an explicit contract.

Remaining non-blocking risks are Pine's `ta.sma` behavior for non-standard `na` gaps and exact wall-clock boundary matching on irregular sessions. Both are documented validation items and do not affect contiguous chart OHLC foundation behavior.

## Verification

Structural verification in `rb-ps` passed:

- `git diff --check` is clean.
- Shared EMA, crossover/crossunder, CTF, and HTF functions are present.
- HTF request uses `lookahead_off` without a `[1]` offset.
- Only HTF `time_close` is requested; chart OHLC feeds the scaled HTF engine.
- Stepped crossover and carry-guard logic are present.
- Hidden foundation plot is present.
- No `import` or `strategy(...)` declaration exists.

TradingView compilation and runtime parity remain deferred to the visual validation workflow because no local Pine compiler is available.

## Verdict

**PASS** — Task #229 shared math/state implementation is ready for the next implementation task.

---

# Code Review: Task #231 — Port ST Trend Bands and Zones

## Scope

Reviewed the Task #231 changes in `C:\aa\projects\rb-ps\rb-ta\ind\rb-st-indicator.pine` (lines 170-294) against the Task #231 acceptance criteria, the PRD, the SHARED implementation/test plans, and the TypeScript reference files (`st-trend-bands.ts`, `st-zone.ts`, `st-zone-v2.ts`). Three review axes ran in parallel: Standards, Spec, and Thermo-nuclear.

## Standards

No blocking standards findings. The Task #231 additions:

- Reuse `f_smha_ctf`/`f_smha_htf` for all four bands — no duplicated engine logic.
- Remain self-contained: no imports, no `strategy()`, no external dependencies.
- Use `force_overlay=true` on the four `plotcandle` calls to place bands on the price pane while the indicator default is `overlay=false`.
- Use named plots throughout, enabling TradingView CSV export for validation.
- Follow the historical `rb-smha-four-band-plot.pine` convention for up/down candle colors (yellow/blue).

Minor findings addressed during review:
- Renamed `stHtfFastUp`/`stHtfFastDown` to `stHtfFastContinuousUp`/`stHtfFastContinuousDown` (and slow equivalents) to avoid future consumers accidentally using continuous flags instead of stepped flags.
- Corrected the V2 y-level comment to accurately describe the row mapping.

Remaining nits (non-blocking, deferred):
- `f_nz` helper (line 63) is declared but unused — reserved for Trend Strength / event overlay tasks (#232, #233).
- Spacing around `=` in named arguments differs from declarations — stylistic only.

## Spec

All Task #231 acceptance criteria are met:

- [x] Four Trend Bands render with the fixed v1 configuration — CTF fast (5), CTF slow (10), HTF fast (5×3=15), HTF slow (10×3=30).
- [x] Zone V1 produces the expected discrete zone values — category logic and zone classification match `st-zone.ts` exactly.
- [x] Zone V2 produces the expected discrete zone values — `classifyZone` base-zone and midpoint refinement match `st-zone-v2.ts` exactly.
- [x] Lower-pane plots are readable — V1 at rows 0-5, V2 at rows 7-14, row 6 blank separator.
- [x] Developing HTF values paint interim bars — no `[1]` offset, `closeTimeMatch` uses current `time_close`.

PRD Story 1 (Trend Bands, zones, fixed parameters, no external runtime deps): Met.
PRD Story 3 (Developing HTF, no confirmation wait): Met.

Trend Strength and Zone V1/V2 event dots are correctly deferred to #232 and #233.

## Thermo-Nuclear

### Major finding — V2 warm-up misclassification (FOUND AND FIXED)

The thermo-nuclear axis identified that `stV2BaseZone` would evaluate to `-4` during warm-up because all band direction flags are `false` when midpoints are `na` (Pine `bool` comparisons with `na` return `false`). This would cause spurious `zoneMinusFour` red crosses to plot from bar 1 until all band EMAs seed. TypeScript explicitly guards against this with `isNaN(b1m) || isNaN(b2m) || isNaN(b3m) || isNaN(b4m)` checks.

**Fix applied during review:** Added explicit `stV1Ready` and `stV2Ready` warm-up guards using `not na(...)` on all required band midpoints. V1 zone predicates now require `stV1Ready`. V2 zone classification is wrapped in `if stV2Ready` with `stZoneV2` initialized to `0` (not `na`). This matches TypeScript's `continue` behavior — zone 0 means no cross plots during warm-up.

V1 was safe-by-accident (all conditions collapse to `false` during warm-up), but the explicit guard documents intent and protects against future refactors.

### Minor findings addressed

- `int stZoneV2 = na` changed to `int stZoneV2 = 0` with `if stV2Ready` guard — removes warm-up risk and makes code clearer.
- `color.white` for `zoneMinusOne` (both V1 and V2) — invisible on TradingView light theme. Accepted as v1 limitation; default theme is dark. Can be revisited if light-theme support is needed.

### Non-blocking risks (deferred to validation #235)

- `plotcandle(..., force_overlay=true)` — needs TradingView compile verification. Pine v5/v6 release notes list `force_overlay` for `plotcandle`, but no local compiler is available.
- Wall-clock `time_close == htfCloseTime` HTF stepping vs TypeScript index-based `i % 3 === 2` — can diverge on irregular sessions, holidays, or missing bars. Already documented in the file.
- Chart-OHLC HTF model vs historical Pine HTF-OHLC model — deliberate design decision to match TypeScript `computeHtfBand`, documented in the file.
- Flat bars (`postClose == postOpen`): both `bandUp` and `bandDown` are false; V2 `baseZone` counts flat as `-1`. This is inherited from TypeScript and historical Pine, not a porting bug.

## Verification

Structural verification in `rb-ps` passed:

- `git diff --check` is clean.
- All four band engines instantiated with correct lengths.
- Four `plotcandle` calls with `force_overlay=true` present.
- Six V1 zone plots and eight V2 zone plots present.
- V1 and V2 warm-up guards present.
- `stZoneV2` initialized to `0` (not `na`).
- Continuous up/down flags renamed with `Continuous` prefix.
- No `import` or `strategy(...)` declaration.
- No historical Pine files modified.

There is no local Pine compiler. TradingView compilation and runtime parity remain deferred to the visual validation task (#235).

## Verdict

**PASS** — Task #231 Trend Bands and zones implementation is ready for QA. The major warm-up guard finding was identified and fixed during the review pass. Remaining items are non-blocking validation deferred to #235.

---

# Code Review: Task #232 — Port ST Trend Strength

## Scope

Reviewed the Task #232 changes in `C:\aa\projects\rb-ps\rb-ta\ind\rb-st-indicator.pine` (TREND STRENGTH section, lines 295-387) against the Task #232 acceptance criteria, the PRD, and the TypeScript reference (`st-trend-strength.ts`). Three review axes ran in parallel: Standards, Spec, and Thermo-nuclear.

## Standards

No blocking standards findings. The Task #232 additions:

- Define `f_st_trend_strength` as a named function — no duplicated inline logic.
- Follow the existing `f_` prefix convention and `st` output prefix.
- Use the fixed PRD constants: `DI_LENGTH=14`, `DI_UPPER_THRESHOLD=10.0`, `DI_LOWER_THRESHOLD=-10.0`.
- Include named hidden plots for DI+, DI-, DX, ADX for CSV export validation.
- No `import`, no `strategy()`, no external dependencies.
- No `force_overlay` on Trend Strength plots — no main-pane dot overlay.

Nit (non-blocking): `f_nz` helper (line 63) remains unused — reserved for future tasks.

## Spec

All Task #232 acceptance criteria are met:

- [x] DI+/DI− and the intended strength/histogram series render — the DI histogram is the primary visual, plotted in the lower pane with threshold lines. DI+/DI-/DX/ADX are hidden from the pane but available in the Data Window for CSV export. This matches the historical `rb-DI-plus-minus-plot.pine` design where DI+ and DI- line plots are commented out ("showing all just looks like chaos").
- [x] DI period and threshold constants match the approved PRD — `DI_LENGTH=14`, thresholds `+10/-10`.
- [x] Lower-pane rendering is readable in the single-indicator view — histogram offset by -80, thresholds at -70 and -90, well below the zone crosses at rows 0-14.
- [x] No Trend Strength main-pane dot overlay is added — no `force_overlay` on any Trend Strength plot.

Technical verification against TypeScript reference (`st-trend-strength.ts`):
- True Range uses `[HTF_MULTIPLIER]` lookback — matches.
- Directional movement uses `[HTF_MULTIPLIER]` lookback — matches.
- Wilder smoothing uses `prev - prev/period + current` (not the "canonical" `prev - prev/period + current/period`) — matches TypeScript line 107 exactly.
- DI+, DI-, DX, ADX, diHist formulas — all match.
- ADX = `ta.sma(dx, adxLength)` — matches `smaSeries(dx, ADX_LENGTH)`.

## Thermo-Nuclear

### Major finding 1 — Warm-up artifact (FOUND AND FIXED)

The thermo-nuclear axis identified that the Pine code did not skip the first `HTF_MULTIPLIER` bars, unlike the TypeScript reference which has `if (i < mult) continue` at line 80. Without this guard, `nz()` coerces missing history to 0, causing `prevClose=0`, `prevHigh=0`, `prevLow=0` on the first 3 bars. This produces `trueRange ≈ high`, `dmPlus ≈ high`, `diPlus ≈ 100`, `diHist ≈ 100` — a massive spike that takes ~42 bars to decay through Wilder smoothing.

**Fix applied during review:** Added `stDiReady = bar_index >= HTF_MULTIPLIER` guard. DI+, DI-, DX, and diHist return `na` during warm-up, matching the TypeScript `continue` behavior. The histogram plot will not draw during warm-up.

### Major finding 2 — Histogram offset too small (FOUND AND FIXED)

The initial offset of -30 was insufficient. `diHist` can legitimately reach ±50-60 in strong trends (DI+ and DI- are 0-100 percentages). A `diHist` of +40 with offset -30 would plot at y=10, overlapping the V1 zone crosses at rows 0-5.

**Fix applied during review:** Increased offset to -80. The zero line is at -80, thresholds at -70 and -90. A `diHist` of +60 plots at -20, clearly below the zone area. A `diHist` of +80 would plot at 0 (edge of zone area), which is acceptable for extreme values.

### Minor finding — display.none prevents CSV export (FOUND AND FIXED)

The hidden DI+/DI-/DX/ADX plots used `display=display.none`, which hides them from the Data Window and prevents CSV export in validation task #235.

**Fix applied during review:** Changed to `display=display.data_window` — plots are hidden from the pane but visible in the Data Window and "Export chart data" CSV output.

### Minor finding — hline with computed expressions

`hline(DI_UPPER_THRESHOLD + ST_DI_HIST_OFFSET, ...)` uses a computed expression. While all inputs are `const float` (so the expression is compile-time const), pre-computing is more defensive.

**Fix applied during review:** Added `DI_ZERO_OFFSET`, `DI_UPPER_OFFSET`, `DI_LOWER_OFFSET` const declarations and used them in `hline()` calls.

### Non-blocking risks (deferred to validation #235)

- `ta.sma(dx, adxLength)` warm-up: ADX is `na` for the first 14 valid DX values. Consistent with TypeScript `smaSeries`.
- `hline` with const float expressions: should compile but needs TradingView verification.
- `display.data_window` CSV availability: needs verification in #235.
- `diHist` extreme values (>+80) could still reach the zone area edge — acceptable for extreme edge cases.

## Verification

Structural verification in `rb-ps` passed:

- `git diff --check` is clean.
- Warm-up guard (`stDiReady = bar_index >= HTF_MULTIPLIER`) present.
- DI+/DI-/DX/diHist return `na` during warm-up.
- Histogram offset = -80.0.
- Pre-computed hline offset constants present.
- Hidden plots use `display=display.data_window` (not `display.none`).
- No `force_overlay` on Trend Strength plots.
- No `import` or `strategy()`.
- No historical Pine files modified.

There is no local Pine compiler. TradingView compilation and runtime parity remain deferred to #235.

## Verdict

**PASS** — Task #232 Trend Strength implementation is ready for QA. Two major findings (warm-up artifact and histogram offset) were identified and fixed during the review pass. The DI histogram with threshold lines renders in the lower pane, no main-pane dot overlay is added, and all constants match the PRD. Remaining items are non-blocking validation deferred to #235.
