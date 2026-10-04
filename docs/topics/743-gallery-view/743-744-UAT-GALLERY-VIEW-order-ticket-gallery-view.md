# UAT — Gallery View (Order Ticket Gallery)

**Topic:** Gallery Order Ticket View  
**Topic Slug:** order-ticket-gallery-view  
**Thread:** Gallery View Page  
**Thread Slug:** gallery-view-page  
**Issue:** #785 (rotates per task — latest QA issue listed)  
**Thread Parent:** #744  
**Topic Parent:** #743  
**Task:** #783  
**Domain:** GALLERY-VIEW  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-04  
**Last Updated:** 2026-10-04  

This is the Thread-level UAT for the Gallery Order Ticket View feature. It is
cumulative: each task appends or updates a scenario section as it reaches QA,
and each task's QA issue links here. Execute only the section(s) for the task
under test; earlier sections act as regression coverage for later tasks.

## Scope — Task #754: route, page shell, facade/UI-store seam

A lazy `dev/gallery` page that renders the latest completed run's signals as
detail-only cards in a scrollable gallery: aggregation (one card per
symbol+side, D/W merge), header filters (timeframe, direction, list), sorting,
and loading/error/empty/filtered-empty states. No charts, no actions
(reject/watch/ticket), no order placement — those land in later tasks.

## Prerequisites

- Dev server running: `npm start` (observation API on :3456) or an Angular-only
  server on any port (`npx ng serve --port 4300`).
- A signed-in user account — `dev/gallery` sits behind `authGuard`.
- Firestore state with at least one **completed** ST run that produced signals
  (normal state after any signal run; verify on the signal-review page if
  unsure — it shows the same latest completed run).
- No code or config setup beyond the running app.

## Start instructions

1. Start or reuse the dev server and open the app (e.g. `http://localhost:4300`).
2. Sign in if not already authenticated.
3. Navigate to `http://localhost:4300/dev/gallery`.

## Test scenarios — #754

### S1 — Route + auth guard

- **Confirms:** lazy route exists and is auth-gated.
- **Steps:** While signed out, navigate to `/dev/gallery`. Then sign in and
  navigate there again.
- **Expected:** signed out → authGuard redirects away (same behavior as other
  guarded routes); signed in → gallery page renders.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### S2 — Latest completed run resolution

- **Confirms:** the page resolves the latest completed run on cold entry.
- **Steps:** Open the signal-review page first and note the run date shown.
  Then open `/dev/gallery` in a fresh tab (cold entry).
- **Expected:** header shows the same run date; card count > 0 (assuming the
  run produced signals).
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### S3 — Card aggregation (symbol+side, D/W merge)

- **Confirms:** one card per symbol+side; daily+weekly same-side signals merge;
  opposite directions produce two cards.
- **Steps:** Pick a symbol you know has both DAILY and WEEKLY occurrences of the
  same direction (signal-review shows occurrences). Find its card.
- **Expected:** ONE card containing an occurrence row per timeframe. If a
  symbol signals in both directions, it appears as two cards (one BUY, one
  SELL).
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### S4 — Card content

- **Confirms:** each card shows signal details.
- **Expected per card:** symbol, company name, BUY/SELL side badge, and per
  occurrence: timeframe, signal type, bar date, close price.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### S5 — Timeframe filter pills

- **Confirms:** All / Daily / Weekly filtering.
- **Steps:** Click Daily, then Weekly, then All.
- **Expected:** Daily shows only cards with a daily occurrence (weekly-only
  occurrences hidden); Weekly likewise; All restores everything. Counts update.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### S6 — Direction filter pills

- **Confirms:** All / Buy / Sell filtering.
- **Expected:** Buy shows only BUY-badge cards; Sell only SELL-badge cards.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### S7 — List filter + Not triaged

