**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1670  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-11-21  
**Last Updated:** 2026-11-21  

# Implementation Plan — FE: IBS gate in trend-rider dots + suppressed-marker toggle

## Architecture overview

`detectZoneUptickDots` (the client-side mirror of the BE state machine) applies the same `computeIbs` gate, and partitions its output into **emitted** vs **suppressed** dots. Emitted dots render exactly as today; suppressed dots flow through a parallel channel and render as hollow/dimmed markers — but only when the new `showSuppressedSignals` indicator param is on. The flex-chart sandbox exposes a UI toggle for that param via the existing param-override machinery.

## Boundary

Covers: the gate inside `detectZoneUptickDots`, the emitted/suppressed result partition, the `showSuppressedSignals` + `ibsThreshold` indicator params, suppressed-marker visuals, the extras-pipeline plumbing that carries suppressed dots to the chart, and the sandbox toggle.

Does **not** cover: `computeIbs` (SHARED), BE detection/persistence, Pine. Suppressed dots never leave the client — nothing is written anywhere.

## Files

```
src/app/features/shared/components/flex-chart/indicators/st-trend-rider-dots.indicator.ts  — modified: IBS gate; UptickDotResult { emitted, suppressed }; new indicator params
src/app/features/shared/components/flex-chart/indicators/st-trend-rider-dots.indicator.spec.ts — modified/new specs
src/app/features/savant-trader/utils/chart-indicators/extras-signals.ts                     — modified: thread suppressed sets + ibs params through the extras bundle
src/app/features/savant-trader/utils/chart-indicators/base-indicators.ts                    — modified: uptickDotsV{1,2}Suppressed extras fields; suppressed series builder; param gating
shared/flex-chart-indicator-visuals.ts                                                     — modified: ST_SUPPRESSED_DOT visual constants
src/app/features/savant-trader/pages/flex-chart-sandbox/flex-chart-sandbox.component.ts     — modified: showSuppressedSignals sandbox toggle
src/app/features/savant-trader/pages/flex-chart-sandbox/flex-chart-sandbox.component.html   — modified: toggle control
callers of detectZoneUptickDots (signal-detail, quick-charts, gallery-card-chart, position-card-chart) — signature-compat updates only
```

## Modules

### 1. `st-trend-rider-dots.indicator.ts` — gate + partition (modified)

- New result type (replaces bare `UptickDotPoint[]` return):
  ```typescript
  export interface UptickDotResult {
    emitted: UptickDotPoint[];     // rendered exactly as today
    suppressed: UptickDotPoint[];  // IBS-rejected candidates — same dot placement, distinct visuals
  }
  ```
- `detectZoneUptickDots` gains a trailing `ibs?: { threshold?: number; now?: Date }` param; at each dot-emission point compute `computeIbs({high, low, close, date: barDate}, 'D', { now })` and route the point to `emitted` or `suppressed`. (`detectZoneUptickDots` is daily-only today — the `'D'` timeframe literal is correct; if an intraday variant exists, thread the timeframe.)
- New `params` on both `ST_ZONE_V1_UPTICK_DOTS_INDICATOR` and `ST_ZONE_V2_UPTICK_DOTS_INDICATOR`:
  - `showSuppressedSignals` — bool, default `false`
  - `ibsThreshold` — num, default `0.5`, min `0`, max `1`, step `0.05`

### 2. `extras-signals.ts` — extras plumbing (modified)

The derived-signal bundle carries `uptickDotsV1`/`uptickDotsV2` today; extend with `uptickDotsV1Suppressed`/`uptickDotsV2Suppressed` populated from `UptickDotResult.suppressed`. Threshold + `showSuppressedSignals` read from the indicator config and passed into detection.

### 3. `base-indicators.ts` — suppressed series (modified)

- `ChartExtras` gains `uptickDotsV{1,2}Suppressed?: ChartScatterPoint[]`.
- `addUptickDots` (or a sibling `addSuppressedDots`) appends a second scatter series per dots indicator **only when** `showSuppressedSignals` is true — emitted series path untouched (zero rendering regression when off).

### 4. `shared/flex-chart-indicator-visuals.ts` — visuals (modified)

- `ST_SUPPRESSED_DOT` constants: hollow-circle marker (muted outline color, transparent/subdued fill) distinct from `ST_UPTICK_DOT_COLORS` solid dots — e.g., same hue family at reduced opacity so suppressed reads as "ghost" of the real signal.

### 5. `flex-chart-sandbox.component.{ts,html}` — toggle (modified)

- Surface `showSuppressedSignals` as a UI toggle using the existing mechanism: either the generic `paramOverrides` strip (if bool params already render) or a dedicated sandbox checkbox like the Trigger Bands dots debug toggle — pick whichever matches the closest existing pattern at impl.

## Contracts

- `detectZoneUptickDots` return-type change is the one breaking surface — all in-repo callers updated in this task (list in Files); no external consumers (function is FE-internal).
- Indicator params are additive — persisted indicator configs without the new keys resolve to defaults (`showSuppressedSignals: false`, `ibsThreshold: 0.5`) → **existing charts render identically**.

## Decisions

- Partition inside `detectZoneUptickDots` (not a second detection pass) — one state-machine walk; suppressed points carry identical placement math to emitted points.
- Suppressed as a parallel series, not a per-point flag on the emitted series — keeps the emitted series bit-identical for regression, and Syncfusion gets a clean per-series marker style.
- `ibsThreshold` as an indicator param (default 0.5), not a global — lets a chart evaluate stricter/looser thresholds independently of the BE config; documented as display-only (BE truth lives in `StrategyConfig`).
- FE `now` = wall clock, same as BE — a chart showing today's developing bar applies the same availability rule.

## Sequence / phases

1. `detectZoneUptickDots` gate + `UptickDotResult` + params + specs — core task.
2. Extras/base-indicators suppressed series + visuals + caller compat — same task or fast-follow.
3. Sandbox toggle — small follow-on task in the same Blueprint.

## Prior art / regression

- `st-trend-rider-dots.indicator.ts` existing detection specs — extend; emitted output must equal today's output when every bar's IBS passes.
- `ST_UPTICK_DOT_COLORS`/`ST_SIGNAL_DOT_*` in `flex-chart-indicator-visuals.ts` — the visual-constants home.
- AVWAP params (`avwapParams`/`paramOverrides`) and the Trigger Bands sandbox dots toggle — the two toggle mechanisms to imitate.
- Caller compat: grep showed `detectZoneUptickDots` consumed via `extras-signals.ts` by signal-detail, quick-charts, gallery-card-chart, position-card-chart, sandbox — all updated to `UptickDotResult`.

## Verify relay

- `npx jest` scoped to `st-trend-rider-dots` + `chart-indicators` specs.
- Sandbox: load a liquid symbol (e.g., SPY daily), enable ST Trend Rider V1 + `showSuppressedSignals` — hollow ghosts appear at suppressed bars; toggle off → clean chart identical to prod.

## Risks / open seams

- **Return-type ripple** — `UptickDotResult` touches several chart callers; all must be updated in the same task or dots silently disappear (compile error actually — acceptable blast radius, TS catches it).
- **Threshold display vs BE truth** — a user could set FE `ibsThreshold: 0.7` while BE emits at `0.5` → chart shows suppression where the store has signals. Mitigate: label/doc the param as display-eval; default matches BE.
- **`now` under jest fake timers** — availability specs must inject `now` via the param, never fake the clock (AGENTS.md: no `jasmine.clock`, `jest.useFakeTimers` + `setTimeout` flush hangs).
