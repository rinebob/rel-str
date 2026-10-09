# Code Review — Trigger Bands chart indicator, registry and callable conversion (#879)

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Implement ST Trigger Bands in ST Indicator Library  
**Thread Slug:** st-trigger-bands  
**Issue:** #875  
**Thread Parent:** #862  
**Topic Parent:** #261  
**Task:** #879  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

## Verdict: **PASS**

Standards **PASS** · Spec **PASS** · Thermo-nuclear **PASS**. No critical or major findings. One minor fixed in-loop; the remaining items are advisory and carried into QA. Reviewed inline (no sub-agents) against the PRD (#863), the FE implementation plan and the FE test plan.

## Scope

- `src/app/features/shared/components/flex-chart/indicators/st-trigger-bands.indicator.ts` (new) + spec
- `flex-chart.types.ts` (`ST_TRIGGER_BANDS`, `triggerBandData`; the unused `TRIGGER_BAND` member and `st-trigger-band.indicator.ts` placeholder removed), `indicator-registry.ts`, `chart-data-adapter.service.ts` (+ spec), `flex-chart.component.ts` / `.html`
- `src/app/features/savant-trader/utils/chart-indicators/indicator-converters.ts` (+ spec)
- `shared/flex-chart-indicator-visuals.ts` (`ST_TRIGGER_BANDS_COLORS`, `ST_TRIGGER_BANDS_WIDTHS`)
- FE implementation plan (as-built notes)

## Standards

- Follows the existing patterns: a renderer-only indicator file with a pure series builder (like `st-zigzag` / `st-std-dev-lines`), a bespoke adapter `computed` with theme and log-scale mapping, the callable payload carried on the config (like `bandData`), colours in the shared visuals module (single source for FE and server captures).
- No FE calculator: the backend stays the single source of truth for the flags.
- Types-only import from `flex-chart.types.ts` to the indicator file mirrors the existing `BandSeriesData` import (no runtime cycle). `tsc --noEmit -p tsconfig.app.json` clean.
- The generic main-pane line branch excludes the new indicator, so no empty duplicate series; `StepLineSeriesService` is provided.
- Specs follow repo conventions (Jest, no type-erased fixtures beyond the existing `as IndicatorConfig` helpers, hand-worked expectations).

## Spec

| Acceptance criterion (#879) | Result |
|---|---|
| `ST_TRIGGER_BANDS` + `ST_TRIGGER_BANDS_INDICATOR` registered (overlay, price axis, no params), not in `DEFAULT_ST_INDICATORS` | Met for the registry export and series type; the `ST_INDICATOR_OPTIONS` menu entry is deliberately deferred to #880 (finding 4) |
| `convertIntervalIndicators` / `injectCallableIndicatorData` produce band data; null bands skipped; missing series empty without error | Met (converter specs) |
| Bands render as state-coloured step lines; colours in the shared visuals file | Met in code and unit tests; not yet seen in a browser (finding 2) |
| No FE calculator | Met |
| FE test-plan specs (definition, converters) pass | Met |

FE test-plan items for dots, request wiring and component wiring belong to #880.

## Thermo-nuclear

- The series builder is a pure function with the tricky rule (segment ownership by right endpoint, left endpoint shared) pinned by hand-worked tests, including the documented one-bar bridging case.
- The stable-series-count rule matches how Anchored VWAP keeps its 12 series constant; adopted here after the first draft varied the count with the data (finding 1).
- State derivation lives in one converter function; the per-bar pullback flag deliberately wins over the breakout flag (they never coincide).

## Findings

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | Minor | The first draft omitted all-null lines, so the number of `e-series` varied with the data. The neighbouring Anchored VWAP indicator keeps a fixed series count to avoid chart re-initialisation on symbol/interval changes. | Fixed in-loop: always six lines once any point lands; spec added (`stable series count`). |
| 2 | Advisory | jsdom renders no chart. Three rendering assumptions are unverified live: `StepLine` honours `emptyPointSettings: Gap`, later series paint on top (the neutral to breakout ordering), and the one-bar bridging looks acceptable. | QA must include a live render check once #880 provides the toggle and the backend is deployed. |
| 3 | Minor | A single-bar interruption inside a run is bridged by the surrounding run's colour. | Accepted and documented in the indicator header, the plan and a test. |
| 4 | Info | The AC says "registered"; the `ST_INDICATOR_OPTIONS` entry feeds the menus (signal-detail, sandbox, `base-indicators`) and would show a toggle that does nothing until #880 wires the request. | Deferred to #880; recorded in the plan and on the task. |
| 5 | Info (ship) | The working tree also carries Anchored VWAP (#871) hunks in `flex-chart.component.html` / `.ts`, `flex-chart.types.ts`, `indicator-registry.ts` and `chart-data-adapter.service.ts` (+ spec). | Ship must stage only this task's hunks or coordinate one commit with #871. |

## Test results

- `npx jest st-trigger-bands chart-data-adapter indicator-converters --coverage=false`: **67/67 pass** (3 suites), after the in-loop fix.
- `npx jest flex-chart chart-indicators gallery-card-chart quick-charts signal-detail --coverage=false`: 27 suites, 416 pass; the single failure was a spec assertion that the in-loop fix made stale (now corrected and re-run green above).
- `npx tsc --noEmit -p tsconfig.app.json`: clean.
- Not run: the full FE Jest suite; a live render (finding 2). The repo has no root ESLint config.
