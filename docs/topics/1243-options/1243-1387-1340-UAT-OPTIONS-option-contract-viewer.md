**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1387  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1340  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-03  
**Last Updated:** 2026-11-03  

# UAT — Task #1340 (FE: Chart study-range brush overlay)

## Scope

A custom drag-brush overlay on the multi-contract option chart. The user arms
a brush from the chart header, drags a study range across the plot, and the
snapped `{start,end}` range routes into the generator drawer's alive-range
refinement. The brush never mutates the Syncfusion axis — it is a decorative
DOM overlay. Covered: arming/disarming, drag + snapping + emission, the
active-bound band, hover suppression, and all documented edge cases.

## Prerequisites

- Dev server running (`npm start` → `http://localhost:4210`; the app must be
  started with the observation API on `127.0.0.1:3456` for data calls).
- Logged in; a symbol with option data (e.g., `SPY`) loaded on
  `/options/chart` with at least one contract plotted. Paste
  `date,contractId` lines into the contract textarea and click **Load** if
  the chart is empty.
- The generator drawer (right sidenav) reachable; **Run** executed at least
  once for the corpus-snap scenarios (drawer fetch populates `corpusDates`).
- A normal desktop mouse. Touch-only devices are out of scope (documented
  design constraint).

### Seed contract IDs

Load **QQQ** — all IDs below were exercised against the backend in earlier
UATs. Paste any set into the contract textarea and click **Load**.

Set A — smallest verified pair (#1360 UAT; repeated dates exercise the
one-series/marker-dot-per-date path):

```text
2026-05-01,QQQ261016C00710000
2026-08-03,QQQ261016C00710000
2026-09-01,QQQ261016C00710000
QQQ261016P00710000
```

