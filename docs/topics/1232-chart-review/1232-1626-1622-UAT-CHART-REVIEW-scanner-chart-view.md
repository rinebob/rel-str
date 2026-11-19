**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Bar-Count Range Pills  
**Thread Slug:** bar-count-range-pills  
**Issue:** #1626  
**Thread Parent:** #1616  
**Topic Parent:** #1232  
**Task:** #1622  
**Domain:** CHART-REVIEW  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# UAT — Per-chart range state (#1622)

## Scope

Per-chart range selection state on the Chart View page: the `ChartRange` union
gains literal bar counts `'25'|'50'|'100'` and loses `'recent'`; the toolbar
service swaps one shared `selectedRange` signal for `rangesByInterval` keyed by
chart interval + `activeRange`; `setRange` writes only the active chart
(`selectedInterval` in single mode, clicked cell's `activeChartInterval` in
triple); `signal-detail` maps each chart's own range to `visibleBars`.

Visible changes from this task alone:

- Defaults on load: daily 100 bars, weekly 100 bars, monthly 50 bars
  (was Recent = 365/104/60).
- The `Recent` pill is gone from both toolbar pill groups (forced by
  strictTemplates — `'recent'` no longer exists).
- Remaining pills `6M | 1Y | 5Y | All` now apply per-chart.
- **Known transient:** the `25|50|100` pills land in task #1623 — until then
  the default selections have no matching pill, so no range pill is
  highlighted on load. This is expected, not a defect.

Task acceptance criteria:

1. `ChartRange` = `'25'|'50'|'100'|'6m'|'1y'|'5y'|'all'` — `'recent'` gone.
2. `rangesByInterval` defaults `{daily:100, weekly:100, monthly:50}`;
   `activeRange` returns the active chart's selection.
3. `setRange` writes only the active chart's slot — single and triple modes.
4. `rangeBarsFor` returns literal counts for numeric members; calendar
   presets unchanged; `ALL_BARS_MAX` for `'all'`.
5. Per-chart `visibleBars` diverge when ranges differ.
6. Service + signal-detail specs green; no `RECENT_*` constants remain.

Review-round fix also confirmed here: single-mode pills target
`selectedInterval` even after a triple-mode cell click (found + fixed during
code review — S4 covers it).

## Prerequisites

- Dev server already running (`npm start`) — app at `http://localhost:4200`.
- Authenticated app session; at least one populated symbol list with a
  symbol that has chart data — e.g. `QQQ` (used throughout prior UATs).
- No seed data or credentials needed — pure client-side state.

## Getting to the feature

Route: `/trading/chart-view`. Entry point: app nav → **Chart View** (the old
`/signals/charts` route redirects here). Surface: the chart-review page —
merged toolbar on top (D/W/M interval pills, range pills, zoom/layout/
fullscreen toggles, log-scale pill, list actions), triple D/W/M chart grid
below, symbol list on the left. Select a list, then click symbol `QQQ`.

## Automated evidence (executed this session)

- `npx jest chart-toolbar-state signal-detail chart-view-toolbar chart-toolbar --coverage=false` — 4 suites / 61 tests green.
- `npx jest --coverage=false` — 324 suites / 6102 tests green.
- `npx tsc --noEmit` — zero errors in touched files.
- Short-history tolerance (`visibleBars` > data length) is spec-pinned —
  `rangeBarsFor` returns the literal count regardless of bars present and
  flex-chart clamps; no UI scenario needed.

## Scenarios

### S1 — Defaults on load

- **Confirms:** AC2 — per-chart defaults D100/W100/M50 replace `recent`.
- **Steps:** navigate to `/trading/chart-view`; select a list; click `QQQ`.
- **Expected:** triple layout renders; daily shows ~100 bars (~5 months),
  weekly ~100 bars (~2 years), monthly ~50 bars (~4 years). Range pill group
  reads `6M 1Y 5Y All` — **no `Recent` pill**, and no pill highlighted
  (transient — see Scope).
- **Result:** ☑ PASS — user confirmed on live dev server (2026-11-18)

### S2 — Per-chart independence (triple layout)

- **Confirms:** AC3/AC5 — a range click writes only the active chart.
- **Start:** fresh page, triple layout, `QQQ` selected.
- **Steps:** click `5Y` in the range pill group (daily cell is the default
  active chart).
