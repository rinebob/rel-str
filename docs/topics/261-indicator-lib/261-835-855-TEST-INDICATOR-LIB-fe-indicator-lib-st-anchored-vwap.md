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
**Last Updated:** 2026-11-12  

# FE Test Plan: ST Anchored VWAP

## E2E User Journeys

- Journey 1: User opens the flex-chart sandbox, enables **ST Anchored VWAP** from the indicator menu with default params → sees four lines (line 1: magenta high / yellow low, weight 3; line 2: green high / red low, weight 1) on the price pane, each starting on its vertex's trigger bar — the bar that first crossed the deviation threshold, the same bar the standalone ZigZag marks with a trigger dot — plus history segments in the same style, plus the ZigZag legs — a chain through the surviving pivots, dashed developing leg at the right edge.
- Journey 1b: User unchecks a set's `Legs` toggle in the `AVWAP…` settings dialog → that set's leg rendering (chain + developing) disappears; the VWAP lines and history remain.
- Journey 2: User toggles AVWAP on a chart that has no ST ZigZag enabled → lines still render (AVWAP does not depend on the ZigZag indicator).
- Journey 3: User changes the retracement percentages and depths in the settings dialog → the lines and anchors recompute; the series count does not change.
- Journey 4: User picks a `historyStart` date in the dialog's native date input → history shows the terminated segments anchored on/after that date (first `maxHistory` of them — the cap can window out the recent end); clearing it returns to the most-recent `maxHistory` view. (Reinstated 2026-10-08 under #872; moved into the settings dialog under #1459.)
- Journey 5: User scrubs through a chart with a known pivot and checks that no line exists before that pivot's trigger bar and that the old line runs through the new vertex's trigger bar before handing off.
- Journey 6: User enables a set's `Persist` toggle → every triggered vertex's line runs to the last bar (a VWAP fan), bounded by `maxHistory`; the newest stays the live line.

## Integration Tests

