**Topic:** RH Scanner  
**Topic Slug:** savant-trader  
**Thread:** Scanner Row Actions  
**Thread Slug:** scanner-row-actions  
**Issue:** #1743  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Task:** #1309  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-25  
**Last Updated:** 2026-11-25  

# UAT — #1309 FE-IMPL: tracked-mode popup — gallery card chart embed

## Scope

The `data-mode="tracked"` fork of the row `show_chart` popup, live since
#1307 as a permanent loading shell, now mounts
`app-gallery-card-chart` — the standard gallery card chart — fed a
fabricated minimal `GalleryCard` (`scan-{symbol}` key, the symbol, empty
occurrences). Tracked symbols already live in the gallery domain, so the
popup inherits the card chart's whole feature set: multi-pane daily
config (trend bands, zone panes, HTF window), per-card D/W chip, ±50
visible-bar chips, symbol chip, and its own loading/unavailable
placeholders. `GalleryCardChartStore.ensureBars(symbol)` warms on popup
open (the card's own mount effect also ensures — the call is a
render-warming prefetch), gated on non-auth state so a dead session
can't burn the store's terminal dedupe slot. No toolbar actions —
chart only. The untracked fork (candle + SMA + volume, #1308/#1730) is
unchanged.

## Prerequisites

- Dev server already running: `http://localhost:4200`.
- RH observation service running and an authenticated Robinhood
  session (the gallery bar path reads real Firestore-cached bars).
- A `tracked`-badged row: flip the page filter pill to **Tracked** —
  any row shown is tracked. If no scan run has tracked hits, file one:
  hover a `new` row's list menu, assign it to **PRIMARY** — the row
  flips to `tracked` in place.
- A `new`-badged row for the fork-regression check (S4).

## Getting to the feature

1. Open `http://localhost:4200/trading/scanner` (nav: **Scanner** in
   the trading nav strip).
2. Let the auto-run settle — or click **Run all**.
3. Click the **Tracked** pill in the page header (or file a `new` row
   to PRIMARY as above).
4. Hover the `show_chart` icon (rightmost in the detail-table row) —
   the popup anchors beside the row.

## Automated evidence

- Popup spec **26/26** — tracked block: mounts `app-gallery-card-chart`
  (not the candle path), calls `ensureBars` with the symbol, feeds
  `scan-AAPL`/`AAPL`/empty-occurrences card, auth shell wins + emits,
  no ensure under the auth shell → warms on release, error shell passes
  through.
- Table spec **54/54** — traced: tracked row → overlay opens with
  `data-mode="tracked"` + the card chart mounted.
- Full suite **342/342 suites, 21,810 tests**; `tsc` clean.
- Code review `1098-1302-1309-CODE-REVIEW-FE-rh-scanner.md` — PASS
  (1 major fixed in-gate: auth-window dedupe burn).

## Scenarios

### S1 — Tracked row mounts the gallery card chart

- Confirms: the tracked fork renders the real card chart, not a shell.
- Steps: on a `tracked`-badged row, hover `show_chart`.
- Expected: a multi-pane daily chart — the gallery card configuration
  (trend bands on the price pane, zone panes below), NOT the
  candle + SMA + volume view `new` rows get. A symbol chip sits
  top-left; chip groups sit top-right.
- Result/evidence: **PASS** — user-verified live

### S2 — Card-local chips work inside the popup

- Confirms: the card's own chrome is functional, card-local.
- Steps: inside the tracked popup, click **W** on the D/W chip, then
  **+50** / **−50** on the visible-bars chips.
- Expected: W switches to the weekly pane set (and back with D); the
  ±50 chips widen/narrow the visible window without affecting other
  cards; no scanner-side timeframe control appears.
- Result/evidence: **PASS** — user-verified live

### S3 — Chart only — no gallery actions

- Confirms: no toolbar/decision chrome leaks into the popup.
- Steps: inspect the tracked popup end to end.
- Expected: chart + chips only — no assign/reject buttons, no ticket
  status chrome, no card header/footer from the gallery card.
- Result/evidence: **PASS** — user-verified live

### S4 — Untracked fork unbroken

- Confirms: `new` rows still get the on-demand candle chart.
- Steps: hover `show_chart` on a `new`-badged row.
- Expected: candle chart + three MA lines + volume strip (the
  #1308/#1730 view), unchanged.
- Result/evidence: **PASS** — user-verified live

### S5 — Auth path: affordance shows, chart heals after reauth

- Confirms: a dead session surfaces reauth, and the card recovers.
- Steps: only exercisable with an expired RH session — if the auth
  banner is already up, hover `show_chart` on a tracked row; click
  Re-authorize; after the session restores, re-hover the same row.
- Expected: the popup shows the reauth affordance (not a dead frame);
  post-reauth the card chart loads normally — no stuck "chart
  unavailable" (the dedupe-slot guard verified in specs).
- Result/evidence: **N/A** — no live auth outage reachable during UAT;
  spec-pinned (no ensure under the auth shell; warms on release)

## Manual UI/UX refinement pass

- [x] Card chart fills the popup body (660×400) cleanly — controls not
      clipped, chips readable, panes proportioned
- [x] Symbol chip legible over the chart; loading placeholder shows
      during fetch, never a blank frame
- [x] Popup close grace still travels pointer→popup on the tracked fork

## Findings

- [ ] (record findings here)

## Traceability

| Acceptance | Scenario |
|---|---|
| Tracked popup embeds `app-gallery-card-chart` on a fabricated minimal `GalleryCard` | S1 (+ spec) |
| `GalleryCardChartStore.ensureBars` on open; card's mount effect also ensures | spec-pinned (call asserted); S1 warm path |
| Daily default from root `GalleryUiStore`; D/W chip card-local; no scanner-side control | S2 |
| No gallery toolbar actions — chart only | S3 |
| Specs per TEST-FE §5 | Automated evidence |
| Untracked fork unchanged | S4 |
| Auth failure → reauth affordance; post-reauth recovery | S5 |

## Regression / smoke

- [ ] `new` row popup: candle + MA + volume strip (S4)
- [ ] Popup close grace / one-popup-at-a-time / recipe-switch teardown
      unchanged (chrome is #1307's, untouched)
- [ ] Gallery page cards unaffected — shared store reads only;
      `ensureBars` dedupes by symbol

## Verdict

**PASS** — S1–S4 + all refinement checks user-verified live ("lgtm");
S5 unexercisable without a live auth outage (spec-pinned).

## Results log

| Date | Scenario | Result | Evidence |
|------|----------|--------|----------|
| 2026-11-25 | S1–S4 + refinement | **PASS** | user-verified live ("lgtm") |
| 2026-11-25 | S5 | **N/A** | no live auth outage; spec-pinned |
