**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Extend Gallery UI to Portfolio Page  
**Thread Slug:** portfolio-gallery-view  
**Issue:** #976  
**Thread Parent:** #926  
**Topic Parent:** #219  
**Task:** #952  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-12  
**Last Updated:** 2026-10-12  

# UAT — position card chart (#952)

## Scope

Task #952 mounts the real card chart inside every position card:
`position-card-chart` (cloned-and-adapted from `gallery-card-chart`) —
shared `GalleryCardChartStore` bars + `IndicatorSeriesStore` indicators,
mount-queue paced, `@defer (on viewport)` creation, per-card D/W and ±50
chips, header-pill resync via `chartTimeframeSeq`, mount-once latch
(scroll-out keeps the chart mounted — accepted refinement; the gallery's
viewport-unmount flashed/reflowed on re-entry). Entity boundary: the
chart binds `symbol` only — no `GalleryCard`, no occurrence dots.
Earlier scenarios (card meta, badges, grouping, states) are covered by
`219-969-951-UAT-…` — this doc covers the chart cell delta.

## Prerequisites

- Dev server running: `npm start` (or reuse an existing session) →
  `http://localhost:4200`
- Logged in; at least one agentic-enabled account with ≥2 live equity
  positions (enough cards to scroll)
- Chrome DevTools optional (scenario 7's negative path is otherwise
  unobservable)

## Start

Navigate to `http://localhost:4200/portfolio-v2`.

## Scenarios

### 1. Charts render in every card cell

**Feature:** `position-card-chart` mount + shared bars.  
**Steps:** Load `/portfolio-v2` (Group = None). Scroll the grid slowly to
the bottom.  
**Expected:** each card's chart cell paints a price chart with the
default ST indicator set (trend bands, trend-strength pane, zone V1/V2
panes, weekly HTF window, StdDevLines overlay) — the same look as the
signal-gallery cards and quick-charts. Cards beyond the first screen
stream in as they approach the viewport (metered — mounts land
progressively, no burst jank). **The last card's chart must activate at
max scroll without any window jiggle** — `.pg-body` carries ~480px of
trailing scroll room so the deferred cell can always cross the clipped
scrollport edge. Symbol chip overlays the chart's top-left; D/W + ±50
chips top-right. No per-position signal dots.  
**Result:** PASS — user visual confirmation

### 2. Mount-once latch — scroll out and back

**Feature:** latch vs. viewport-unmount (the mid-QA refinement).  
**Steps:** With charts mounted, scroll a rendered card well offscreen,
then scroll back to it. Repeat scrolling to the very top and back.  
**Expected:** the chart is simply *there* on re-entry — no blank flash,
no redraw cycle, no row-height shift. Scrolling the full page is
visually stable in both directions.  
**Result:** PASS — user visual confirmation

### 3. Per-card D/W chip

**Feature:** per-card interval override + lazy weekly fetch.  
**Steps:** Click **W** on one card's chip cluster; then **D**.  
**Expected:** only that card flips to the weekly interval (weekly bars,
weekly HTF window) and back — other cards unaffected. First W click may
briefly show the loading state while weekly bars fetch.  
**Result:** PASS — user visual confirmation

### 4. Header Chart pill resyncs all cards

**Feature:** `chartTimeframeSeq` resync.  
**Steps:** Set one card to W via its chip. Click the header **Chart**
pill's **D** (already active — same-value click). Then click **W**, then
**D** again.  
**Expected:** every card returns to the header interval on every header
click — including a click on the already-active option. Per-card
overrides reset; the page lands on one consistent timeframe.  
**Result:** PASS — user visual confirmation

### 5. ±50 visible-bar chips

**Feature:** per-card visible window.  
**Steps:** Click a card's **+50** chip twice, then **−50** until it
disables.  
**Expected:** that card's chart widens/narrows its visible window per
click; **−50** disables at 30 bars and **+50** disables at the loaded
bar count. Other cards unaffected.  
**Result:** PASS — user visual confirmation

### 6. Chart-unavailable state fails soft

**Feature:** per-card error lane.  
**Steps:** (DevTools) throttle/block network for the bars endpoint, or
observe any card whose symbol has no bars coverage.  
**Expected:** that card alone renders `chart unavailable` in the chart
cell — the card's meta, badge, and buttons stay live; the grid doesn't
reflow or break. A manual Refresh re-requests bars (charts recover when
the fetch succeeds).  
**Result:** PASS — spec-pinned (`cc-error` lane covers the empty/error bars cases); no natural failure observed

### 7. Refresh re-mounts paced

**Feature:** epoch-driven re-ensure + latch release on data loss.  
**Steps:** Click header **Refresh** while scrolled mid-grid.  
**Expected:** the chart cache clears and re-fetches — charts may briefly
return to the loading state and re-mount progressively (paced through
the queue, not all at once); they settle on fresh bars. No cards get
stuck on the placeholder after data returns.  
**Result:** PASS — user visual confirmation

### 8. Refinement pass — chart cell UX

**Feature:** user-facing refinement.  
**Steps:** Inspect cards at desktop width and after narrowing the window
(~tablet width, grid reflows to fewer columns). Check chip legibility,
the symbol overlay, and that the chip cluster doesn't crowd the chart's
top edge. Verify keyboard focus reaches the chips (Tab).  
**Expected:** chips are legible and don't overlap chart content;
the cell height stays stable across states (loading → chart).  
**Result:** PASS — user visual confirmation

## Regression / smoke

- [x] `/gallery` (signal gallery) unchanged — the only shared-file touch
  is a comment header on `gallery-card-chart.component.ts`; signal card
  charts still viewport-unmount as before
- [x] Card meta row ordering unchanged (actions row above chart — #951)
- [x] Group dropdown sorting unaffected (chart doesn't reorder cards)
- [x] Page states (loading/error/empty) unchanged — #950 paths untouched
- [x] tsc clean on change set; 510 portfolio-dashboard specs green

## Traceability

| Acceptance criterion (IMPL §5/§8 + TEST `position-card-chart`) | Scenario |
|---|---|
| `GalleryCardChartStore` + `IndicatorSeriesStore` + mount queue | 1, 7 |
| `@defer (on viewport)` deferred mount | 1 |
| Per-card D/W override | 3 |
| Global `chartTimeframeSeq` resync (incl. same-value) | 4 |
| ±50 visible-bar window | 5 |
| No signal dots — `symbol`-only entity boundary | 1, 3 |
| Chart failure → per-card error block | 6 |
| Mount-once latch (QA refinement) | 2, 7 |
| `'Position Chart'` reserved-name registration | code-level (const + review doc) |

## Findings

Mid-QA refinement applied at user report:

1. **Last card's chart could never activate** — with only ~12px of
   trailing scroll room, the bottom card's `@defer (on viewport)`
   placeholder could pin below the clipped scrollport edge at max
   scroll (a clipped IO target reports no intersection), so the defer
   trigger never fired until a window zoom changed the geometry.
   Fixed: `.pg-body` now carries `padding-bottom: 480px` (chart-cell
   height + slack) so the last card's chart cell can always scroll
   fully into view. The signal gallery has the same latent edge case —
   masked there by list length; noted, not in scope for this task.
