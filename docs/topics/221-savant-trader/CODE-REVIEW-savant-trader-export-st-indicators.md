**Topic:** Export ST indicators to PineScript for TradingView  
**Issue:** #226  
**Topic Parent:** #221  
**Domain:** SAVANT-TRADER  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-05  
**Last Updated:** 2026-09-05  

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
