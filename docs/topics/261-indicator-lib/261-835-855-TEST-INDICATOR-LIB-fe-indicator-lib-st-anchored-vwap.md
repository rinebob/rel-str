**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** st-anchored-vwap  
**Issue:** #855  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Test Plan  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# FE Test Plan: ST Anchored VWAP

## E2E User Journeys

- Journey 1: User opens the flex-chart sandbox, enables **ST Anchored VWAP** from the indicator menu with default params → sees four lines (magenta high / cyan low, thick large / thin small) on the price pane, each starting where its pivot became knowable, plus history segments in the same style.
- Journey 2: User toggles AVWAP on a chart that has no ST ZigZag enabled → lines still render (AVWAP does not depend on the ZigZag indicator).
- Journey 3: User changes the retracement percentages and depths in the sandbox controls → the lines and anchors recompute; the series count does not change.
- Journey 4: (dropped 2026-10-08 — no `historyStart` date picker; the ZigZag pivots decide the dates and history is always the most recent `maxHistory`.)
- Journey 5: User scrubs through a chart with a known pivot and checks that no line exists before that pivot's confirmation bar and that the old same-side line runs through the new pivot's confirmation bar.

## Integration Tests

- Engine + AVWAP computation: `computeZigZagAnchorEvents` output feeds `computeAnchoredVwap` end to end on synthetic bar sets with known pivots.
- Indicator + registry: `ST_ANCHORED_VWAP` appears in `ST_INDICATOR_OPTIONS`, `buildDefaultConfig` yields valid defaults, and `BASE_CONFIGS` module load does not throw.
- Adapter + indicator: `anchoredVwapSeries` returns exactly 12 series for any data, themes colors and maps `y`, and returns `[]` when no AVWAP config is present.
- Adapter + template: the main-pane generic-line loop skips `ST_ANCHORED_VWAP` (no double render); the bespoke `@for` renders the 12 series with Gap handling.
- Sandbox + chart: control changes merge onto the default config and reach the adapter; enabling/disabling the indicator toggles the series.

## Unit Tests

### Engine seam (`st-zigzag.pivots.spec.ts` / `st-zigzag.engine.spec.ts`)

**Primary seam — pure calls with synthetic bar arrays.**

`computeZigZagAnchorEvents`:
- Alternating highs and lows → events in walk order with `isHigh` alternating and `replaced: false`.
- Same-direction extension (a higher high before any intervening confirmed low) → a `replaced: true` event for the overwriting pivot; the replaced pivot is present as an earlier event.
- `confirmBar === pivotBar + rightDepth` for every event; asymmetric `leftDepth ≠ rightDepth` changes the confirmation bar correctly.
- Every event's `confirmBar < bars.length`.
- Candidates below `devThreshold` or not more extreme emit nothing.
- `allowZigZagOnOneBar = true` with a high and a low on the same bar → two events sharing a `confirmBar`; `false` → only one.
- First pivot (no `lastPivot`) → one event, `replaced: false`.
- Insufficient bars, single bar, empty array → `[]`.
- `projectionPivots` has no effect on events (projected pivots never produce events).
- Depth clamp: `rightDepth` below 2 behaves as 2 for `confirmBar`.

**Regression (`computeZigZagPivots`):**
- Output (pivots and projection) is identical before and after the walk refactor across a set of varied synthetic bar arrays (uptrend, downtrend, choppy, equal highs, flat); the existing ZigZag, swings, stats and trigger specs pass unmodified.
- Surviving pivots equal the events with replaced anchors removed.

### Pure computation (`st-anchored-vwap.engine.spec.ts`)