- Engine + AVWAP computation: `computeZigZagPivots` + `computeTriggerPoints` output feeds `computeAnchoredVwap` end to end on synthetic bar sets with known pivots.
- Indicator + registry: `ST_ANCHORED_VWAP` appears in `ST_INDICATOR_OPTIONS`, `buildDefaultConfig` yields valid defaults, and `BASE_CONFIGS` module load does not throw.
- Adapter + indicator: `anchoredVwapSeries` returns exactly 14 series for any data (8 VWAP — history + active per set-side — + 2 confirmed-chain + 2 developing-leg + 2 confirmation-marker Scatter), themes colors and maps `y`, and returns `[]` when no AVWAP config is present.
- Adapter + template: the main-pane generic-line loop skips `ST_ANCHORED_VWAP` (no double render); the bespoke `@for` renders the 14 series with Gap handling.
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
- **Trigger-bar start:** every segment's first point is on its anchor vertex's trigger bar (the bar that first crossed the deviation threshold — the same point `computeTriggerPoints` produces for the standalone ZigZag's dots); no segment has a point before it.
- **Pivot-bar accumulation:** the first drawn value equals the VWAP accumulated from the pivot bar through the trigger bar; with unit volumes it is the mean typical price of pivot bar through trigger bar.
- **Handoff:** a segment's last point is at the next triggered vertex's trigger bar, which is also the next segment's first point; exactly one active segment per set at any time.
- **One line per leg:** a vertex is a *surviving* pivot — a new same-side extreme replaces it before it can anchor; an untriggered final vertex anchors nothing and the previous line stays live.
- **Persist mode:** with `lineNPersist` set, every triggered vertex's line runs to the last bar; only the newest is `active` and the rest count toward `maxHistory`.
- **Trigger dots parity:** the per-set `confirmations` markers equal `computeTriggerPoints` on the same surviving pivots — bar-for-bar and level-for-level, including gap-through bars where the dot lands on the open.
- **Typical price:** `(H + L + C) / 3`; a single-bar anchor with volume gives that bar's typical price.
- **Volume edge cases:** missing volume and zero volume contribute nothing; the line carries flat across them; zero volume since the anchor seeds with the pivot bar's typical price.
- **Scales:** small and large run independently; a pivot that qualifies at the small percentage but not the large appears only in the small set.
- **Active vs terminated:** the last segment per side is active and ends at the last bar; earlier segments are terminated.
- **History Window — `historyStart` set:** only terminated segments whose pivot's session date (`bars[pivotBar].date`, not `x`) ≥ date; chronological; the first `maxHistory` kept; nothing before the date; the cap eats the recent end.
- **History Window — unset:** the last `maxHistory` terminated segments kept; the oldest dropped; recent never dropped.
- **Windowing scope:** active segments are never windowed or pruned in either mode; the cap applies per scale across both sides combined.
- **`maxHistory` boundaries:** 1; larger than available; zero available segments.
- **Bounded retroactivity (gate):** a vertex only exists once depth-confirmed, so its trigger (which can fire *before* confirmation) is attributed retroactively — a truncated run can legitimately omit a line the full run back-fills, and a line can outlive its truncated window's end. The invariant is on the overlapping range: where a line is drawn in both runs, the points agree, and every truncated line's vertex is a real full-run vertex. Run over varied synthetic series (trends, chop, equal highs/lows, gaps, zero-volume stretches).
- **Determinism and keys:** segment keys are stable and unique; identical input gives identical output.

### Indicator + series builder (`st-anchored-vwap.indicator.spec.ts`)

- `extractConfig` clamps retracement %, depths and `maxHistory`; falls back to defaults on missing/garbage params.
- `historyStart` param (ISO `'YYYY-MM-DD'` string): a boundary date keeps that date's anchor (inclusive, compared on `bar.date`); after the last anchor empties history while actives remain; before the first anchor ≡ unset; empty/garbage ≡ unset. Regression: a bar whose `x` carries a non-midnight timestamp must still filter on `date` alone.
- `computeAnchoredVwapSeries` always returns 14 series with the documented keys, regardless of data (including empty data).
- All terminated segments of a side pack into its single history series, `y:null`-separated (overlap-packed for persist); no history series contains two real points at the same `index`.
- Break points (`y: null`) separate segments within a history series.
- History series match the active series' colour and width (no fading); line 1 heaviest (weight 3), line 2 thin (weight 1); side → hue.
- Series names follow `AVWAP-1H {pct}%` / `AVWAP-1L {pct}%` / `AVWAP-2H {pct}%` / `AVWAP-2L {pct}%`.
- `showLineNZigZag` false → that set's two leg series carry no points (series still exist — count stays 14); VWAP series unaffected. `showLineNConfirms` gates that set's Scatter markers.

### ZigZag leg geometry (`st-anchored-vwap.engine.spec.ts`, added 2026-10-09)

- **Vertex = surviving pivot:** pivots superseded by a later same-side extreme are *not* leg vertices and anchor no VWAP segment — the walk overwrites them in place, so they never reach `computeTriggerPoints` (changed in #945 QA — the event-stream chain drew high→high / low→low legs). Invariants assert every vertex is a real anchor event, every active anchor is a vertex, and superseded anchors have no vertex.
- **Consecutive same-side events** (a superseded anchor) draw as a continuing leg — no gap, no reversal fabricated.
- **Legs connect consecutive events per set** in confirmation order; legs from set 1 never mix with set 2.
- **Developing leg:** absent with zero confirmed anchors; when present, runs from the last surviving vertex to the running extreme; its tip updates as new extremes print and never appears before the last confirmed vertex.
- **Confirmed-only:** no confirmed-chain vertex sits at a bar whose pivot never registered; the developing leg is the only geometry past the last anchor event.
- **Legs only rewrite forward:** survival isn't causal — an anchor superseded later disappears from the chain — so a truncated chain isn't a strict prefix of the full one. The invariant: every truncated vertex is a real anchor event of the full stream (surviving or later superseded); the developing tip remains causal (`≤ t`).

### Registry (`indicator-registry.spec.ts` or equivalent)

- `ST_ANCHORED_VWAP` is in `ST_INDICATOR_OPTIONS` and `SERIES_TYPE_MAP` (no calculator; `computeIndicators` tolerates that); `INDICATORS_BY_INTERVAL` defaults do **not** include it.
- `buildDefaultConfig(ST_ANCHORED_VWAP_INDICATOR)` returns valid defaults.

### Adapter (`chart-data-adapter.service.spec.ts`)

- `anchoredVwapSeries` is `[]` with no AVWAP config and with empty bars.
- With an AVWAP config, returns 14 series with themed colors and mapped `y`; `null` break points are preserved.
- Multiple AVWAP configs (if present) do not collide on keys.

### Sandbox (`flex-chart-sandbox.component.spec.ts`)

- The `AVWAP…` toolbar button is always present and opens the settings dialog via `DsDialogService` — once per click while open; a control exists per editable param (`avwap-*` test ids).
- Control values merge onto the default config; emptied controls revert to the default; each change produces a fresh config (recompute); edits apply live while the dialog is open.
- `historyStart`: the dialog's native `type="date"` input commits a `YYYY-MM-DD` string, the clear button unsets it.
- `Legs` / `Confirms` / `Upper` / `Lower` / `Persist` per-set toggles default as declared; state survives enable→disable→enable like other overrides.
- Overrides persist across enable→disable→enable and never leak into other indicators' configs.

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
- No pivots found (monotonic data) → no segments and no legs; the indicator renders nothing without error.
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
