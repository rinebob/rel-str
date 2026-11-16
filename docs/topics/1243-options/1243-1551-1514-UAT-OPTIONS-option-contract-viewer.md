**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1551  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1514  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# UAT — #1514 Armed-brush cursor-date feedback

## Scope

Bug: arming **Select study range** killed all date feedback — the
capture overlay swallowed Syncfusion's mousemove, so crosshair,
tooltips, and the top-edge date tag all died while picking a bound.

Fix: the armed capture layer now feeds the cursor category itself — a
vertical cursor line + the top-edge date tag track hover AND drag, and
a live `{start} – {end}` label on the drag rect previews the
corpus-snapped dates the gesture will emit.

**Acceptance criteria (issue body):**

1. While the brush is armed, the chart shows cursor-date feedback
   (crosshair or live date tag) during hover.
2. Same during drag — the user can pick start/end precisely.
3. No regression to unarmed hover (Syncfusion crosshair/tooltip) or to
   the bound-emit path.

## Prerequisites

- Dev server running: `npm start` → `http://localhost:4210` (check the
  `Local:` line — the script picks a free port).
- A symbol with a loaded plotted set — these steps use **QQQ** with the
  three corpus-verified contracts (from prior UATs, confirmed live):

  | Contract id | Verified observation window |
  |---|---|
  | `QQQ261016C00710000` | 2026-03-24 → 2026-10-16 (144 obs) |
  | `QQQ261016P00710000` | same expiry, put side |
  | `QQQ260331C00440000` | series starts 2025 (long history) |

## Getting to the feature

- **Route:** `/options/chart`
- **Entry point:** Sidenav → **Options** → **Chart**
- **Landing surface:** left drawer (symbol input, contract list,
  catalog query, group generator) + chips column + full-height chart.
- **Setup:** symbol = `QQQ` (top of left drawer). Paste these three
  lines into the contract list textarea and click **Load contracts**:

```
QQQ261016C00710000
QQQ261016P00710000
QQQ260331C00440000
```

  Three mark lines + chips render. The brush arm button is
  **Select study range** in the chart toolbar.

## Test scenarios

### S1 — Armed hover: cursor line + date tag

1. With the three contracts plotted, click **Select study range**.
   - **Expect:** cursor line (thin vertical rule) tracks the pointer
     across the plot; the top-edge date tag follows, showing the
     hovered date — e.g. hovering around Aug reads `2026-08-*`.
   - Before the fix: nothing tracked — picking was blind.
   - **Result:**

### S2 — Mid-drag: live resolved edge dates

1. Still armed, mousedown ~mid-chart and drag leftward a few weeks.
   - **Expect:** the drag rect shows a `{start} – {end}` label (e.g.
     `2026-07-13 – 2026-08-24`); the date tag keeps tracking the moving
     edge. The label dates are the snapped dates mouseup will emit —
     not just the raw axis label under the cursor.
   - **Result:**

### S3 — Corpus snapping: label previews the emit

1. First populate the availability corpus: in the left drawer's catalog
   query, run any search (e.g. symbol QQQ, calls, exp 2026-10-16 →
   2026-10-16, strike 700–720 → hits `QQQ261016C00710000`).
2. Arm the brush; drag a span whose edges fall between fetched dates.
   - **Expect:** the rect label's edges snap to corpus dates (the
     availability domain), which may differ a day from the axis label
     under the cursor — both readouts are truthful (cursor category vs.
     committed bound).
3. Mouseup.
   - **Expect:** the emitted bound equals the label's dates exactly.
   - **Result:**

### S4 — Dismissal paths

1. Armed, hover → move the pointer off the chart.
   - **Expect:** cursor line + tag hide (float data-window mode).
2. Re-hover, mousedown mid-drag → press Esc.
   - **Expect:** drag cancelled, brush disarmed, no bound emitted.
3. Re-arm, hover, then click **Select study range** again to disarm.
   - **Expect:** cursor line hides; normal Syncfusion crosshair/tooltip
     resume.
   - **Result:**

### S5 — Anchor data-window mode

1. Toggle the data-window control (chart toolbar) to **anchor** (panel
   pinned top-left).
2. Arm the brush → hover a contract area.
   - **Expect:** the pinned panel populates at the hovered date while
     armed (value feedback, not just date).
3. Move the pointer off the chart; then disarm.
   - **Expect:** panel + tag keep the last hovered category (anchor
     semantics — the panel must stay populated to scroll into).
   - **Result:**

### S6 — Bound commit regression

1. Disarm → re-arm → drag a real span (e.g. 2026-07-01 → 2026-08-31)
   → mouseup.
   - **Expect:** the bound lands exactly as labeled; out-of-bound
     contracts hide/dim per #1389; **Clear study range** restores.
   - **Result:**

## Manual UI/UX refinement pass

- [ ] Cursor line is visible but not heavy — reads as a guide, not a grid line
- [ ] Date tag + rect label legible over the rect's tinted band; no overlap/flicker
- [ ] Label doesn't obscure the drag edges while picking
- [ ] Hover → drag → release motion feels continuous, no popping

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Cursor-date feedback during armed hover | S1 |
| Same during drag (precise start/end) | S2, S3 |
| Bound emit unchanged (snap/commit regression) | S3, S6 |
| Unarmed hover / dismissal paths intact | S4 |
| Anchor mode keeps its contract while armed | S5 |

## Regression smoke

- [ ] Unarmed: Syncfusion crosshair + shared tooltip behave as before
- [ ] Data-window mode cycle (float → anchor → hidden) still works
- [ ] Zoom/pan (wheel + drag-unarmed) unaffected
- [ ] Chip hover/pin highlight unaffected while unarmed

## Results log

| Scenario | Result | Evidence |
|---|---|---|
| Automated: options-contract-chart + option-chart suites | PASS | `npx jest` 200/200 (2026-11-14) — 9 new cursor-feedback specs incl. anchor keep + armed panel |
| S1 armed hover | PASS | User-confirmed 2026-11-14 — cursor line + date tag track the pointer |
| S2 mid-drag edge dates | PASS | User-confirmed 2026-11-14 — live `{start} – {end}` label on the rect |
| S3 corpus snap preview | PASS | User-confirmed 2026-11-14 — emitted bound matches label exactly |
| S4 dismissal paths | PASS | User-confirmed 2026-11-14 — leave/Esc/toggle-off all behave |
| S5 anchor mode | PASS | User-confirmed 2026-11-14 — panel populates armed, keeps last category |
| S6 bound commit regression | PASS | User-confirmed 2026-11-14 — bound lands + clears per #1389 |
| Refinement pass | PASS | User-confirmed 2026-11-14 — "just what i wanted" |
| Regression smoke | PASS | User-confirmed 2026-11-14 — unarmed hover/tooltip/zoom/chips intact |