`computeAnchoredVwap`:
- **Confirmation-bar start:** every segment's first point is at its anchor's `confirmBar`; no segment has a point before it.
- **Pivot-bar accumulation:** the first drawn value equals `(cumPV[confirm] - cumPV[pivot-1]) / (cumV[confirm] - cumV[pivot-1])`; with unit volumes it is the mean typical price of pivot bar through confirmation bar.
- **Handoff:** the terminated segment's last point is at the next same-side anchor's `confirmBar`, which is also the new segment's first point; at most one active high and one active low segment per scale cover any bar other than the shared handoff bar.
- **Replaced anchors:** a replaced anchor's segment is drawn and ends at its replacement's confirmation bar; the replacement starts there.
- **Typical price:** `(H + L + C) / 3`; a single-bar anchor with volume gives that bar's typical price.
- **Volume edge cases:** missing volume and zero volume contribute nothing; the line carries flat across them; zero volume since the anchor seeds with the pivot bar's typical price.
- **Scales:** small and large run independently; a pivot that qualifies at the small percentage but not the large appears only in the small set.
- **Active vs terminated:** the last segment per side is active and ends at the last bar; earlier segments are terminated.
- **History Window — `historyStart` set:** only terminated segments with pivot time ≥ date; chronological; the first `maxHistory` kept; nothing before the date; the cap eats the recent end.
- **History Window — unset:** the last `maxHistory` terminated segments kept; the oldest dropped; recent never dropped.
- **Windowing scope:** active segments are never windowed or pruned in either mode; the cap applies per scale across both sides combined.
- **`maxHistory` boundaries:** 1; larger than available; zero available segments.
- **No-lookahead property (gate):** for every `t`, the output restricted to bars `≤ t` computed from `bars[0..t]` equals the same restriction of the output computed from the full series. Run over varied synthetic series (trends, chop, equal highs/lows, gaps, zero-volume stretches).
- **Determinism and keys:** segment keys are stable and unique; identical input gives identical output.

### Indicator + series builder (`st-anchored-vwap.indicator.spec.ts`)

- `extractConfig` clamps retracement %, depths and `maxHistory`; falls back to defaults on missing/garbage params.
- No `historyStart` param (dropped 2026-10-08).
- `computeAnchoredVwapSeries` always returns 12 series with the documented keys, regardless of data (including empty data).
- Adjacent segments of a slot land in alternating history series; no history series contains two points at the same `index`.
- Break points (`y: null`) separate segments within a history series.
- History series match the active series' colour and width (no fading); large scale wider than small; side → hue.
- Series names follow `AVWAP-H {pct}%` / `AVWAP-L {pct}%`.

### Registry (`indicator-registry.spec.ts` or equivalent)

- `ST_ANCHORED_VWAP` is in `ST_INDICATOR_OPTIONS` and `SERIES_TYPE_MAP` (no calculator; `computeIndicators` tolerates that); `INDICATORS_BY_INTERVAL` defaults do **not** include it.
- `buildDefaultConfig(ST_ANCHORED_VWAP_INDICATOR)` returns valid defaults.

### Adapter (`chart-data-adapter.service.spec.ts`)

- `anchoredVwapSeries` is `[]` with no AVWAP config and with empty bars.
- With an AVWAP config, returns 12 series with themed colors and mapped `y`; `null` break points are preserved.
- Multiple AVWAP configs (if present) do not collide on keys.

### Sandbox (`flex-chart-sandbox.component.spec.ts`)

- Control values merge onto the default config.

## Test Seams

- Highest seam: `computeAnchoredVwap(bars, config)` — bars + params → segments, with `computeZigZagAnchorEvents` as the lower seam beneath it.
- Lower seams: the `AnchorEvent` list (pure); `computeAnchoredVwapSeries` (segments → fixed slots).
- Adapter and template are verified with the existing flex-chart spec patterns; the Syncfusion render is verified visually in the sandbox (no new render-level test infrastructure).

## Existing Test Coverage

- `st-zigzag.pivots.spec.ts`, `st-zigzag.engine.spec.ts`, `st-zigzag.indicator.spec.ts`, `st-zigzag.swings` / `triggers` specs — cover pivot detection and must pass unmodified (the regression gate for the walk refactor).
- `chart-data-adapter.service.spec.ts` — covers `zigZagSeries` / `stdDevLineSeries`; the AVWAP adapter tests follow the same shape.
- `flex-chart-sandbox.component.spec.ts` — covers indicator toggling; extended for AVWAP controls.
- **Gaps this plan fills:** anchor events (confirmation bar, replaced anchors), anchored VWAP accumulation and lifecycle, the History Window in both modes, the no-lookahead guarantee, and the fixed-slot series contract.

## Edge Cases

- Empty bars, single bar, fewer bars than `leftDepth + rightDepth`.
- No pivots found (monotonic data) → no segments; the indicator renders nothing without error.
- Only one side has pivots.
- Bars with missing `volume`, all-zero volume, or volume only after the anchor.
- Pivot on the very last confirmable bar (active segment of length 1).
- `historyStart` after the last pivot → zero history, active lines still render.
- `historyStart` before the first pivot → equivalent to unset in era mode.
- `maxHistory` larger than the available history; `maxHistory = 1`.
- Equal highs / equal lows (strictness of the pivot test; no replacement on ties).
- High and low confirmed on the same bar (`allowZigZagOnOneBar`).
- Invalid `historyStart` text; non-numeric params; out-of-range depths.
- Very long series (performance: single pass, no per-bar rebuild).
