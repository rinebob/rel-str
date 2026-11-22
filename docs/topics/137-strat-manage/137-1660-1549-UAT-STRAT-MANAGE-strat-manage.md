# UAT — #1549 FE: Results summary popup + analysis link

**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** strat-manage-page-overhaul  
**Issue:** #1660  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1549  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

## Scope

Per-instance **Results** action on the manage page table: opens a dialog
with a stats block (realized/unrealized P&L, premium collected, open/
closed trade counts, max drawdown), an open-position summary
(symbol, status, legs, premium, unrealized P&L), and a compact equity
sparkline — all via the existing `getPaperStats` (scope
`inst-{instanceId}`) and `listStrategyPositions` callables. The dialog's
**Analysis** action opens
`/options/strategy/backtest/analysis/{instanceId}` in a new tab.

Covers Task #1549 acceptance criteria:

- Per-instance dialog: stats block, open-position summary, equity
  sparkline via existing callables
- Analysis action opens `/options/strategy/backtest/analysis/{instanceId}`
  in new tab
- Specs mock the callables; error/empty states covered

## Prerequisites

- Dev server already running: `http://localhost:4210`
- Signed in as the normal dev user (paper trading account active)
- At least one **paper** instance row in the manage table — created in
  earlier UATs, e.g. `QQQ-CDS-30-50-40-ALL` or
  `TSLA-CDS-35-55-45-ALL`. Any instance works; expected results differ
  by whether the instance has a stats doc (see scenarios)
- For S6: browser devtools (F12 → Network tab → throttling)

## Getting to the feature

- **Route:** `http://localhost:4210/options/strategy/manage`
- **Entry point:** nav sidebar → **Strategy Manage** (wrench icon)
- **Surface:** the instance table (Paper tab, default). Each row's
  actions cell now carries a **Results** button (left of the
  Start/Stop button)
- Click **Results** on any row → the results dialog opens centered
  over a backdrop

## Automated evidence

- `npx jest --coverage=false --testPathPatterns="strategy-manage"` —
  132/132 green (17 results-dialog specs incl. pending/empty/error/
  degenerate-curve states + 1 page wiring spec)
- `npx jest --coverage=false` (full suite) — 6,183/6,183 green
- `npx tsc -p tsconfig.app.json --noEmit` — clean
- Evidence date: 2026-11-22

## Scenarios

### S1 — Open the results dialog (stats block)

- **Feature:** per-instance results summary via `getPaperStats`
- **Starting state:** manage page loaded, Paper tab, at least one row
- **Steps:**
  1. In the actions cell of an ACTIVE paper instance row (e.g.
     `QQQ-CDS-30-50-40-ALL` if it ran a noon pass), click **Results**
  2. Observe the dialog immediately after it opens
  3. Wait for the stats call to resolve (~1s)
- **Expected:**
  - Dialog title shows `Results — {instanceId}`
  - **Briefly** (while the call is in flight): "Loading results…" —
    NOT "No results yet"
  - Instance WITH a stats doc: stats grid renders six cells —
    Realized P&L, Unrealized P&L, Premium collected, Open trades,
    Closed trades, Max drawdown (missing fields show `—`, not a crash)
  - Instance with NO stats doc: "No results yet — the instance has
    no stats doc (nothing has run)."
- **Result/evidence:** PASS (user, 2026-11-22) — `QQQ-PCS-45-10-20-ALL`
  (ACTIVE, `Yes · Open`): dialog title correct; stats grid rendered
  Realized 0.00 / Unrealized 0.00 / Premium collected 517.00 /
  Open 1 / Closed 0 / Max drawdown 0.00 — fresh single-position
  instance, no crash on increment-era fields. (Loading flash too fast
  to observe — covered by pending-observable spec.)

### S2 — Equity sparkline

- **Feature:** compact equity sparkline from `PaperStats.equityCurve`
- **Steps:** in the same dialog, look below the stats grid
- **Expected:**
  - Stats doc with ≥2 curve points: an SVG polyline chart (200×40)
    renders inside a thin border
  - Stats doc with 0–1 points or no `equityCurve` field
    (increment-minted doc): no sparkline, no error — grid still renders
- **Result/evidence:** PASS (verified, 2026-11-22) — no sparkline on any
  open instance dialog. Firestore probe confirms the absence is
  data-driven, not a defect: `stats-inst-QQQ-PCS-45-10-20-ALL` carries
  scalars only (`totalPremiumCollected 517.0`, `openTradeCount 1`,
  `maxDrawdown 0`) and **no `equityCurve` field** — written only by the
  nightly stats recompute, which hasn't run over these ~4-day-old
  instances. Render path covered by specs (≥2-point curve renders the
  SVG; <2 hides it).

### S3 — Open-position summary

