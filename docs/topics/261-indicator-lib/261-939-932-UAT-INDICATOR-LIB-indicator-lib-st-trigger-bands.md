**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Implement ST Trigger Bands in ST Indicator Library  
**Thread Slug:** st-trigger-bands  
**Issue:** #939  
**Thread Parent:** #862  
**Topic Parent:** #261  
**Task:** #932  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Draft  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

# UAT — Trigger Bands prod promotion (#932)

## Scope

Task #932 promoted Trigger Bands out of the dev sandbox onto the production
indicator menu: the bands and the signal dots are now **separate, opt-in
menu entries** on the signal-detail surface (the only prod surface with an
ST indicator picker — quick-charts and the gallery use fixed indicator
sets). Both default to unchecked and are offered on **daily and weekly
only**; monthly never lists, requests, or draws them.

Enabling either option issues the lean `IndicatorFamily.TRIGGER_BANDS`
request (daily+weekly, bands + dots only) under its own
`IndicatorSeriesStore` cache key — the default indicator response is never
refetched or invalidated. Bands render as state-colored step lines
(neutral / pullback / breakout per the Pine vocabulary); dots render as a
scatter overlay via `addChartExtras`. The contract cleanup removed the dead
`signals.triggerBands` slot end-to-end, the shared
`TRIGGER_BANDS_SIGNAL_TYPES` consts pin the BE↔FE wire vocabulary, and the
light theme remaps the neutral band's white to grey (`#ffffff → #9e9e9e`).

Review-level fixes QA should exercise live: `symbolDataVersion` is now
blanked while a new symbol's bars load (no stale-key fetch or cross-symbol
overlay), and the sandbox gates the lean request off on monthly.

## Prerequisites

- Dev server running: `npm start` (Observation API `:3456` + `ng serve` on
  `:4200`) — the worktree must contain the #932 changes.
- The **deployed** `stGetSymbolIndicatorSeriesV2` callable has Trigger
  Bands support (deployed during #880 implementation — if the indicator
  silently renders nothing in scenario 2/3, a functions deploy is the first
  suspect; `firebase deploy --only functions`).
- A signed-in user; the app is auth-guarded.
- A symbol with recent Trigger Bands activity — **AAPL** produced 2,958
  daily / 583 weekly dot markers in the #877 callable verification and is a
  good default.
- Chrome/Edge DevTools (Network tab + device theme toggle for the
  light/dark checks).

## Start

1. Navigate to `http://localhost:4200/signals/charts` (Chart Review —
   hosts the signal-detail surface).
2. Choose a symbol (e.g. click a signal card / use the symbol input so the
   detail charts load D/W/M panes).
3. The indicator menu is the ST picker on the signal-detail toolbar.

## Scenarios

### 1. Menu surface — both entries present, opt-in

- **Start:** signal-detail loaded on the default (triple D/W/M or daily)
  view.
- **Steps:** Open the indicator menu.
- **Expected:** `ST Trigger Bands` **and** `ST Trigger Bands Signals` are
  listed as separate entries; **both are unchecked** on first paint. The
  existing defaults (zones, trend strength, trend bands, etc.) are
  unchanged.
- **Evidence:** `signal-detail.component.spec.ts` pins the menu options +
  `OPT_IN_INDICATOR_IDS` default-off selection; live check confirms the
  rendered menu.
- **Result:**

### 2. Bands — lean request, state-colored step lines on D + W

- **Steps:** Check `ST Trigger Bands` only. Watch DevTools Network.
- **Expected:** exactly one extra `stGetSymbolIndicatorSeriesV2` call with
  `indicators: ["triggerBands"]` and `intervals: ["daily","weekly"]`; the
  pre-existing default call is **not** re-issued. On the daily and weekly
  charts two step lines appear (upper + lower Donchian) with neutral /
  pullback / breakout coloring. Monthly pane draws nothing.
- **Evidence:** spec asserts the exact lean-request args and that the
  default response is untouched; live check confirms rendering.
- **Result:**

### 3. Dots independently — dots without bands

- **Steps:** Uncheck `ST Trigger Bands`; check `ST Trigger Bands Signals`
  alone.
- **Expected:** no second request is needed if scenario 2 already cached
  the lean response (same key); pullback/breakout dots render below (long)
  / above (short) bars, blue `#2962ff` and yellow `#ffeb3b` per the Pine
  cross-side vocabulary. Bands do **not** draw.
- **Evidence:** spec asserts dots render with bands off; live check.
- **Result:**

### 4. Toggle off removes the series

- **Steps:** Uncheck `ST Trigger Bands Signals` (and bands if still on).
- **Expected:** dots/bands disappear; no errors in the console.
- **Result:**

### 5. Monthly excludes Trigger Bands entirely

- **Steps:** Switch to a monthly-only view; open the indicator menu.
- **Expected:** neither TB entry is offered. Switching to monthly with TB
  already enabled fires **no** request and draws nothing (the lean request
  is D/W only and the scope gate suppresses it).
