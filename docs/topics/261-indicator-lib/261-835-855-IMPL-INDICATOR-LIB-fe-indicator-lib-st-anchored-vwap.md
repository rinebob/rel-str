**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** st-anchored-vwap  
**Issue:** #855  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Implementation Plan  
**Area:** FE  
**Status:** Draft  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# FE Implementation Plan: ST Anchored VWAP

## Overview

All computation is FE-side and pure. The indicator runs the existing ZigZag pivot walk at two retracement scales, turns the resulting anchor events into Anchored VWAP line segments that start on each anchor's **confirmation bar** (accumulating from the **pivot bar**), applies the History Window, and renders four lines (high/low × small/large scale) plus faded history in the flex-chart overlay pane.

Governing PRD: `261-835-836-PRD-INDICATOR-LIB-indicator-lib-st-anchored-vwap.md` (Approved). Nothing is drawn before a line's confirmation bar and nothing is back-attached to the pivot bar, so the output at bar `t` depends only on bars `0..t`.

## Modules

### 1. Engine seam — anchor events (`st-zigzag.pivots.ts`, `st-zigzag.types.ts`)

**Location:** `src/app/features/shared/components/flex-chart/indicators/`

`computeZigZagPivots` returns only *surviving* pivots: `processPivot` overwrites the last pivot in place when a more extreme same-side candidate arrives (`pivots[pivots.length - 1] = candidate`), so replaced anchors are lost, and `Pivot` has `barIndex` but no confirmation bar. Anchored VWAP needs both, because a replaced anchor was the live anchor until its replacement confirmed and its line must be drawn.

- Refactor the loop body of `computeZigZagPivots` into one internal walk, `walkPivots(bars, config, onAnchor?)`. `computeZigZagPivots` becomes a thin wrapper over it with **byte-identical output** (pivots array, projection) — it keeps overwriting, because ZigZag's own display wants survivors only.
- Add `computeZigZagAnchorEvents(bars, config): AnchorEvent[]`, a second wrapper over the same walk that collects every successful `processPivot` (new pivot *or* same-side replacement), in walk order.
- New type in `st-zigzag.types.ts`:

```ts
interface AnchorEvent {
  confirmBar: number;  // bar index on which the pivot became knowable = pivotBar + rightDepth
  pivotBar: number;    // Pivot.barIndex
  time: number;        // ms of the pivot bar
  price: number;       // pivot price
  isHigh: boolean;
  replaced: boolean;   // true when it overwrote the previous same-direction last pivot
}
```

- `replaced` = `processPivot` returned true and `pivots.length` did not grow (and it was not the first pivot).
- `confirmBar = i + rightDepth` where `i` is the candidate bar and `rightDepth` is the config value clamped to ≥ 2, as the walk already does. The walk's `if (i + rightDepth >= bars.length) break;` guarantees `confirmBar < bars.length`.
- Candidates rejected by `processPivot` (below the deviation threshold, or not more extreme) emit nothing. `allowZigZagOnOneBar` can yield a high and a low event with the same `confirmBar`; both are kept.
- Re-export both from the `st-zigzag.engine.ts` barrel. Call with `projectionPivots: false` — projected pivots must never anchor.
- Per-side anchor sequence for a line = events filtered by `isHigh`, in order. A high line changes on every high event (new high or replacement); a low line likewise.

**Prior art / regression:** `st-zigzag.pivots.spec.ts`, `st-zigzag.engine.spec.ts`, `st-zigzag.indicator.spec.ts`. The existing suites must pass unmodified.

### 2. Pure computation — `st-anchored-vwap.engine.ts`

**Location:** same `indicators/` directory. No Angular, no chart imports.

**Input:** `PriceBar[]` and config `{ smallRetracementPct, largeRetracementPct, leftDepth, rightDepth, historyStart?: number /* ms */, maxHistory }`.

**Algorithm**

1. Build cumulative arrays once: `cumPV[i] += typical(i) * vol(i)`, `cumV[i] += vol(i)`, with `typical = (high + low + close) / 3` and `vol = bar.volume ?? 0` (missing/zero contributes nothing).
2. For each scale, `events = computeZigZagAnchorEvents(bars, { devThreshold: pct, leftDepth, rightDepth, allowZigZagOnOneBar: true, projectionPivots: false, ... })`.
3. For each side, anchors `a_0..a_n` are that side's events in order. Segment `k` has `pivotBar = a_k.pivotBar`, `startBar = a_k.confirmBar`, and `endBar = a_{k+1}.confirmBar` (terminated) or the last bar index (active).
4. VWAP at bar `j` for anchor `a`: `(cumPV[j] - cumPV[a-1]) / (cumV[j] - cumV[a-1])`, with `cumX[-1] = 0`. The first drawn value (at `startBar`) is therefore the VWAP of pivot bar through confirmation bar — **accumulation starts at the pivot bar; drawing starts at the confirmation bar.**
5. Flat-carry: where `cumV[j] - cumV[a-1] == 0` (no volume since the pivot), use the previous drawn value; before the first drawn value, seed with the pivot bar's typical price.
6. The segment with no successor is **active**; all others are **terminated**. Adjacent segments of one slot share exactly one bar (`endBar_k == startBar_{k+1}`) and are otherwise disjoint.

