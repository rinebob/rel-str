**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1559  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1515  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# UAT — #1515 Pin is a chip bookmark, not a chart highlight

## Scope

Bug: clicking a chip's pin kept the series lit and dimmed every other
plotted line until the pin was removed — the store's
`highlightedContractId` fell back from hover to the pin.

Fix: the pin is now a **chip-strip bookmark** — a `.pinned` style +
`push_pin` icon that marks the user's place while scrolling the chips
column. It never reaches the chart: `highlightedContractId` forwards
hover only (still suppressed under focused drill-down). Chip hover
highlight is unchanged.

**Acceptance criteria (issue body):**

1. A pinned chip shows the bookmark (push_pin icon + `.pinned` styling)
   but the chart is NOT highlighted — no series lit, none dimmed.
2. Hovering a chip still highlights its series (unchanged hover
   behavior).
3. The pin survives as a bookmark where the contract survives — it's a
   chip-strip position marker, not chart state.

## Prerequisites

- Dev server running: `npm start` → `http://localhost:4210` (check the
  `Local:` line — the script picks a free port).
- A symbol with **3+ plotted contracts** so dimming is easy to see —
  use **QQQ** with the catalog-query or generator flow already in the
  drawer (pick several strikes/dates → Send to chart).
- No focused single-contract view unless a scenario says so.

## Getting to the feature

- **Route:** `/options/chart`
- **Entry point:** app nav → the options/chart page link (same page
  used throughout the #1243 thread).
- **Surface:** chart centered, the **chips column on the right** —
  one chip per plotted contract, each with hover highlight and a
  click-pin affordance (push_pin icon on the pinned chip).

## Test scenarios

### S1 — Pin shows the bookmark without touching the chart

1. With 3+ contracts plotted, **click a chip** to pin it.
2. **Expect:** the chip shows the `push_pin` icon and `.pinned` style.
   The chart is **unchanged** — every line at normal opacity, none lit,
   none dimmed.
3. **Result:** PASS — user confirmed (2026-11-15)

### S2 — Hover still highlights (unchanged)

1. **Hover a different chip** (pointer over it, no click).
2. **Expect:** that chip's series lights up on the chart; the other
   lines dim — exactly the pre-#1515 hover behavior.
3. Move the pointer off the chip strip.
4. **Expect:** highlight clears; all lines back to normal.
5. **Result:** PASS — user confirmed (2026-11-15)

### S3 — Pin is a scroll bookmark, not a light

1. With the chip pinned (from S1), **scroll the chips column** so the
   pinned chip moves out of view and back.
2. **Expect:** the pinned chip keeps its pin icon + `.pinned` style —
   the bookmark marks your position. The chart stays unlit the whole
   time (this was the bug: it used to keep one line lit + dim the
   rest).
3. **Result:** PASS — user confirmed (2026-11-15)

### S4 — Unpin restores the plain chip

1. **Click the pinned chip again** (same chip).
2. **Expect:** pin icon + `.pinned` style gone; chart unchanged (it was
   never lit).
3. **Result:** PASS — user confirmed (2026-11-15)

### S5 — Pin survives a set reload when the contract does

1. Pin a chip, then **re-send the same contract set** from the
   generator/picker (same contracts re-emitted).
2. **Expect:** the pinned contract's chip **still carries the
   bookmark** after the reload (the review changed this: reloads no
   longer destroy a still-valid pin).
3. Repeat with a **re-emit that excludes** the pinned contract.
4. **Expect:** the pin is cleared — no bookmark on a contract that left
   the set.
5. **Result:** PASS — user confirmed (2026-11-15)

### S6 — Focused single-contract view: bookmark survives, chart unlit

1. Pin a chip, then open that contract's **focused single view**
   (chip focus affordance).
2. **Expect:** the focused chart shows just that series — no highlight
   dimming artifacts. Return to the set view.
3. **Expect:** the chip still carries the bookmark; the set chart is
   normal.
4. **Result:** PASS — user confirmed (2026-11-15)

### S7 — Study-range bound: pinned chip outside the bound stays dark

1. Pin a chip, then arm **Select study range** and set a bound that
   **excludes** the pinned contract's picks (chip still renders —
   bound-hidden).
2. **Expect:** the chip keeps its bookmark, but no chart series lights
   or dims (the `chartHighlight` displayed-set gate holds — a hidden
   chip can't dim the visible set).
3. **Clear the bound.**
4. **Expect:** bookmark still on the chip; hover it → its series
   lights again.
5. **Result:** PASS — user confirmed (2026-11-15)

### S8 — Refinement pass (visual)

1. Compare a pinned chip vs a hovered chip vs a normal chip side by
   side: the pin reads as a **bookmark** (icon + style on the chip
   only), never confused with the hover-lit state.
2. Chip tooltip on a pinned chip reads "Unpin" / on an unpinned chip
   "Click to pin" — no "highlight" wording.
3. **Result:** PASS — user confirmed (2026-11-15)

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| AC1 — pinned chip shows bookmark, chart not highlighted | S1, S3 |
| AC2 — hover still highlights | S2, S5 |
| AC3 — pin survives as bookmark where contract survives | S3, S5, S6, S7 |
| Hidden-chip can't dim the set (guard regression) | S7 |
| Focused drill-down stays clean | S6 |
| Refinement / visual consistency | S8 |

## Regression / smoke checklist

- [x] Hover-highlight + dim on the multi-contract chart unchanged
- [x] Focused single-contract view renders normally
- [x] Study-range bound filter still hides/shows chips and clips the
      chart window
- [x] Chip strip scroll, pin icon, tooltip copy correct

## Findings

- None.

## Results log

- 2026-11-15 — UAT drafted for QA issue #1559.
- 2026-11-15 — S1–S8 all PASS (user-confirmed). Regression smoke clean.
  QA gate cleared — #1559 closed RESOLVED.