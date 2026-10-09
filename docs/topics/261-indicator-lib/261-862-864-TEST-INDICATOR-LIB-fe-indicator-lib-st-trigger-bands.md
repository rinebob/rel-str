# Test Plan — ST Trigger Bands (FE)

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Implement ST Trigger Bands in ST Indicator Library  
**Thread Slug:** st-trigger-bands  
**Issue:** #864  
**Thread Parent:** #862  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Test Plan  
**Area:** FE  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-08  

## Unit tests

Jest 30 + jest-preset-angular; prefer `jest.fn()` and `expect.*`; write `async` tests rather than `fakeAsync` for native-async paths (see `AGENTS.md`).

### Indicator definition: `st-trigger-bands.indicator.spec.ts`

Prior art: `st-std-dev-lines.indicator.spec.ts`.

- Option id, type (`StIndicator.ST_TRIGGER_BANDS`), `defaultPane === 'overlay'`, `axisScale === 'price'`, no params.
- Registered in the indicator registry; not in `DEFAULT_ST_INDICATORS`.

### Converters: `indicator-converters.spec.ts` (extend)

- A sample callable response with `indicators.triggerBands` produces band chart data aligned to bar indexes; points with `null` bands are skipped.
- Colour runs: neutral / pullback / breakout states split each band into the expected contiguous runs; the upper band uses the long-side flags and the lower band the short-side flags.
- `injectCallableIndicatorData` sets the data on the `ST_TRIGGER_BANDS` config and leaves other configs untouched.
- A response without `triggerBands` (older or default response) yields an empty series and no error.
- The staleness warning covers `triggerBands` when its last point is not the last bar.

### Dots: `signal-marker-converters.spec.ts` (extend)

- `dotMarkers.triggerBands` maps to scatter points with correct `x`, `y`, `index`.
- Dot colours follow the Pine vocabulary — long breakout blue, short breakout yellow, long pullback yellow, short pullback blue (two hues; position carries the side).
- Missing `dotMarkers.triggerBands` returns `[]`.

### Request wiring

- With the indicator enabled, the indicator-series request includes `IndicatorFamily.TRIGGER_BANDS`; with it disabled, the request is unchanged from today.
- Enabling the indicator does not drop the cached default response (store keying test, per the task's finding).

### Component wiring

- Quick-charts and signal-detail configs include the bands and dots configs when the indicator is selected, and neither when it is not. Prior art: `gallery-card-chart.component.spec.ts` asserts on `cfg.indicators.some(i => i.type === ...)`.

## E2E / UI verification (manual)

- Dev server (`npm start`, `dev/flex-chart` sandbox): enable Trigger Bands on a daily chart. The bands render as step lines in the Pine palette (white neutral; yellow/blue state colours); colours change on pullback and breakout bars; dots appear on breakout bars and on every bar the pullback state is armed, stopping when the breakout fires.
- Weekly chart: same, from the weekly series.
- Disable the indicator: bands and dots disappear and the request no longer includes the family.
- Compare a symbol/period against the TradingView script: bands and pullback/breakout bars coincide.
- Toggle between D and W repeatedly: no stale data, no console errors.

## Edge Cases

- Response arrives before bars: no render, no error.
- Fewer than 3 bars: empty bands.
- Pullback dots appear on every armed-state bar and stop when the breakout fires; a pullback and a breakout dot never share a bar on the same side.
- Older deployed backend returns no `triggerBands`: indicator renders nothing and logs no errors.
