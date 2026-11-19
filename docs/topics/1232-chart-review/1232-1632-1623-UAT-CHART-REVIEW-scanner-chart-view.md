**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Bar-Count Range Pills  
**Thread Slug:** bar-count-range-pills  
**Issue:** #1632  
**Thread Parent:** #1616  
**Topic Parent:** #1232  
**Task:** #1623  
**Domain:** CHART-REVIEW  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-19  
**Last Updated:** 2026-11-19  

# UAT — Range pill UI (#1623)

## Scope

The visible bar-count pill set from IMPL-FE §Sequence/phases item 2: both
range pill groups (`chart-view-toolbar` live, `chart-toolbar` hidden parity)
render `25 | 50 | 100 | 6M | 1Y | 5Y | All`, the `.active` highlight binds
the active chart's own range, and clicks write the active chart only — the
state model shipped in #1622, made visible here.

Late scope addition confirmed by the owner during UI verification: the
per-chart defaults are now `'50'` on **every** interval (revised from
D100/W100/M50 — see code review doc §Findings and PRD US-4 note).

**Supersedes #1622 UAT values:** `1232-1626-1622-UAT-…` documents the
pre-revision defaults (100/100/50) and the no-highlighted-pill transient.
Both are historical — the expected load state is now 50 bars on every chart
with `50` lit on the active chart.

Task acceptance criteria:

1. Both pill groups render exactly `25 50 100 6M 1Y 5Y All` in order;
   `Recent` absent.
