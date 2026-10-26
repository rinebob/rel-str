**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Chart View Extension  
**Thread Slug:** chart-view-extension  
**Issue:** #1269  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Task:** #1255  
**Domain:** CHART-REVIEW  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-25  
**Last Updated:** 2026-10-25  

# UAT — #1255 ChartToolbarStateService + SignalDetailComponent showToolbar input

## Scope

This task is an **internal refactor**: chart-toolbar view state hoisted out of
`SignalDetailComponent` into a page-scoped `ChartToolbarStateService`, plus a
`showToolbar` input that suppresses the in-template toolbar (no consumer passes
`false` yet — #1256 will). The user-facing acceptance bar is therefore
**identical behavior** on the chart-review page at `/signals/charts`, with the
new architecture verified by code inspection and unit tests.

## Prerequisites

- Repo: `rel-str`, branch `prod` (or current work branch)
- Dev server: `npm start` (Angular on `http://localhost:4210`, observation API on :3456)
- Authenticated app session with at least one populated symbol list and a
  symbol that has `symbol-data` (any previously tracked symbol, e.g. QQQ)
- No seed data needed — real lists/symbols exercise every path

## Start instructions

```powershell
npm start
# open http://localhost:4210/signals/charts
```

## Test scenarios

### S1 — Page renders with toolbar and triple charts (baseline)

- **Feature:** merged toolbar state driving existing page
- **Start:** fresh navigation to `/signals/charts`
- **Steps:** select any list in the left pane; click a symbol
- **Expected:** D/W/M charts render (triple layout default); toolbar shows —
  indicators menu, zoom toggle, `‹ n/N ›` nav, D/W/M pills, range pills
  (Recent/6M/1Y/5Y/All), layout toggle, fullscreen, log-scale pill — in the
  same order as before; filing chips (symbol-list actions) centered in toolbar
- **Result:** ☑ PASS — user confirmed page identical at /signals/charts (2026-10-25)

### S2 — Interval pills + active-chart badge

- **Feature:** `setInterval` / `setActiveChart` via shared service
- **Steps:** (a) triple layout — click a D/W/M pill → the "active" badge moves
  to that chart cell (bold outline); click a chart cell directly → badge follows.
  (b) toggle to single layout → clicking W or M swaps the single chart's
  dataset and the pill highlights
- **Expected:** badge tracking and dataset swap both work; triple charts keep
  their own D/W/M datasets
- **Result:** ☑ PASS — user confirmed identical behavior (2026-10-25)

### S3 — Indicator menu scope follows layout

- **Feature:** `indicatorScope` + `applyIndicatorToggle` semantics
- **Steps:** (a) triple layout — open indicators menu, uncheck **Trend Bands** →
  bands disappear from **all three** charts; re-check → returns on all three.
  (b) single layout on Weekly — uncheck an indicator → only the weekly chart
  loses it; switch back to triple → weekly still unchecked, daily/monthly
  still checked (per-interval selection persisted)
- **Expected:** menu checkbox = checked only when on in ALL in-scope supporting
  intervals; toggles write per-interval selections atomically
- **Result:** ☑ PASS — user confirmed identical behavior (2026-10-25)

### S4 — Trigger Bands stay opt-in (no eager request)

- **Feature:** `OPT_IN_INDICATOR_IDS` default-off + lean callable gate
- **Steps:** open devtools Network tab, load a symbol → confirm **no**
  Trigger Bands callable request fires on paint. Open indicators menu → enable
  **ST-TRIGGER-BANDS** → band series renders on daily + weekly, not monthly;
  enable **ST-TRIGGER-BANDS-DOTS** → dot markers appear. Switch to monthly-only
  single view → both TB options hidden from the menu
- **Expected:** request fires only when a TB option is enabled; options scoped
  to D/W-capable intervals
- **Result:** ☑ PASS — user confirmed identical behavior (2026-10-25)

### S5 — Range pills, log scale, zoom toolbar

- **Feature:** `selectedRange`, `logScale`, `showZoomToolbar` signals
- **Steps:** click each range pill → visible window changes on all charts
  (Recent/6M/1Y/5Y/All). Toggle log scale → price axis switches log/linear on
  all charts. Toggle zoom → Syncfusion zoom/pan toolbar appears/disappears on
  all charts
- **Expected:** every control affects all rendered charts simultaneously
- **Result:** ☑ PASS — user confirmed identical behavior (2026-10-25)

### S6 — Symbol nav, filing chips, crosshair sync

- **Feature:** unchanged outputs + projected content
- **Steps:** `‹`/`›` buttons walk the list order with `n/N` counter; toggle a
  list chip → symbol membership flips (chip state + list pane update). Hover a
  chart in triple mode → crosshair appears at the same date/price on the other
  two charts
- **Expected:** all unchanged from pre-refactor behavior
- **Result:** ☑ PASS — user confirmed identical behavior (2026-10-25)

### S7 — Page-scoped service (prefs reset on revisit)

- **Feature:** `providers: [ChartToolbarStateService]` on the page — instance
  dies with the page
- **Steps:** change interval to W, range to 5Y, disable an indicator, toggle
  log scale off → navigate away to another route (e.g. `/trading/scanner`) →
  navigate back to `/signals/charts`, select a symbol → all toolbar prefs back
  to defaults (D interval, Recent range, default indicators, log scale on)
- **Expected:** prefs do NOT persist across page visits (confirms page scope —
  layout/fullscreen DO persist via root `UiStateService`)
- **Result:** ☑ PASS — pinned by service-spec re-instantiation test + code
  inspection (`providers` on page component, no `providedIn`); user confirmed
  no visible behavior change

### S8 — Empty state

- **Feature:** `showChart` collapse path
- **Steps:** navigate to `/signals/charts` with no symbol selected (or clear
  selection)
- **Expected:** "Enter a symbol to view charts" empty state, no toolbar
- **Result:** ☑ PASS — user confirmed identical behavior (2026-10-25)

### S9 — Manual order path unaffected

- **Feature:** Trade button + order queue still functional
- **Steps:** with a symbol loaded, use Trade (manual order dialog opens),
  verify order queue button behavior unchanged
- **Expected:** manual order flow works; no console errors
- **Result:** ☑ PASS — user confirmed identical behavior (2026-10-25)

### S10 — Console health

- **Feature:** no injection errors (unconditional `inject(ChartToolbarStateService)`)
- **Steps:** devtools console open through S1–S9
- **Expected:** zero `NullInjectorError` / DI errors; no new warnings
- **Result:** ☑ PASS — user confirmed identical behavior (2026-10-25)

## Automated verification (executed by agent)

| Check | Command | Result |
|---|---|---|
| Service spec (18 tests: defaults, scope, toggles, re-instantiation, no-op, batch) | `npx jest chart-toolbar-state` | ✅ PASS |
| Detail component spec (incl. `showToolbar` + service-driven describes) | `npx jest signal-detail` | ✅ PASS |
| Toolbar + chart-indicators specs (canonical homes) | `npx jest chart-toolbar chart-indicators` | ✅ PASS |
| Full suite | `npx jest --coverage=false` | ✅ PASS — 262 suites / 4,525 tests |
| Typecheck | `npx tsc --noEmit -p tsconfig.app.json` | ✅ PASS — clean |
| Page-scoped provider (not root) | code inspection — `@Injectable()` no `providedIn`; `providers:` on `ChartReviewComponent` | ✅ PASS |

## Traceability

| Task AC | Scenario(s) |
|---|---|
| Service owns signals + computeds + setters preserving semantics | S2–S5, A1–A2 |
| Component reads/writes service; `showToolbar` input; rendering unchanged | S1, S5–S6, A2 |
| Page-scoped (not root); state dies with page | S7, A6 |
| `onToggleIndicator` semantics preserved (in-scope only, atomic write) | S3–S4, A1 |
| Old page keeps working (service provided) | S1–S10 |

## Regression / smoke checklist

- [ ] Indicator menu shows ST extras (zone windows, uptick dots) per interval capability
- [ ] Trigger Bands options absent on monthly-only view
- [ ] HTF zone-window overlays render on daily (weekly window) and weekly (monthly window)
- [ ] Signal dots + uptick dots render when enabled
- [ ] Chart loading spinner appears during symbol switch
- [ ] No console errors throughout