- **Feature:** open positions via `listStrategyPositions({instanceId})`
- **Steps:** in the same dialog, scroll to **Open positions**
- **Expected:**
  - "Loading positions…" briefly, then:
  - Instance with open positions: one row per position —
    symbol, status label (e.g. "Open"), leg count, premium, uP&L
  - Instance with none: "No open positions."
- **Result/evidence:** PASS (user, 2026-11-22) — `QQQ-PCS-45-10-20-ALL`:
  one row — `QQQ · Open · 2 legs · premium 517.00 · uP&L 0.00`,
  matching the stats doc's premium and the table's `Yes · Open` join.

### S4 — Analysis link opens a new tab

- **Feature:** `/options/strategy/backtest/analysis/{instanceId}` in
  `_blank` per US-7
- **Steps:**
  1. Note the current manage-page tab (filters/scroll state)
  2. In the dialog, click **Analysis**
- **Expected:**
  - A NEW browser tab opens at
    `http://localhost:4210/options/strategy/backtest/analysis/{instanceId}`
    (the instance id fills the `:listDocId` segment)
  - The manage-page tab is untouched — dialog still open, filters
    and scroll position preserved
- **Result/evidence:** PASS (user, 2026-11-22) — new tab opened at
  `/options/strategy/backtest/analysis/{instanceId}`; manage tab
  retained dialog + filters + scroll.

### S5 — Empty state on an unstarted instance

- **Feature:** honest empty state for an instance with no results
- **Steps:** click **Results** on an UNSTARTED paper instance row
  (e.g. a freshly created instance that never ran)
- **Expected:** "No results yet — the instance has no stats doc
  (nothing has run)."; "No open positions."; no sparkline; no errors
  in the browser console
- **Result/evidence:** PASS (user, 2026-11-22)

### S6 — Error state (offline)

- **Feature:** callable-failure rendering
- **Steps:**
  1. F12 → Network tab → set throttling to **Offline**
  2. Click **Results** on any row; wait for the calls to fail
  3. Restore throttling to **No throttling**
- **Expected:** "Failed to load results" and "Failed to load
  positions" error text in the dialog — not the empty-state copy,
  no unhandled crash
- **Cleanup:** restore network throttling
- **Result/evidence:** PASS (user, 2026-11-22)

## Manual UI/UX refinement pass

- Dialog layout: stats grid legible, sparkline bounded, position rows
  aligned; sensible at narrow and wide viewport widths
- Loading → loaded transitions don't jump or overlap
- Results button visually consistent with the adjacent Start/Stop button
- Keyboard: Escape and the Close button both dismiss the dialog;
  tab order reaches Analysis
- **Real-mode row check:** Results is enabled on Real rows and honestly
  shows both empty states (paper-only data sources — v1 decision).
  Confirm acceptable, or flag for disable.
- **Result/evidence:** PASS (user, 2026-11-22) — layout legible,
  loading→loaded transitions clean, Escape + Close dismiss, Results
  consistent with adjacent Start/Stop; real-row Results acceptable
  (honest empty states, v1 paper-only data sources).

## Findings

- _none yet_

## Traceability

| Criterion | Scenario |
|---|---|
| Stats block via existing callables | S1 (+S6 error path) |
| Open-position summary | S3 (+S6) |
| Equity sparkline via existing callables | S2 |
| Analysis link → `/options/strategy/backtest/analysis/{instanceId}` new tab | S4 |
| Empty state | S5 |
| Specs mock callables; error/empty covered | Automated evidence |
| PRD US-7 (analysis in new tab, manage state survives) | S4 |
| Review-deferred: increment-minted doc tolerance | S1/S2 (any fresh instance) |
| Review-deferred: real-row Results behavior | Refinement pass |

## Regression / smoke

- [x] Start/Stop still toggles run state on a paper row — PASS
- [x] Sort + text/run-state/position filters still work — PASS
- [x] Create New Instance dialog still opens and previews ids — PASS
- [x] Create New Strategy dialog still opens — PASS
- [x] Only the table scrolls (bounded page contract from #1548) — PASS

## Verdict

**PASS** — S1–S6 green on live data; refinement pass complete;
regression smoke green. Ship-eligible.

## Results log

- 2026-11-22 — UAT doc created; automated evidence recorded
  (132/132 focused, 6,183/6,183 full, tsc clean)
- 2026-11-22 — all scenarios PASS (user-verified): S1 populated stats
  block, S2 sparkline absence verified data-driven (no equityCurve on
  increment-era docs — nightly recompute pending), S3 position row,
  S4 analysis new-tab + manage state preserved, S5 empty states,
  S6 offline error states; refinement pass complete incl. real-row
  Results disposition (acceptable — honest empty states); smoke green