**History Window** (terminated segments only; active segments are never windowed or pruned). Applied per scale across both sides combined, per the PRD wording "per scale":

- `historyStart` set → keep terminated segments whose pivot bar time ≥ `historyStart`, ordered by `startBar`, then keep the **first** `maxHistory` (the cap eats the recent end).
- `historyStart` unset → keep the **last** `maxHistory` terminated segments by `startBar` (oldest pruned first).

**Output:**

```ts
interface AnchoredVwapSegment {
  key: string;                      // stable: `${scale}-${side}-${pivotBar}-${startBar}`
  scale: 'small' | 'large';
  side: 'high' | 'low';
  pivotBar: number;
  startBar: number;
  endBar: number;
  active: boolean;
  points: { index: number; y: number }[];   // startBar..endBar inclusive
}
function computeAnchoredVwap(bars, config): AnchoredVwapSegment[]
```

**Complexity:** O(n) for the cumulative sums plus O(total points); segments within a slot are disjoint apart from the shared handoff bar, so total points ≈ 4n at most (fewer after windowing). This is a one-shot batch computation — unlike the Pine prototype, there is no per-bar rebuild.

### 3. Indicator definition + series builder — `st-anchored-vwap.indicator.ts`

**Location:** same `indicators/` directory. Follows the ZigZag / StdDevLines pattern.

- `ST_ANCHORED_VWAP_INDICATOR: IndicatorOption` — `id: 'st-anchored-vwap'`, `type: StIndicator.ST_ANCHORED_VWAP` (new enum member in `flex-chart.types.ts`), `defaultPane: 'overlay'`, `axisScale: 'price'`.
- Params (all `number | string | boolean`, as `IndicatorParamDef` requires): `smallRetracementPct` 2.0, `largeRetracementPct` 5.0, `leftDepth` 5, `rightDepth` 5, `smallHighColor` `#FF8CFF`, `smallLowColor` `#8CF5FF`, `largeHighColor` `#FF00E6`, `largeLowColor` `#00E5FF`, `historyStart` `''` (ISO `YYYY-MM-DD` string; empty or invalid = unset), `maxHistory` 100.
- `extractConfig(params)` clamps and parses params the way `st-zigzag.indicator.ts` does, including the `historyStart` string → ms conversion.
- `computeAnchoredVwapSeries(bars, params, options?)` maps `AnchoredVwapSegment[]` to **fixed-slot series** (below).

**Fixed slots (rendering shape).** A Syncfusion chart reinitialises when its series structure changes, so the series count must not depend on the data. There are always 12 series: 4 slots (scale × side), each with one **active** series and two **history** series that segments alternate between (`k` even → `history-a`, odd → `history-b`). Alternation is required because adjacent segments share the confirmation bar and one series holds only one `y` per bar. Within a history series, consecutive segments are separated by an explicit break point (`y: null`) with `emptyPointSettings: { mode: 'Gap' }` (pattern already used by the trend-band candle series in `flex-chart.component.html`).

```ts
interface AnchoredVwapLineSeries {
  key: string;        // `${scale}-${side}-active` | `-history-a` | `-history-b`
  name: string;       // `AVWAP-H {pct}%` / `AVWAP-L {pct}%`
  color: string;
  width: number;      // large thick, small thin
  opacity: number;    // active 1, history faded
  data: { index: number; y: number | null }[];
}
```

- Visual encoding per the PRD: hue = side (magenta high / cyan low), saturation and width = scale; history uses the same hue and width at reduced opacity.
- `calculateAnchoredVwap: IndicatorCalculator` — registered for the generic calculator map for consistency with ZigZag/StdDevLines, returning `[]`; rendering is entirely through the bespoke series, as the template already excludes ST_ZIGZAG / ST_STD_DEV_LINES from the generic line path. **T3 must verify `computeIndicators` and the legend tolerate an indicator whose calculator returns `[]`**; if not, return the large-scale active high line's points as the flat fallback.

### 4. Registry, adapter and template integration

