**Topic:** RH Scanner  
**Topic Slug:** savant-trader  
**Thread:** Scanner Row Actions  
**Thread Slug:** scanner-row-actions  
**Issue:** #1735  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Task:** #1730  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# UAT — #1730 FE-IMPL: scanner polish — popup volume pane, new-default filter, liquidity floor

## Scope

Three post-#1308 polish changes to the scanner page:

1. **Volume pane** — the untracked hover popup's candle chart gains a
   lower volume pane (~25% of the chart body, one column per bar,
   up/down-colored to match each candle). Symbols with no volume data
   get no strip — the lower pane collapses rather than rendering empty.
2. **`new` filter default** — the All/New/Tracked page filter now lands
   on `New` (the page exists to surface untracked hits). If the
   tracked-symbol universe fails to load, the filter snaps back to
   `All` instead of sitting on a disabled pill with masked counts.
3. **Liquidity floor** — every non-quality recipe carries
   `volumeAvg(candleCount=30, candlePeriod="1d") >= 250000`, weeding
   dead ETFs/SPAC stubs and thinly-traded names out of scan results
   entirely. Quality recipes keep their mcap + fundamental gates.

## Prerequisites

- Dev server already running: `http://localhost:4200`.
- RH observation service running and an authenticated Robinhood
  session.
- Real data: any recipe with rows (Daily Gainers is reliable
  mid-session). A `new`-badged row for the popup; the liquidity floor
  makes every returned row volume-bearing by construction.

## Getting to the feature

1. Open `http://localhost:4200/trading/scanner` (nav: **Scanner** in
   the trading nav strip).
2. Let the auto-run settle — or click **Run all**.
3. The All/New/Tracked pills sit in the page header; the recipe rail
   counts sit on the left; the `show_chart` popup is the rightmost
   icon in each detail-table row.

## Automated evidence

- New/changed specs — scanner suite **127/127 green**; full suite
  **6504/6504 (340 suites)**. Pins: `volumeColumns` million-scaling +
  up/down colors + skip policy, volume indicator emitted/omitted per
  volume presence, `mainPanePercent: 75`, `new` default + aria-pressed
  state, universe-error snap-back to `all`, non-quality recipes carry
  the `volumeAvg >= 250000` floor while quality recipes don't.

## Scenarios

### S1 — `new` is the active default filter

- Confirms: the page lands filtered to untracked symbols.
- Steps: hard-reload `http://localhost:4200/trading/scanner`.
- Expected: the `New` pill arrives active (not `All`); rail counts read
  filtered (`1 / 9`-style numerator < denominator); the detail table
  shows only `new`-badged rows on first paint.
- Result/evidence: **PASS** — user-verified: page lands on `New`;
  filtered counts and rows correct.

### S2 — Liquidity floor shrinks the rail

- Confirms: dead/thin names no longer reach scan results.
- Steps: click **Run all**; watch the rail counts and the returned rows.
- Expected: rail counts noticeably smaller than pre-floor runs; no
  ALLZ-class dead ETFs/SPAC stubs in any table; every recipe still
  returns hits (a `0 / 0` or error on a recipe that worked before
  flags the standalone `volumeAvg` filter form as unsupported).
- Result/evidence: **PASS** — user-verified: counts dropped, thin names
  gone, no recipe errors — `volumeAvg(...)` confirmed working as a
  standalone filter.

### S3 — Volume pane under the candles

- Confirms: the popup chart carries a volume strip.
- Steps: hover `show_chart` on a `new`-badged row.
- Expected: the candle chart renders with a volume strip along the
  bottom (~25% height); columns are up/down-colored to match each
  candle.
- Result/evidence: **PASS** — user-verified: strip renders, colors
  match candle direction, ~25/75 split looks right.

### S4 — Filter round-trip

- Confirms: the non-default filters still work.
- Steps: click `Tracked`, then `All`, then `New`.
- Expected: each click swaps rail counts and table contents correctly;
  `New` restores the filtered view.
- Result/evidence: **PASS** — user-verified: all three pills
  round-trip cleanly.

### S5 — Volume pane collapses with no volume data (conditional)

- Confirms: a symbol with no volume gets a clean full-height chart,
  not an empty strip.
- Steps: hover `show_chart` on a row whose symbol has no volume data.
- Expected: chart renders without a lower pane.
- Result/evidence: **N/A** — unfindable post-floor: every returned row
  has ≥ 250K avg 30d volume by construction. Spec-pinned (`bars without
  volume emit no volume indicator — the lower pane collapses`).

## Manual UI/UX refinement pass

- Volume pane proportions: user-confirmed the 75/25 split "looks
  really good" at the 660×400 popup size.
- Volume column colors: user-verified up/down colors match candle
  direction under the active palette.
- New default: no visual regression — the `New` pill's active state
  renders identically to the clicked state pre-change.

## Findings

None.

## Traceability

| Acceptance | Scenario |
|---|---|
| Volume pane along the bottom in a separate pane, up/down-colored | S3 |
| No volume data → no empty strip | S5 (spec-pinned, unfindable post-floor) |
| `new` is the default filter | S1, S4 |
| Universe error doesn't strand the page on a disabled pill | spec-pinned (needs forced Firestore failure to exercise live) |
| Dead/thin names weeded out of scan results | S2 |
| Quality recipes keep their mcap gates | catalog spec |

## Regression / smoke

- [x] Candle chart + SMA overlays still render (S3 — observed alongside
      the new pane)
- [x] Rail counts / tickers unaffected in shape — only magnitudes
      changed (S2)
- [x] Filter pill disabled-during-loading behavior unchanged (masked
      counts while the universe loads — existing readiness gate)

## Verdict

**PASS** — all applicable scenarios verified by the user on the live
app; S5 unfindable by construction (spec-pinned); universe-error
snap-back spec-pinned.

## Results log

| Date | Scenario | Result | Evidence |
|------|----------|--------|----------|
| 2026-11-24 | S1–S5 + refinement | **PASS** | user-verified live; S5 N/A (post-floor unfindable); error snap-back spec-pinned |
