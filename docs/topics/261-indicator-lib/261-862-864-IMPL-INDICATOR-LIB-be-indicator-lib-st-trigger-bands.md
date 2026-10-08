# Implementation Plan — ST Trigger Bands (BE)

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Implement ST Trigger Bands in ST Indicator Library  
**Thread Slug:** st-trigger-bands  
**Issue:** #864  
**Thread Parent:** #862  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Implementation Plan  
**Area:** BE  
**Status:** Draft  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

## Overview

Port the Trigger Bands indicator (PRD #863) to the backend indicator library and return it through the existing indicator-series callable. Indicator only: no strategy, signal types, worker or storage changes.

The callable contract already reserves the slot: `IndicatorFamily.TRIGGER_BANDS`, `IntervalData.indicators.triggerBands` and an empty `TriggerBandsPoint` (`functions/src/st-cloud-function/indicator-computation.ts`, mirrored by hand in `src/app/features/savant-trader/common/indicator.types.ts`). The migration plan (`docs/planning/rh-agent/RH-AGENT-INDICATOR-SERIES-MIGRATION-PLAN.md`, Phase 2) specifies the same approach.

## Modules

### 1. Pure computation: `functions/src/indicators/st-trigger-bands.ts`

Follows the sibling indicators (`st-trend-bands.ts`, `std-dev-lines.ts`): pure, no Firebase imports, takes `OHLCV[]` (`../indicators/st-trend-bands` type).

```ts
export interface StTriggerBandsResult {
  upper: (number | null)[];
  lower: (number | null)[];
  longPullback: boolean[];
  longPullbackState: boolean[];
  longBreakout: boolean[];
  shortPullback: boolean[];
  shortPullbackState: boolean[];
  shortBreakout: boolean[];
}
export const ST_TRIGGER_BANDS_LENGTH = 3;
export function computeStTriggerBands(bars: OHLCV[]): StTriggerBandsResult;
```

Semantics (must match the Pine source exactly; see PRD Definitions):

- `bodyHigh = max(open, close)`, `bodyLow = min(open, close)`.
- `upper[t] = max(bodyHigh[t-2..t])`, `lower[t] = min(bodyLow[t-2..t])`; `null` for `t < 2`.
- Any comparison involving a `null` band is `false` (Pine `na` comparisons are false).
- `longPullback[t] = upper[t] <= upper[t-1]`.
- `longBreakout[t] = upper[t-2] >= upper[t-1] && crossover && longPullbackState[t-1]`, where `crossover = bodyHigh[t] > upper[t-1] && bodyHigh[t-1] <= upper[t-2]`. Note that Pine's `ta.crossover(bodyHigh, upper[1])` compares the previous bar against `upper[2]`, not `upper[1]`.
- `longPullbackState[t] = longPullback[t] ? true : longBreakout[t] ? false : longPullbackState[t-1]`; starts `false`. Pullback wins over breakout when both are true on the same bar, exactly as the Pine ternary orders them.
- Short side mirrors on `lower` / `bodyLow` with `<=`/`>=` swapped and `crossunder`.

A single forward pass; O(n). Warm-up bars (`t < 2`) emit `false` flags.

### 2. Contract: `TriggerBandsPoint`

Fill in the stub in both type files (kept manually in sync, as today):

```ts
export interface TriggerBandsPoint {
  d: string;
  upper: number | null;
  lower: number | null;
  longPullback: boolean;
  longPullbackState: boolean;
  longBreakout: boolean;
  shortPullback: boolean;
  shortPullbackState: boolean;
  shortBreakout: boolean;
}
```

Extend `DotMarker.version` with `'TB'` in both type files (additive).

### 3. Pipeline wiring: `indicator-computation.ts`

- Compute trigger bands per interval (daily, weekly, monthly) from `barsToOhlcv(bars)`. Do this independently of `computeIndicatorInterval`, which returns an all-null series for fewer than 30 bars and carries the deprecated `IndicatorDataPoint` shape; trigger bands only need 3 bars and should not be gated by that.
- `computeSymbolIndicatorSeries` adds `indicators.triggerBands` to each interval.
- Dot markers: `generateTriggerBandsDotMarkers(points, bars)` returns `DotMarker[]` with `version: 'TB'`:
  - breakout dots: `signalType` `TRIGGER_BANDS_LONG_BREAKOUT` / `TRIGGER_BANDS_SHORT_BREAKOUT`;
  - pullback dots: `TRIGGER_BANDS_LONG_PULLBACK` / `TRIGGER_BANDS_SHORT_PULLBACK`, on every bar where `longPullback` / `shortPullback` is true.
  - `y` placement follows `generateZoneDotMarkers` (long below the bar low, short above the bar high, by the ATR-based offset). Implemented with a single 1.5x ATR offset (closer than the zone dots' 2.5x so the two do not overlap): a pullback and a breakout on the same side never share a bar, so they never need distinct offsets. Stored under `dotMarkers.triggerBands`. Implemented in #877.
  - `filterResponse` and the default interval/indicator/strategy sets moved from `indicator-series.ts` to a pure `indicator-series-filter.ts` (no Firebase imports) so the filtering rules are unit testable; behavior for existing families is unchanged.
  - Measured on AAPL (1,823 daily bars): opting in adds ~33% to the full response (2.7 MB to 3.6 MB across D/W/M), and 2,958 daily dots. The FE should request only the intervals it renders (the `intervals` filter already exists).
- `SignalIntervalData` / `IntervalData` `dotMarkers` types gain `triggerBands?: DotMarker[]`. `signals.triggerBands` stays unpopulated.

### 4. Callable filtering: `indicator-series.ts`

- `filterResponse` already passes `indicators.triggerBands` through when `IndicatorFamily.TRIGGER_BANDS` is requested. Extend the dot-marker block so `dotMarkers.triggerBands` is returned when the **indicator** family `TRIGGER_BANDS` is requested (it is gated on indicators, not strategies, because there is no strategy).
- `DEFAULT_INDICATORS` is unchanged (opt-in): the FE requests `TRIGGER_BANDS` explicitly. Because a response is computed in full and then filtered, the cost of an opt-in indicator is only serialisation.

### 5. Pine cleanup (SHARED work, tracked under this Blueprint)

`rb-st-trigger-bands.pine` currently sits outside the repo at `C:\aa\projects\rb-ps\rb-ta\ind\`. Move it into `rb-ps/rb-ta/ind/` and clean it: remove midpoint, retrace logic, wick variants, `horzOffset`/`vertOffset`, the unused `rbLib` import, constant-value markers and logging; decide v5 vs v6 (sibling scripts are v6); keep band colouring and plot pullback/breakout markers at the bar. Verify on TradingView against the web chart, after the BE engine task lands.

## Risks

- **Crossover subtlety.** The previous-bar term of the crossover compares against `upper[t-2]`. Found while implementing #876: given the `upper[t-2] >= upper[t-1]` gate, that term is always true (the current bar is inside its own window, so `bodyHigh[t-1] <= upper[t-1] <= upper[t-2]`), and a pullback and a breakout can never share a bar (a breakout needs `upper[t] > upper[t-1]`). The engine still implements the Pine expression literally; tests cover the reachable cases plus a mirror-symmetry check.
- **Hand-synced types.** `TriggerBandsPoint` and `DotMarker` exist in two files with no compiler link; both must change in one task.
- **Dot density.** Pullback dots on every pullback bar can be dense (PRD accepts this).
- **Forming bar.** The last (live) bar's flags can change until close; documented, not mitigated.
- **Opt-in request path.** Confirm in the FE task how `IndicatorSeriesStore` keys cache entries by filters so requesting `TRIGGER_BANDS` does not invalidate the cached default response.

## Cross-Area Boundaries

- FE depends on the BE contract and callable change being deployed before bands render. Deploying BE first is safe: older FE ignores the extra data.