- `flex-chart.types.ts`: add `ST_ANCHORED_VWAP = 'st-anchored-vwap'` to `StIndicator`.
- `indicator-registry.ts`: export and import the definition, append to `ST_INDICATOR_OPTIONS`, add to `indicatorCalculators` and `SERIES_TYPE_MAP` (`'line'`). This only adds an opt-in menu entry and a `BASE_CONFIGS` entry; `INDICATORS_BY_INTERVAL` in `base-indicators.ts` is **not** touched, so no existing chart auto-enables it. `BASE_CONFIGS` calls `buildDefaultConfig` for every registered option at module load, so the AVWAP defaults must be valid in isolation.
- `chart-data-adapter.service.ts`: add `anchoredVwapSeries = computed<AnchoredVwapLineSeries[]>(...)`, shaped like `zigZagSeries` — find `ST_ANCHORED_VWAP` configs in `cfg.indicators`, call `computeAnchoredVwapSeries(data.bars, params)`, then map each series through `this.themeColor` and `this.mapY` (skip `null` points when mapping). Keep the adapter a thin map-and-theme layer; all logic stays in the pure module.
- `flex-chart.component.ts` / `.html`: expose `anchoredVwapSeries = this.dataAdapter.anchoredVwapSeries` and add one `@for` of `Line` series (`xName="index"`, `yName="y"`, `[emptyPointSettings]="{ mode: 'Gap' }"`, `[opacity]`, `[animation]="noAnimation"`), and add `StIndicator.ST_ANCHORED_VWAP` to the generic-line exclusion list on the main-pane indicators loop (currently excludes TREND_BANDS, ST_STD_DEV_LINES, ST_ZIGZAG).

### 5. Sandbox param controls

Today no ST indicator has a param-editing surface: the sandbox and the gallery build configs from `buildDefaultConfig` defaults only, and `IndicatorConfigDialogComponent` is number-only and referenced by nothing. Per the Plan decision, **controls are sandbox-only** (no new shared settings UI).

- In `flex-chart-sandbox.component.ts/.html`, when `st-anchored-vwap` is enabled, show controls for `smallRetracementPct`, `largeRetracementPct`, `leftDepth`, `rightDepth`, the four colors, `maxHistory`, and a `mat-datepicker` for `historyStart` (datepickers already exist in the app, e.g. `option-chain`, `trade-journal`, `triage-report`). Overrides merge onto the default config before it reaches the chart.
- Controls are local to the sandbox and do not carry to other pages — this is the iteration loop, not general UI.

## Phases

### Phase 1: Engine + computation (pure, no UI)

Foundation. Nothing here touches the chart.

- **T1** — ZigZag anchor-event walk: shared internal walk, `computeZigZagAnchorEvents`, `AnchorEvent` type; `computeZigZagPivots` output provably unchanged.
- **T2** — AVWAP pure computation: cumulative sums, line lifecycle from events, confirmation-bar start, replaced anchors, flat-carry, History Window (both modes), no-lookahead property test. Blocked by T1.

### Phase 2: Chart integration

- **T3** — Indicator definition + registry + `StIndicator` member + adapter series + template render. Demoable in the sandbox via the menu toggle with default params. Blocked by T2.
- **T4** — Sandbox param controls including the `historyStart` date picker. Blocked by T3.

## Cross-Area Dependencies

- Phase 2 depends on Phase 1 (the adapter consumes the pure module).
- SHARED (Pine refinement, T5) is blocked by T4: Pine is refined after the web build is complete, to match the finished behaviour. See the SHARED plan.
- No BE.

## Risks

- **Engine regression.** Touching `st-zigzag.pivots.ts` risks ZigZag's own output and the swing-analysis page. Mitigation: refactor to a shared walk with a thin unchanged wrapper; the existing ZigZag specs must pass unmodified; add an explicit equality regression test against the pre-refactor behaviour on varied bar sets.
- **Lookahead.** Any read past bar `t` silently reintroduces the hindsight lines the PRD removed. Mitigation: the no-lookahead property test (output at `t` from `bars[0..t]` equals output at `t` from the full series) is a gate on T2.
- **`maxHistory` scope is ambiguous.** The PRD says "per scale"; the Pine prototype capped per line (side), which would exceed TradingView's polyline budget (4 lines × 48). This plan implements per scale, both sides combined, as the PRD reads. Confirm at T2 if the intent was per slot.
- **Series reinit.** A data-dependent series count would reinitialise the chart. Mitigation: fixed 12 slots.
- **Calculator contract.** The generic `IndicatorCalculator` path returns flat `{x, y}` points and cannot express four lines. Mitigation: bespoke adapter series (same as ZigZag); T3 verifies `computeIndicators`/legend tolerate an empty calculator result.
- **Date entry.** `IndicatorParamDef` has no date type, so `historyStart` is an ISO string param; invalid text is treated as unset. The sandbox date picker writes the string.
- **Pivot-bar edge.** A pivot with zero volume since the anchor needs the seed rule (pivot bar typical price) so the first drawn value is defined.