Set B — dated strike ladder (#1264 UAT; several lines + clip-to-entry dots):

```text
2025-07-01,QQQ260331C00440000
2025-07-15,QQQ260331C00450000
2025-08-01,QQQ260331C00460000
2025-08-15,QQQ260331C00470000
2025-09-01,QQQ260331C00480000
2025-09-15,QQQ260331C00450000
QQQ260331P00440000
QQQ260331P00455000
QQQ260331P00460000
```

Set C — widest date range (best for seeing the band span a broad domain).
Caveat: the `QQQ260630P…` puts weren't explicitly verified in the UATs —
drop any line that errors; the calls and `QQQ260331` puts are confirmed:

```text
2025-07-01,QQQ260630P00400000
2025-07-15,QQQ260630P00425000
2025-08-01,QQQ260630P00450000
2025-08-15,QQQ260630P00475000
2025-09-01,QQQ260630P00500000
QQQ260630C00400000
QQQ260630C00450000
QQQ260630C00500000
QQQ260331C00455000
QQQ260331P00455000
```

## Start instructions

1. `npm start` → open `http://localhost:4210/options/chart`.
2. Ensure a symbol is loaded and the option chart shows plotted series.
3. The **Select range** button sits in the chart header bar immediately right
   of the **Clip to entry** / **Full series** toggle.

## Test scenarios

Mark each result: PASS / FAIL / BLOCKED, with evidence.

### S1 — Arm and disarm (button, cursor, pressed state)

- **Feature:** Brush-mode toggle.
- **Start:** Chart loaded, brush disarmed.
- **Steps:** (a) Click **Select range**. (b) Hover the chart plot. (c) Click
  **Select range** again. (d) Re-arm, then press **Esc** with the brush idle.
- **Expected:** Button shows pressed/active state while armed; `aria-pressed`
  toggles; cursor becomes `crosshair` over the chart; re-click and idle Esc
  both disarm and restore the normal cursor.
- **Result:** PASS — user-verified on dev server 2026-11-03

### S2 — Forward drag → snapped range emitted

- **Feature:** Drag → selection rect → `(studyRange)` emit.
- **Start:** Brush armed; generator drawer open; a corpus fetched (Run done).
- **Steps:** Press the left mouse button inside the plot near the left edge,
  drag right across several weeks, release inside the plot.
- **Expected:** A dashed selection rect tracks the drag spanning the full
  plot column vertically (NOT the axis-label strip); its edges **live-snap**
  to the resolved dates while dragging, so the rect previews exactly what
  will emit. On release the drawer shows **Alive across `start → end`**
  with `start`/`end` snapped to the nearest corpus dates; a faint band
  paints over that range behind the series; preview rows narrow **with no
  network call**. (Live snap added during QA — the rect previously tracked
  raw px and only the emitted range snapped.)
- **Result:** PASS — user-verified on dev server 2026-11-03

### S3 — Reverse drag produces an ordered range

- **Feature:** Reverse-direction drag.
- **Steps:** Re-arm if needed; drag right→left across a different span and
  release.
- **Expected:** Emitted bound is ordered (`start ≤ end`), not inverted;
  band and chip update to the new range.
- **Result:** PASS — user-verified on dev server 2026-11-03

### S4 — Band renders, clears, and tracks geometry

- **Feature:** Active-bound band.
- **Start:** A bound applied from S2/S3.
- **Steps:** (a) Note the faint band over the bound. (b) Wheel-zoom or pan
  the chart (disarm first — see refinement notes). (c) Resize the browser
  window. (d) Click the drawer's `×` clear button on the **Alive across**
  row.
- **Expected:** Band follows the same date range after zoom/pan and resize;
  clearing the chip removes the band entirely.
- **Result:** PASS — user-verified on dev server 2026-11-03

### S5 — Corpus snap vs axis-label fallback

- **Feature:** Snap source selection.
- **Steps:** (a) With the drawer fetched, drag a range and release — confirm
  emitted dates equal corpus members (dates present in the drawer's
  observations). (b) On a fresh symbol where the drawer has never run,
  arm + drag — confirm the range still resolves to visible axis-label dates.
- **Expected:** Corpus present → snap to corpus members; absent → snap to
  axis labels; no error either way.
- **Result:** PASS — user-verified on dev server 2026-11-03

### S6 — Out-of-domain clamping

- **Feature:** Gutter/edge clamping.
- **Steps:** Arm; start a drag inside the plot and continue past the right
  plot edge into the margin before releasing; repeat off the left edge.
- **Expected:** Edges clamp to the axis domain — the emitted bound stays
  within the visible date range; no error range or crash.
- **Result:** PASS — user-verified on dev server 2026-11-03

### S7 — Cancellation paths

- **Feature:** Esc / mouseleave / disarm mid-drag.
- **Steps:** (a) Arm; begin a drag; press **Esc** mid-drag → rect disappears,
  no new bound. (b) Begin a drag; move the pointer outside the chart wrap →
  rect disappears, no emit. (c) Begin a drag; click **Select range** to
  disarm mid-drag → gesture dropped; re-arm → a fresh drag works normally.
- **Expected:** Each path cancels without emitting; exactly one active
  gesture at a time.
- **Result:** PASS — user-verified on dev server 2026-11-03

### S8 — No Syncfusion axis mutation

- **Feature:** Axis immutability.
- **Steps:** Zoom/pan the chart to a non-default visible window (disarmed);
  re-arm; complete a brush drag; disarm; inspect the visible window.
- **Expected:** Visible range, zoom factor, and scroll position identical
  before and after the brush gesture; no `selectionMode` rectangle, no axis
  min/max writes (dev: `axisCollections[0]` fields unchanged).
- **Result:** PASS — user-verified on dev server 2026-11-03

### S9 — Connected-hover suppression and resumption

- **Feature:** Hover dimming interplay.
- **Steps:** (a) Disarmed, hover a contract series → connected-hover dims
  siblings. (b) Arm the brush; hover the same series → no dimming. (c)
  Disarm; hover again → dimming resumes.
- **Expected:** Dimming suppressed while armed (a highlighted contract at
  arm time is released, not frozen); normal hover behavior restored on
  disarm.
- **Result:** PASS — user-verified on dev server 2026-11-03

### S10 — Brush over an underlying-only chart

- **Feature:** No plotted contracts.
- **Start:** A symbol with underlying data but **no** contracts plotted.
- **Steps:** Arm the brush; drag across the underlying chart's date domain.
- **Expected:** Drag allowed; emitted bound snaps to the underlying axis
  domain (TEST edge case: brush armed while chart is empty → allowed).
- **Result:** PASS — user-verified on dev server 2026-11-03

### S11 — G3 journey — alive-range refines the preview

- **Feature:** End-to-end store routing (TEST journey G3).
- **Start:** Drawer open with a fetched corpus and preview rows.
- **Steps:** Arm; drag a sub-range; observe preview; toggle **open date**
  linking on if present.
- **Expected:** Preview narrows to contracts alive across the bound with no
  new network call; open date backfills when the link toggle is on; clearing
  the bound restores the full preview.
- **Result:** PASS — user-verified on dev server 2026-11-03

### S12 — Same-day bound

- **Feature:** `start === end` bound.
- **Steps:** Drag a very short span that snaps both edges to the same date
  (a bare click is suppressed by the <2px threshold — make a small visible
  drag instead).
- **Expected:** Bound accepted; band renders as a ~1px sliver at that date
  rather than disappearing silently.
- **Result:** PASS — user-verified on dev server 2026-11-03

## Negative / boundary notes

- Right-click while armed must NOT apply a bound; a right-button release
  mid-left-drag must not commit a partial range.
- A bare click (<2px movement) must NOT apply a same-day bound.
- Esc pressed while focus is inside a drawer field/datepicker will also
  disarm the brush (document-level scoping) — flag if objectionable.
- While armed, wheel-zoom/pan/legend are unreachable (capture layer covers
  the chart); touch gestures are unsupported — both are the intended
  contract; flag if objectionable.

## Automated verification (executed 2026-11-03)

- `npx jest` focused combo (brush utils, chart component, page, generator,
  store): **112/112 PASS** across 5 suites.
- `npx tsc --noEmit -p tsconfig.app.json` and `-p tsconfig.spec.json`:
  **clean**.
- `npx ng build --configuration production`: **green** (pre-existing
  `papaparse` CommonJS warning only).
- Route smoke: `GET http://localhost:4210/options/chart` → **200**.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Brush toggle arm/disarm; Esc; cursor change | S1, S7 |
| Drag → own selection rect via px→category→date | S2, S3 |
| Snap to corpusDates; axis-label fallback | S2, S5 |
| Emit `(studyRange)`; never mutate axis | S2, S8 |
| Active bound = faint band; clears | S4, S12 |
| Hover dimming suppressed armed; resumes disarmed | S9 |
| Clamp out-of-domain drags | S6 |
| Cancel paths (Esc/mouseleave/re-arm) | S7 |
| Brush over empty/underlying-only chart | S10 |
| G3: alive-range refines preview; open-date fill | S11 |

## Regression / smoke checklist

- [ ] **Clip to entry** / **Full series** toggle still clips series.
- [ ] Connected hover / dimming works normally when brush is disarmed.
- [ ] Wheel-zoom, pan, scroll-end behavior unchanged when disarmed.
- [ ] Legend show/hide unchanged when disarmed.
- [ ] Multi-pane layout (price/IV/Greeks/volume) renders unchanged.
- [ ] Symbol switch clears brush state cleanly; generator config swaps per
      symbol (G4 unaffected).