2. `.active` sits on the pill matching the active chart's `activeRange`.
3. A pill click writes its token to the active chart only.
4. On load every chart opens at 50 bars; `50` is lit on the active chart.
5. Per-chart selections stay independent (state from #1622 — UI exposes it).
6. Toolbar specs pin pill set/order, highlight-follows-active-chart, and
   emit tokens.

## Prerequisites

- Dev server already running (`npm start`) — app at `http://localhost:4200`.
- Authenticated app session; a populated symbol list containing `QQQ`
  (consistent with prior UATs).
- No seed data or credentials — pure client-side state.

## Getting to the feature

Route: `/trading/chart-view`. Entry point: app nav → **Chart View**.
Surface: merged toolbar on top — the range pill group sits right of the
D/W/M interval pills in `.chart-controls`. Triple D/W/M chart grid below,
symbol list on the left. Select a list, then click symbol `QQQ`.

## Automated evidence (executed this session)

- `npx jest chart-toolbar-state signal-detail chart-view-toolbar chart-toolbar --coverage=false` — 4 suites / 67 tests green.
- `npx jest --coverage=false` — 324 suites / 6116 tests green.
- `npx tsc --noEmit` — zero errors in touched files.
- Pill set/order spec-pinned in both toolbar specs; highlight-follows-active
  pinned with non-default markers (`'1y'` monthly / `'25'` daily);
  7-of-7 pill→token emit coverage on the live toolbar; `'100'`→100-bars
  overshoot pin in signal-detail spec.

## Scenarios

### S1 — Pill set + defaults on load

- **Confirms:** AC1/AC4 — the full pill set renders; every chart opens at
  50 bars with `50` lit.
- **Steps:** navigate to `/trading/chart-view`; select a list; click `QQQ`.
- **Expected:** the range pill group reads `25 50 100 6M 1Y 5Y All` — **no
  `Recent`**. All three charts open on ~50 bars of their interval (daily
  ≈2.5 months, weekly ≈1 year, monthly ≈4 years). The `50` pill is
  highlighted (daily is the default active chart).
- **Result:** ☑ PASS — user confirmed on live dev server (2026-11-19)

### S2 — Bar-count pills write the active chart

- **Confirms:** AC3 — a bar-count click resizes only the active chart.
- **Steps:** on the default state click `25` (daily is active).
- **Expected:** only the daily chart shrinks to ~25 bars (~5 weeks); weekly
  and monthly unchanged. `25` is now lit.
- **Result:** ☑ PASS — user confirmed on live dev server (2026-11-19)

### S3 — Per-chart independence + highlight follows the active chart

- **Confirms:** AC2/AC3/AC5 — the highlight always shows the clicked chart's
  own selection.
- **Steps:** continuing from S2 — click the **weekly** chart cell (active
  outline moves to it). Then click `1Y` in the range group.
- **Expected:** after the cell click the highlight flips to weekly's own
  `50` (daily's `25` is no longer lit). After `1Y`, only the weekly chart
  widens to ~1 year of weekly bars; daily stays at 25 bars; `1Y` lit.
- **Result:** ☑ PASS — user confirmed on live dev server (2026-11-19)

### S4 — Monthly cell + single-mode targeting

- **Confirms:** the review-fixed keying — pills follow the rendered chart
  (single = `selectedInterval`), never a stale cell click.
- **Steps:** click the **monthly** cell; toggle to single-chart layout
  (grid icon in toolbar). The single chart renders the **daily** interval.
  Click `6M`.
- **Expected:** the daily chart redraws to ~6 months of daily bars — NOT
  monthly. `6M` lit, matching the chart on screen.
- **Result:** ☑ PASS — user confirmed on live dev server (2026-11-19)

### S5 — Interval pills bind each chart's own selection (single mode)

- **Confirms:** AC5 — each interval keeps its selection across switches.
- **Steps:** in single mode click `W` → observe highlight + click `25`;
  click `D`.
- **Expected:** on `W` the highlight shows weekly's own selection (`1Y`
  from S3) — after `25` the weekly chart shrinks to 25 bars; switching back
  to `D` restores daily at `6M` (from S4). `6M` lit on `D`.
- **Result:** ☑ PASS — user confirmed on live dev server (2026-11-19)

### S6 — Selections persist across symbols, reset on revisit

- **Confirms:** page-scoped lifecycle — same visit keeps prefs, new visit
  resets to `'50'` defaults.
- **Steps:** with daily on `6M`, use `›` to step to the next symbol; then
  navigate to another route (e.g. Dashboard) and back to
  `/trading/chart-view`, reselect `QQQ`.
- **Expected:** symbol stepping keeps `6M` on daily; after revisit every
  chart is back at 50 bars with `50` lit on the active chart.
- **Result:** ☑ PASS — user confirmed on live dev server (2026-11-19)

## Manual UI/UX refinement pass

- The wider pill group (`25 50 100 6M 1Y 5Y All`) fits the merged toolbar
  at normal viewport — no wrap, no clipping against the layout/fullscreen
  icons.
- `.active` styling on bar-count pills is visually identical to the
  calendar pills.
- Highlight legibility when the active chart changes in triple layout.
- **Result:** ☑ PASS — user confirmed (2026-11-19)

## Findings

None — S1–S6 + refinement pass green on user execution (2026-11-19).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| AC1 pill set/order, `Recent` absent | S1 + automated specs |
| AC2 `.active` = active chart's range | S1, S3, S4 |
| AC3 click writes active chart only | S2, S3 |
| AC4 '50' defaults on load | S1, S6 |
| AC5 per-chart independence | S3, S5 |
| AC6 toolbar specs green | Automated evidence |
| US-2 per-chart independence in UI | S3 |
| US-3 highlight follows active chart | S3, S4 |
| US-5 persist across symbols / reset on revisit | S6 |

## Regression / smoke

- Full suite green (324/6116) — `ChartRange` is shared.
- Nearby surfaces: D/W/M interval pills, zoom, layout + fullscreen, log
  scale, indicator menu, symbol nav — spot-checked via S2–S6 interactions.

## Verdict

PASS — S1–S6 + refinement pass green on live user execution (2026-11-19).

## Results log

| Date | Task | Executor | Result | Notes |
|---|---|---|---|---|
| 2026-11-19 | #1623 | user (live app) | PASS | S1–S6 + refinement; supersedes #1622 UAT's 100/100/50 defaults |
