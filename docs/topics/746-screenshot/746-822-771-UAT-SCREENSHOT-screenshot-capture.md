**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #822  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Task:** #771  
**Domain:** SCREENSHOT  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-06  

# UAT — #771: Layout playground variants + zoom + renderOnly

## Scope

Card-layout playground on `/dev/screenshot`: per-width re-rendered
variants (Full / 480px / 320px / ~1.9in) that preserve native bar width
and show fewer bars off the right end; per-artifact zoom→last-15-bars
toggle; `renderOnly` contract (playground calls never write GCS);
geometry-scoped clip ids; per-interval variant calibration (the
failed-precondition fix).

## Prerequisites

- Dev server running: `npm start` → http://localhost:4200
- Signed in (`authGuard`ed route)
- `captureChartSnapshot` deployed — **the post-review remediation needs a
  redeploy for the min-dimension floor, but the per-interval variant fix
  is frontend-only**; the deployed callable already honors `renderOnly`
- Symbol with deep cache, e.g. `GOOG`

## Scenarios

### 1. Variant rows — count, stacking, framing
- Capture GOOG with defaults (D+W, Store checked).
- **Expected:** under each artifact (daily, weekly) four stacked rows:
  Full / 480px / 320px / ~1.9in card, each bordered with padding — not
  crammed, not cut off at the chart edge.

### 2. Native bar width — fewer bars, same scale
- Compare the 180px card against the Full row's right edge.
- **Expected:** same bar pixel-width and same height; the narrow card is
  a right-side window (end of chart + y-axis preserved), NOT a shrunken
  copy. Text is full-size, not squashed.

### 3. Pane separation at every size
- Inspect the 320px and 180px rows.
- **Expected:** main pane clipped to its own area; trend-strength/zone
  panes render below it — no main-pane content bleeding over the lowers.

### 4. Zoom — last 15 bars, rescale, restore
- Click "Zoom last 15 bars" on the daily artifact.
- **Expected:** after a beat the full row swaps to a 15-bar render with
  y-axis rescaled to that window; narrow variants slice the zoomed
  render. Click again → original render restored. Weekly untouched.

### 5. Zoom per-artifact
- Zoom weekly, confirm daily unchanged (and vice versa).

### 6. renderOnly — playground never writes
- Capture with **Store to GCS** checked; note the primary's paths.
- **Expected:** only the primary capture writes artifacts. (Directly
  verifiable via `gsutil ls` on the timestamped prefix if desired — unit
  tests cover the flag emission.)

### 7. 'all' + weekly thin-data placeholder (post-remediation)
- Set Visible bars = `all`, capture.
- **Expected:** primary shows the full cached series; narrow variants
  that exceed an interval's bar count keep the right-slice placeholder
  WITHOUT an error banner overwriting the page (previously every variant
  failed with failed-precondition).

### 8. Stale-response guard
- Click zoom, then immediately hit Capture again while it's pending.
- **Expected:** when the old zoom response lands it does not paint into
  the new capture's cards.

### 9. Regression — primary capture + errors + scroll
- Re-run #770 UAT scenarios 2, 5, 6 briefly: default capture renders +
  paths when stored; a bad symbol still shows the typed error; page
  scrolls.

## Refinement pass

- Variant rows read as distinct sizes; labels legible; zoom button
  affordance clear; spacing consistent in dark/light themes.

## Traceability

| AC | Scenario |
|---|---|
| 3-5 variants, same capture, different sizes incl. ~1-2in | 1, 2 |
| Zoom = last ~15 bars fresh render + restore | 4, 5 |
| Daily + weekly | 4, 5 |
| renderOnly / no playground GCS writes | 6 |
| Per-interval calibration fix | 7 |
| Stale-response guard | 8 |
| Clip-id pane separation | 3 |

## Results

| # | Result | Evidence |
|---|---|---|
| 1 | PASS | User-verified: 4 stacked framed variant rows per artifact |
| 2 | PASS | User-verified: native bar width, fewer right-side bars, unsquashed |
| 3 | PASS | User-verified: pane separation at all sizes |
| 4 | PASS | User-verified: 15-bar re-render + rescale + restore |
| 5 | PASS | User-verified: per-artifact zoom isolation |
| 6 | PASS | Unit-tested flag emission; user-accepted |
| 7 | PASS | User-verified: placeholders hold, no banner stomp |
| 8 | PASS | User-verified: no stale paint on resubmit |
| 9 | PASS | User-verified: #770 regressions hold |