- **Confirms:** list membership filtering, including the cold-entry
  `Not triaged` path (regression for review defect #1).
- **Steps:** Cold-enter `/dev/gallery` (fresh tab). Open the list selector,
  choose `Not triaged`, then a specific exclusive list, then `All Lists`.
- **Expected:** `Not triaged` shows only symbols absent from every exclusive
  list — including on cold entry (no prior visit to signal-review required).
  Symbols only on the nonexclusive MONITOR list still count as untriaged.
  Choosing a populated exclusive list shows only its members.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### S8 — Sort selector

- **Confirms:** sector/industry, market-cap, and list-bucket sorts.
- **Steps:** Cycle each sort option; watch the grid reorder.
- **Expected:** sector sort groups by sector then industry (symbols missing
  sector data sink to the end, not alphabetically interleaved); market-cap
  orders large → small tier; list orders by exclusive-list bucket. Reorder is
  immediate, no reload.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### S9 — Loading state, no empty flash

- **Confirms:** `pageInitializing` covers the per-symbol history fan-out and
  the pre-run-selection window (regression for review defects #2 + round-2).
- **Steps:** Cold-enter `/dev/gallery` with devtools network panel on Normal
  throttling (or just watch closely).
- **Expected:** a loading state renders until cards are ready — at no point
  does "No signals for this run" flash before the grid appears.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### S10 — All-filtered-out state

- **Confirms:** distinct empty state when filters exclude every card.
- **Steps:** Pick an exclusive list with zero members (or combine filters so
  nothing matches).
- **Expected:** an "all filtered out" state — visually distinct from the
  no-signals empty state — with the count showing 0 of N.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### S11 — Error state

- **Confirms:** `symbolsError` surfaces a distinct error state (optional —
  needs a forced failure).
- **Steps:** Block the Firestore signals request via devtools request-blocking,
  then cold-enter the page.
- **Expected:** an error state renders instead of an empty grid.
- **Result:** ☐ PASS ☐ FAIL ☑ SKIPPED — not exercised (needs devtools request-blocking); error branch covered by unit tests

### S12 — Scope guard: no charts or actions

- **Confirms:** #754 stayed in scope.
- **Expected:** cards have no chart cell, no Reject/Watch/Trade buttons, no
  multi-select affordance, no sunk section. Header has no bulk-action bar.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### S13 — Shared-store regression (signal-review)

- **Confirms:** the gallery reusing `GroupStore` active-run state does not
  disturb signal-review.
- **Steps:** Open `/dev/gallery`, then navigate to signal-review and back.
- **Expected:** signal-review renders normally with the same active run; the
  gallery also still shows that run's cards on return.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

## Refinement pass — #754

Manual UI/UX inspection at the running app (`/dev/gallery`):

- Responsive grid: cards reflow cleanly from wide → narrow viewport
  (`auto-fill minmax(320px, 1fr)`); no overflow, no orphan-stretched card.
- Header: pills and selects legible, aligned, and consistent with
  signal-review header conventions; counts readable.
- Cards: side badge clearly distinguishes BUY vs SELL; occurrence rows
  readable; card spacing consistent.
- States: loading spinner/skeleton centered and non-janky; empty and
  filtered-out copy is accurate and not alarming.
- Dark/light mode: no hard-coded colors glaring in either theme.
- **Result:** ☑ PASS ☐ FAIL — user-verified; close prices now render (firing-bar close via symbol-data fill)

## Traceability — #754

| Task acceptance criterion | Scenario |
|---|---|
| Lazy `dev/gallery` route + `authGuard` | S1 |
| Latest completed run resolution + eager loads | S2, S9 |
| Card aggregation: symbol+side, D/W merge, opposite→two cards | S3 |
| Detail-only card shells (signal details) | S4, S12 |
| Header: timeframe/direction pills, list filter, sort, run date, counts | S2, S5–S8 |
| Loading / no-signals / error / filtered-empty states | S9, S10, S11 |
| No charts/actions (deferred scope) | S12 |
| Review-defect regressions (Not-triaged cold entry, empty flash) | S7, S9 |
| Shared GroupStore does not regress signal-review | S13 |

## Regression / smoke

- `npx jest` — full suite (last run: 174 suites / 2529 tests green).
- `npx ng build` — clean.
- Signal-review page unaffected (S13).

## Results log

| Date | Task | Executor | Result | Notes |
|---|---|---|---|---|
| 2026-10-04 | #754 | user + agent | PASS | S11 skipped (devtools-only); defect found+fixed: missing closePrice — filled from firing-bar close |
| 2026-10-04 | #783 | user + agent | PASS | G1–G8 + refinement all PASS; post-review tweaks verified: entry defaults Daily/Long/PRIMARY/Sector, collapsed panels, header counts |

---

## Scope — Task #783: grouped expando layout

The flat card grid is replaced by signal-review-style expansion panels, full
page width (no quick-charts pane). A header "Group" select offers the same
`GroupDimension` set as signal-review — sector | industry | market cap.
Page-entry defaults (per user, post-review): **Daily + Long + PRIMARY list +
Sector grouping**. Each group is one expansion panel (label +
"N signals" + D/W + long/short counts) whose body is the card grid. Cards are unchanged from #754.
Within-group order is marketCap descending (same as signal-review rows);
there is no sort dropdown — grouping absorbs ordering. Timeframe /
direction / list remain filters applied before grouping; list is NOT a
group dimension. `expandedGroups` state + expand/collapse-all live in
GalleryUiStore; groups default to **collapsed** (per user, post-review —
matches signal-review). Each panel header shows the label, "N signals",
and D/W + long/short counts (signal-review-style chips).

## Test scenarios — #783

### G1 — Group dimension select

- **Confirms:** sector / industry / market cap grouping, sector default.
- **Steps:** Cold-enter `/dev/gallery`. Note the initial grouping. Switch
  Group → Industry, then Market Cap, back to Sector.
- **Expected:** initial groups are sector values; each switch regroups
  immediately with no reload; group order is alphabetical, market-cap groups
  order by tier (MEGA → micro) with uppercase labels; '(Unknown)' is always
  the last group.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### G1b — Page-entry defaults

- **Confirms:** entry defaults are Daily + Long + PRIMARY + Sector.
- **Steps:** Cold-enter `/dev/gallery`. Read the filter pill, list select,
  and group select values.
- **Expected:** timeframe=Daily, direction=Buy(long), list=Primary,
  group=Sector — the page opens on the primary workflow slice, not
  All/All/All.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### G2 — Group panels + card grid

- **Confirms:** each group renders as an expansion panel with label + counts;
  body is the card grid unchanged from #754.
- **Steps:** Expand several groups; count cards in one group.
- **Expected:** panel header shows the group label, "N signals" (matching
  the rendered count), and chips: D x / W y (per-card — a merged D+W card
  counts in both), ↑ long / ↓ short; cards inside are identical to the
  #754 card shells (S4 content still correct).
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### G3 — Within-group order

- **Confirms:** cards inside a group order by marketCap desc.
- **Steps:** In a multi-card group, compare card order against known market
  caps (e.g. mega-cap symbols should precede small-caps).
- **Expected:** largest market cap first; symbols missing marketCap sink to
  the group's end.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### G4 — Filters apply before grouping

- **Confirms:** timeframe/direction/list filters trim cards before grouping;
  empty groups disappear.
- **Steps:** Apply direction=Sell, then a list filter, then timeframe=Weekly.
- **Expected:** only groups containing matching cards remain — no empty
  panels; counts update; restoring filters brings the groups back.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### G5 — Expansion state + expand/collapse-all

- **Confirms:** groups start collapsed; per-group state persists; the header
  toggle flips all rendered groups; the icon reflects state.
- **Steps:** On entry, note all panels are closed. Expand one group; switch
  dimension and switch back; click the expand-all toggle (unfold icon)
  twice.
- **Expected:** the expanded group stays expanded across a dimension
  round-trip; the toggle expands every group then collapses every group;
  icon shows unfold_less when all expanded, unfold_more otherwise.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### G6 — No sort dropdown

- **Confirms:** the Sort selector is gone (grouping absorbed ordering).
- **Expected:** header shows pills + Group select + List select + expand-all
  button only — no Sort control.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### G7 — States preserved

- **Confirms:** loading / no-signals / all-filtered-out states still render
  under the grouped layout.
- **Steps:** Cold-enter (watch loading); filter to a zero-member combination.
- **Expected:** same states as S9/S10 — no "No signals" flash; the
  filtered-empty message appears instead of an empty panel stack; the
  expand-all toggle does not sit in a misleading "collapse all" state when
  no groups render.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

### G8 — #754 regression sweep

- **Confirms:** the #754 scope is intact beneath the grouping.
- **Steps:** Re-run S3 (aggregation), S4 (card content incl. prices), S5–S7
  (filters) quickly under the grouped layout.
- **Expected:** all still pass — grouping is layout-only.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

## Refinement pass — #783

- Group headers legible; label + N-signals + D/W + long/short chips read
  consistently with signal-review panel conventions; panels animate
  smoothly.
- Full-width layout: no orphaned quick-charts pane, no horizontal scroll;
  grids reflow within each expanded panel.
- Dark/light mode: panels + headers legible in both themes.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-04)

## Traceability — #783

| Task acceptance criterion | Scenario |
|---|---|
| Group selector sector/industry/marketCap, sector default, regroups live | G1 |
| Page-entry defaults: Daily + Long + PRIMARY + Sector | G1b |
| Expansion panel per group: label + counts; (Unknown) last; tier order + uppercase labels | G1, G2 |
| Panel body = card grid; within-group marketCap desc | G2, G3 |
| expandedGroups, collapsed default + expand/collapse-all | G5 |
| Filters before grouping; empty groups hidden | G4 |
| No sort dropdown | G6 |
| Loading/error/empty/filtered-empty states | G7 |
| Cards/data path unchanged from #754 | G8 |