- **Evidence:** spec pins monthly exclusion (`INDICATORS_BY_INTERVAL` +
  scope-gated `triggerBandsSelected`); live check on the rendered menu.
- **Result:**

### 6. Symbol switch — no stale-version fetch (review finding 13)

- **Steps:** With bands enabled, switch to a different symbol (e.g. AAPL →
  QQQ). Watch Network and the chart during the load gap.
- **Expected:** the lean request for the new symbol fires only **after** the
  new bars land — with the new symbol's real version (no call keyed to the
  previous symbol's version). No momentary overlay of the new bands on the
  old bars.
- **Evidence:** `chart.store.spec.ts` pins `symbolDataVersion` blanking;
  live check confirms no wasted/mis-keyed call.
- **Result:**

### 7. Sandbox regression — still works, still dev-gated surface

- **Steps:** Navigate to `dev/flex-chart`. Enable Trigger Bands in real
  mode → bands + dots sub-toggle work as before (the picker now serves it
  from the prod `ST_INDICATOR_OPTIONS` list). Switch data mode to
  synthetic → the TB checkbox is disabled and no request fires. Switch to
  monthly → no lean request fires (new gate).
- **Expected:** all of the above; `dev: true` config still flows.
- **Evidence:** sandbox spec covers synthetic disable + lean-request args;
  live check for the monthly gate and visual sanity.
- **Result:**

### 8. Light theme — neutral band is visible (grey, not white)

- **Steps:** In DevTools → Rendering, emulate `prefers-color-scheme: light`
  (or toggle the app theme if one exists). Reload the signal-detail chart
  with bands enabled.
- **Expected:** the neutral band is **grey** (`#9e9e9e`), not invisible
  white. Pullback/breakout states remain legible (blue reads fine; judge
  the yellow-on-light segments — review finding 7 deliberately left
  `#ffeb3b` unmapped because `colorRemap` is global).
- **Result:**

### 9. Dark theme — unchanged

- **Steps:** Re-emulate dark (or toggle back); reload with bands enabled.
- **Expected:** neutral band white, states blue/yellow — identical to the
  #880 sandbox rendering validated in UAT #910.
- **Result:**

### 10. Regression smoke — the rest of signal-detail

- **Steps:** With TB off, exercise the nearby surface: toggle other
  indicators, switch intervals/symbols, confirm dots/zones/bands render as
  before and the console stays clean.
- **Expected:** no behavior change for non-TB indicators; no warnings about
  `triggerBands` from the default injector (staleness diagnostic now lives
  on the lean path only).
- **Result:**

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| TB + dots removed from dev types; TB in prod menu set | 1, 7 |
| Opt-in lean request under own cache key, default untouched | 2, 3 (Network); specs |
| Light-theme invisible neutral band fixed | 8 |
| Shared signalType consts / keyed dot-color map | automated (`flex-chart-indicator-visuals.spec.ts`) |
| Dead `signals.triggerBands` + converter branches removed | 10 (no stray warnings); specs |
| `BESPOKE_MAIN_PANE_INDICATORS` replaces exclusion chain | automated (`flex-chart.component.spec.ts`) |
| Monthly decided — D/W only, option hidden on monthly | 5, 7 |
| Sandbox keeps working; no dev state leaks into prod | 7, 1 |
| Store keying spec; `as never` cleanup | automated (`indicator-series.store.spec.ts`) |
| Review finding 13 (stale version fetch) | 6 |

## Automated evidence (executed this session)

- Focused suites on the final tree: **9 suites / 106 tests green**
  (`signal-detail`, `flex-chart-sandbox`, `indicator-converters`,
  `trigger-bands-chart`, `indicator-series.store`, `chart.store`,
  `flex-chart-indicator-visuals`, `flex-chart-theme`,
  `flex-chart.component`) — 2026-10-09.
- `chart.store.spec.ts` — new spec pins `symbolDataVersion: ''` during a
  symbol switch (red → green on the fix).
- `signal-detail.component.spec.ts` — 5 TB specs: menu entries present +
  opt-in, no pre-toggle fetch, exact lean-request args, D/W injection vs
  monthly exclusion, dots-without-bands.
- `indicator-series.store.spec.ts` — two-key coexistence, no default
  invalidation, version bust, `clearCache(symbol)`.

## Results

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| 1 | Menu entries present, opt-in unchecked | | |
| 2 | Bands lean request + D/W step lines | | |
| 3 | Dots independent toggle | | |
| 4 | Toggle off removes series | | |
| 5 | Monthly excludes TB | | |
| 6 | Symbol switch — no stale-key fetch | | |
| 7 | Sandbox regression (real/synthetic/monthly) | | |
| 8 | Light theme grey neutral band | | |
| 9 | Dark theme unchanged | | |
| 10 | Signal-detail regression smoke | | |

## Regression / smoke

- Scenario 10 covers the shared chart surface. Sibling surfaces
  (quick-charts, gallery) use fixed indicator sets and were verified
  unwired to `ST_INDICATOR_OPTIONS` — a quick visual pass on
  `signals/charts` neighbors is sufficient.