- **Expected:** only the daily chart widens to ~5 years; weekly and monthly
  are unchanged. The `5Y` pill lights.
- **Result:** ☑ PASS — user confirmed on live dev server (2026-11-18)

### S3 — Highlight + writes follow the active chart

- **Confirms:** AC3 — `activeRange`/setRange follow `activeChartInterval`.
- **Steps:** continuing from S2 — click the weekly chart cell (bold outline
  moves to it). Observe the pill group, then click `6M`.
- **Expected:** after the cell click the pill highlight shows weekly's own
  selection (none highlighted — weekly is still on its `100` default); after
  `6M`, only the weekly chart redraws to ~6 months (~26 weekly bars); daily
  stays at 5Y.
- **Result:** ☑ PASS — user confirmed on live dev server (2026-11-18)

### S4 — Single-mode targeting after a triple-mode cell click

- **Confirms:** review-round fix — pills bind the rendered chart in single
  mode even when `activeChartInterval` was last moved by a cell click.
- **Steps:** in triple layout click the monthly cell; toggle to single-chart
  layout (layout icon in toolbar). The single chart shows the daily interval
  (the last-selected interval, not monthly). Click `1Y`.
- **Expected:** the rendered daily chart redraws to ~1 year — NOT monthly.
  Pill highlight sits on `1Y`, matching the chart on screen.
- **Result:** ☑ PASS — user confirmed on live dev server (2026-11-18)

### S5 — Interval pills bind each chart's own selection (single mode)

- **Confirms:** AC2/AC3 — each interval keeps its selection across switches.
- **Steps:** in single mode click `W` → click `6M` (weekly now ~6 months);
  click `D`.
- **Expected:** switching to daily restores the daily chart at ITS selection
  (`1Y` from S4); weekly stays `6M` — switch back to `W` to confirm.
- **Result:** ☑ PASS — user confirmed on live dev server (2026-11-18)

### S6 — Selections persist across symbol changes, reset on revisit

- **Confirms:** page-scoped lifecycle — same visit keeps prefs, new visit resets.
- **Steps:** with daily on `1Y`, use the `›` next-symbol control to step to
  the next symbol in the list; then navigate to another route (e.g. the
  Dashboard) and back to `/trading/chart-view`, reselect `QQQ`.
- **Expected:** stepping symbols keeps `1Y` on daily; after revisit the page
  is back at defaults (100/100/50, no pill highlighted).
- **Result:** ☑ PASS — user confirmed on live dev server (2026-11-18)

## Manual UI/UX refinement pass

- Range pill group without a highlighted pill on load — accepted as the
  sanctioned transient (pills `25/50/100` arrive in #1623; user confirmed
  2026-11-18).
- Pill row fits the merged toolbar at normal viewport — user confirmed.
- Cell-click affordance + pill re-highlight reads clearly — user confirmed.
- **Result:** ☑ PASS — user confirmed (2026-11-18)

## Findings

None — S1–S6 + refinement pass green on user execution (2026-11-18).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| AC1 union members / `'recent'` gone | S1 (pill group) + automated (tsc, specs) |
| AC2 default map / `activeRange` | S1, S5 |
| AC3 `setRange` active chart only | S2, S3, S4, S5 |
| AC4 literal counts / presets / ALL_BARS_MAX | S1–S5 + automated specs |
| AC5 divergent per-chart visibleBars | S2, S3 |
| AC6 specs green, no RECENT_* | Automated evidence |
| Review fix: single-mode desync | S4 |
| US-5 persistence across symbols | S6 |
| US-6 reset on revisit | S6 |

## Regression / smoke

- `npx jest --coverage=false` — 324 suites / 6102 tests green (full sweep).
- Nearby surfaces: zoom/pan toggle, log-scale pill, layout + fullscreen
  toggles, indicator menu, symbol nav `‹ ›` — untouched by the diff;
  spot-checked via S2–S6 interactions.

## Verdict

PASS — S1–S6 + refinement pass green on live user execution (2026-11-18).

## Results log

| Date | Task | Executor | Result | Notes |
|---|---|---|---|---|
| 2026-11-18 | #1622 | user (live app) | PASS | S1–S6 + refinement; transient no-highlight pill accepted pending #1623 |
