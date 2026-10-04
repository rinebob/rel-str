# UAT — Gallery View (Order Ticket Gallery)

**Topic:** Gallery Order Ticket View  
**Topic Slug:** order-ticket-gallery-view  
**Thread:** Gallery View Page  
**Thread Slug:** gallery-view-page  
**Issue:** #772 (rotates per task — latest QA issue listed)  
**Thread Parent:** #744  
**Topic Parent:** #743  
**Task:** #754  
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
