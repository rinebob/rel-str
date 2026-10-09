# UAT — Trigger Bands dots + dev-mode sandbox wiring (#880)

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Implement ST Trigger Bands in ST Indicator Library  
**Thread Slug:** st-trigger-bands  
**Issue:** #910  
**Thread Parent:** #862  
**Topic Parent:** #261  
**Task:** #880  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

## Scope

#880 delivers Trigger Bands as an opt-in indicator inside the `dev/flex-chart` sandbox, behind a new flex-chart dev mode:

- `FlexChartConfig.dev` render gate — `DEV_INDICATOR_TYPES` configs are stripped in `effectiveConfig` unless `dev: true`; `ST_DEV_INDICATOR_OPTIONS` keeps dev indicators out of prod menus.
- Sandbox indicator picker entry; a separate lean opt-in callable request (daily + weekly, `IndicatorFamily.TRIGGER_BANDS`) under its own cache key; bands + dots merge.
- Dots overlay: armed-state pullback dots on every armed bar + breakout dots, Pine colors; sandbox-only "TB dots" sub-toggle, default off.
- Two-series step-expanded band rendering (`trigger-upper`/`trigger-lower`, `MultiColoredLine`).

Acceptance criteria covered: the six criteria on #880 (dot converter + colors, picker toggle, dev gate, lean opt-in request, older-backend resilience, specs) plus the manual render check.

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, branch `prod`, working tree contains this task's uncommitted changes.
- Backend callable `stGetSymbolIndicatorSeriesV2` deployed with Trigger Bands support (deployed during implementation; verify it still is — without it the indicator silently renders nothing).
- Dev server: `npm start` (project dev command) or `ng serve`.
- TradingView chart open on the same symbol/interval for visual comparison (use AAPL D and W — verified data symbol).
- Reference Pine: `rb-ps/rb-ta/ind/rb-st-trigger-bands.pine`.

## Start instructions

1. `npm start` from repo root.
2. Navigate to `dev/flex-chart` (flex-chart sandbox).
3. In the symbol input, load `AAPL` (real mode — ensure data mode is "real", not "synthetic").
4. Open the ST indicators picker.

## Test scenarios

### 1. Dev gate (automatable)

Feature: `FlexChartConfig.dev` strips dev-typed indicator configs unless opted in.

- Steps: `npx jest flex-chart.component --coverage=false`
- Expected: dev-gate specs pass — a config carrying `st-trigger-bands` renders no series without `dev: true`, renders with `dev: true`, and a leaked `st-trigger-bands-dots` config is also stripped.
- Result: PASS — `flex-chart.component.spec.ts:311-379` (4 dev-gate specs) green inside the full `npx jest` run, 2026-10-08.

### 2. Bands render on D and W (manual)

Feature: two step-expanded band lines, Pine colors.

- Start: sandbox, `AAPL`, real mode, daily interval.
- Steps: enable "Trigger Bands" in the ST picker.
- Expected: upper and lower band lines hug the 3-bar body extremes (bodies, not wicks); white neutral, yellow/blue per Pine cross-side mapping (upper: pullback yellow, breakout blue; lower: mirrored). Step transitions — horizontal run then vertical jump at each level change. Repeat on weekly interval.
- Evidence: user confirmed in session — "bands look pretty good", "bars on the body extremes not wicks", "math is pretty spot on" vs TV, "this current version is the one we'll stick with".
- Result: PASS (user visual confirmation, session 2026-10-08)

### 3. Dots sub-toggle (manual)

Feature: dots only when "TB dots" is ticked; armed-state cadence.

- Start: scenario 2 with bands visible.
- Steps: (a) confirm "TB dots" starts unchecked and no dots render; (b) tick it — dots appear below/above bars, yellow/blue; (c) verify pullback dots appear on every armed bar and stop at the breakout bar; (d) untick — dots gone, bands unchanged.
- Expected: dense pullback runs ending at breakouts; the Pine circle-plot cadence.
- Result: PASS — user confirmed 2026-10-08 ("correct" to toggle default-off, dots on tick, dots stopping at breakout, untick removes).

### 4. Synthetic mode guard (manual)

Feature: dev indicator cannot request data in synthetic mode.

- Steps: switch data mode to synthetic — the Trigger Bands checkbox is disabled; no callable request is issued.
- Expected: checkbox disabled and unchecked; chart renders synthetic bars with no bands.
- Result: PASS — spec-covered (`flex-chart-sandbox.component.spec.ts:488-501`: programmatic enable in synthetic mode fires no request; checkbox disabled). Live check waived: the synthetic-mode guard is a defensive addition beyond the acceptance criteria on a dev-only surface.

### 5. Lean request + cache isolation (automatable)

Feature: opt-in request is separate; default response never invalidated.

- Steps: `npx jest flex-chart-sandbox trigger-bands-chart indicator-converters base-indicators --coverage=false`
- Expected: specs assert the lean request fires once on enable with D+W + `TRIGGER_BANDS` family, the default `responseFor` entry is untouched, older-backend empty `triggerBands` renders nothing without error.
- Result: PASS — `flex-chart-sandbox.component.spec.ts:431-501` (lean request, cache isolation, synthetic guard), `trigger-bands-chart.spec.ts` (merge + empty-response), `indicator-converters.spec.ts` — all green in the full jest run, 2026-10-08.

### 6. Backend contract (automatable)

- Steps: `npx tsx --test tests/functions/st-trigger-bands.test.ts tests/functions/st-trigger-bands-series.test.ts`; `npx tsx functions/scripts/verify/indicator-lib-877-callable.ts` (AAPL, cached Firestore data).
- Expected: 35/35 engine, 14/14 series/filter, 21/21 callable checks — armed-state dots, opt-in filtering, default response unchanged.
- Result: PASS — engine 35/35, series/filter 14/14 (`tsx --test`), callable verify 21/21 (AAPL cache; daily 2,958 dots / weekly 583 / monthly 149; payload +33%), all run 2026-10-08.

### 7. Regression sweep (automatable)

- Steps: `npx jest --coverage=false`
- Expected: all suites pass except the known unrelated `screenshot-capture-contracts.spec.ts` failure (options thread's uncommitted `PositionType` extension; spec untouched by this task).
- Result: PASS — 203/204 suites, 3195/3196 tests, 2026-10-08. Only failure is the documented unrelated `PositionType` assertion.

## Traceability

| AC (#880) | Scenario |
|---|---|
| `convertTriggerBandsDotMarkers` maps markers; long/short + breakout/pullback distinct | 3, 5 |
| Toggle enables bands (dots sub-toggle, default off — superseded AC) | 2, 3 |
| `FlexChartConfig.dev` gate + `ST_DEV_INDICATOR_OPTIONS` | 1, 4 |
| Lean request, own cache key, default response untouched | 5 |
| Older backend renders nothing, no errors | 5 |
| Manual sandbox + TradingView check | 2, 3 |
| Specs pass | 1, 5, 6, 7 |

## Regression / smoke checklist

- [x] Other sandbox indicators render alongside Trigger Bands — adapter produces `triggerBandSeries` additively; no shared series path modified; full jest suite green
- [x] Prod surfaces unaffected — verified by thermo-nuclear trace: no prod caller emits a TB config, `ST_INDICATOR_OPTIONS` unchanged, `effectiveConfig` strips dev types even if a config leaked
- [x] Interval switching with TB enabled — user exercised D and W with bands enabled during the session's visual iterations; log-Y and symbol switching unchanged paths
