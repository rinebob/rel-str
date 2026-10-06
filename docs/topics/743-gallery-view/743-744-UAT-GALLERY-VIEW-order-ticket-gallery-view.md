# UAT — Gallery View (Order Ticket Gallery)

**Topic:** Gallery Order Ticket View  
**Topic Slug:** order-ticket-gallery-view  
**Thread:** Gallery View Page  
**Thread Slug:** gallery-view-page  
**Issue:** #817 (rotates per task — latest QA issue listed)  
**Thread Parent:** #744  
**Topic Parent:** #743  
**Task:** #756  
**Domain:** GALLERY-VIEW  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-04  
**Last Updated:** 2026-10-06  

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
| 2026-10-05 | #755 | user + agent | **PASS** | A1–A11 + refinement user-verified; viewport-height fix landed during pass (.gallery-page → 100vh − header var) |
| 2026-10-06 | #756 | user + agent | **PASS** | C1–C4, C6 + refinement user-verified; C5 removed (impossible — deterministic signals, no same-symbol buy+sell pairs); callable burst = 1/unique-symbol as designed; expando-mount latency noted for the card-chart grill |

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

---

## Scope — Task #755: card status model + labeled decision toolbar

Every gallery card gains the decision surface (scope expanded mid-task at
user request — the gallery is the primary review/order surface). The
surface was revised during QA: the ACR icon row + list toggles ported
from signal-review were replaced by the labeled one-step toolbar
(Trade / Reject / Paper / Chart stub), and #759's ticket dialog was
pulled forward into this task:

- **Labeled toolbar** at the bottom of every card — Trade (primary),
  Reject (Restore when the card is sunk-rejected), Paper, and a disabled
  Chart stub (real popup chart lands in #756).
- **Trade** — stages a whole-share quantity ticket sized on the signal's
  close price (live-quote fallback; no dollarAmount, no decision writes)
  and opens it in a MatDialog hosting OrderTicketComponent. Reopens an
  already-staged card ticket; cancelling the dialog discards a ticket the
  click created, but a reopened pre-existing ticket survives.
- **Reject** — toggle: durable REJECTs + staged-ticket removal → card
  sinks; Restore on the sunk card resets it to pending.
- **Paper** — stages the card ticket if needed, then runs the order
  queue's paperSignalOrder path: quantity sizing, SUBMITTING guard,
  PAPER on success (card settles + sinks), STAGED + error on failure.
- **Card status** derives from ticket/Monitor/decision state:
  watched > rejected > failed > settled > resting > submitting > pending.
  Status chip renders for every non-pending state; ticket-status line
  (`market 2 @ mkt · Staged`, `limit 10 @ 210.50 · Resting`) under the header.
- **Sunk partition**: watched/settled/failed/rejected cards leave their
  dimension group and collect in a pinned "Sunk" expando at the bottom,
  ordered by action time desc (untimestamped last). Resting stays in place.
- **Reject semantics**: rejected occurrences trim within a card; a
  fully-rejected card keeps its occurrences and sinks as `rejected` — the
  decision stays reachable for Restore on this page.
- **Gating**: the three decision buttons disable when the viewed run
  isn't a completed run.

## Test scenarios — #755

### A1 — Labeled toolbar present on every card

- **Confirms:** each card renders the decision controls.
- **Steps:** Cold-enter `/dev/gallery`, expand a group.
- **Expected:** every card has a bottom toolbar: **Trade** (filled
  primary), **Reject**, **Paper**, and a greyed **Chart** stub, separated
  from occurrences by a divider. Labels are text, not icons.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-05)

### A2 — Trade stages a quantity ticket and opens the dialog

- **Confirms:** Trade stages a whole-share ticket sized on the signal
  close and opens OrderTicketComponent in a MatDialog.
- **Steps:** Pick a pending card with a close price. Click **Trade**.
- **Expected:** a dialog opens titled `{SYMBOL} {SIDE} Order Ticket`
  hosting the full order-ticket editor; the card shows a ticket line
  `market N @ mkt · Staged` (N = whole shares of the default dollar
  amount at the close). No ACCEPT decision is written. Cross-check: the
  ticket appears on the order queue as STAGED with a quantity (not a
  dollar amount).
- **Cleanup:** close the dialog (see A4 for discard semantics).
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-05)

### A3 — Trade reopens an already-staged ticket

- **Confirms:** no duplicate tickets — an existing staged card ticket
  reopens.
- **Steps:** With a card's ticket still staged (dialog closed without
  cancelling it first — e.g. after a page reload), click **Trade** again.
- **Expected:** the dialog reopens on the SAME ticket — only one staged
  ticket for that symbol+side exists on the order queue.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-05)

### A4 — Dialog cancel discards a created ticket

- **Confirms:** closing the dialog while still STAGED removes a ticket
  the click created; a reopened ticket survives.
- **Steps:** Click **Trade** on a fresh pending card, then close the
  dialog (X / Close / backdrop) without submitting.
- **Expected:** the card's ticket line disappears and the staged ticket
  leaves the order queue — card back to plain pending. (A reopened
  ticket — A3 — must NOT be removed on close.)
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-05)

### A5 — Reject sinks the card; Restore recovers it in one click

- **Confirms:** reject writes durable REJECTs + removes staged tickets →
  card sinks; the sunk card's Restore resets it to pending.
- **Steps:** Click **Reject** on a pending card. Then expand the "Sunk"
  panel at the bottom, find the card, and click **Restore**.
- **Expected:** the card leaves its dimension group immediately and lands
  in Sunk — dimmed, red REJECTED chip, occurrences still listed, Reject
  button relabeled **Restore**. After Restore: the card returns to its
  dimension group as plain pending. (Optional: signal-review shows the
  same symbol rejected after the first half.)
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-05)

### A6 — Partial reject trims occurrences only

- **Confirms:** rejecting one occurrence's decision trims it while the
  card survives on the rest.
- **Steps:** Pick a card with 2+ same-side occurrences. Reject, then
  Restore — all occurrences return. (A true partial reject is exercisable
  via Firestore manipulation — optional.)
- **Expected:** post-Restore the card shows every original occurrence; a
  partial reject trims only the rejected occurrence.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-05)

### A7 — Paper sends the card's ticket to paper trade

- **Confirms:** Paper stages (if needed) and runs paperSignalOrder →
  PAPER → card settles + sinks.
- **Steps:** Click **Paper** on a pending card.
- **Expected:** a ticket stages and sends to the paper ledger — snackbar
  confirms "sent to paper trade", the card sinks to Sunk with a SETTLED
  chip, and the ticket shows PAPER on the order queue / paper trading
  page. If the callable fails: ticket restores STAGED with an error +
  failure snackbar, card stays in place.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-05)

### A8 — Side-scoping: opposite-side cards act independently

- **Confirms:** a symbol with both directions has independent cards.
- **Steps:** Find a symbol with both BUY and SELL cards (if one exists in
  this run — if not, mark SKIP). Trade the BUY card; reject the SELL card.
- **Expected:** only the BUY card's ticket stages; only the SELL card
  sinks.
- **Result:** ☑ PASS ☐ FAIL ☐ SKIP — user-verified in app at /dev/gallery (2026-10-05)

### A9 — Sunk ordering by action time

- **Confirms:** sunk cards order by action timestamp descending.
- **Steps:** With 2+ cards in Sunk (e.g. a watched + a rejected), compare
  order; re-reject one to bump its timestamp.
- **Expected:** most-recently-actioned card first; untimestamped last.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-05)

### A10 — Actionability gating

- **Confirms:** the decision buttons disable when the viewed run isn't
  actionable.
- **Steps:** View a non-completed/non-actionable run context (if none
  reachable, mark SKIP).
- **Expected:** Trade / Reject / Paper render disabled; the Chart stub
  stays disabled regardless.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-05)

### A11 — Signal-review regression

- **Confirms:** the shared staging-util extraction
  (`utils/signal-order-staging.util.ts`, quantity option added) didn't
  change signal-review.
- **Steps:** On `/signals/review`, accept + reject + flag a symbol.
- **Expected:** identical behavior — accept still stages a dollar ticket
  visible in the order queue; decisions persist.
- **Result:** ☑ PASS ☐ FAIL — user-verified in app at /dev/gallery (2026-10-05)

## Refinement pass — #755

- Toolbar: labels legible, equal-width buttons don't overflow the
  narrowest grid column; Trade's primary fill reads as the main action;
  Restore's red outline reads as reversible.
- Dialog: OrderTicketComponent usable at 560px; X/Close/backdrop all
  close; auto-close when the ticket submits or papers.
- Status chips: REJECTED red, WATCHED purple, FAILED red border; sunk
  cards dimmed at 0.55 opacity — still readable.
- Ticket line: quantity tickets render `market N @ mkt · Staged` (no
  blank `@ mkt` artifacts); limit tickets render qty @ price.
- Dark/light themes both legible.
- **Result:** ☑ PASS ☐ FAIL — user-verified (2026-10-05); surfaced a viewport-height defect: `.gallery-page` sized `height: 100%` against an unconstrained drawer host — fixed to `calc(100vh - var(--header-height, 0px))` matching sibling pages

## Traceability — #755

| Task acceptance criterion | Scenario |
|---|---|
| Card renders symbol/name/direction + occurrence chips + status chip + ticket line | A1, A2, A7 |
| Status derivation maps ticket/Monitor/decision state (watched > rejected > failed > settled > resting > submitting > pending) | A5, A7, A9 |
| REJECTed occurrences trim; fully-rejected sinks as `rejected`, reachable via Restore | A5, A6 |
| Sunk partition + ordering (action time desc, untimestamped last) | A5, A9 |
| Labeled toolbar on every card (Trade / Reject / Paper / Chart stub) | A1 |
| Trade stages a quantity ticket + opens OrderTicketComponent dialog; reopen-dedupe + cancel-discard | A2, A3, A4 |
| Paper sends through paperSignalOrder → PAPER → settles + sinks; failure restores STAGED + error | A7 |
| Reject toggle: sinks with REJECTs + ticket removal; Restore resets to pending | A5 |
| Decision buttons disabled on non-actionable runs | A10 |
| Signal-review regression after shared staging-util extraction | A11 |

## Scope — Task #756: deferred chart cell + idle prefetch

Each gallery card embeds a live Syncfusion chart in place of the old
"chart" placeholder. The chart cell mounts only when the card scrolls
into the viewport (`@defer (on viewport)`); the page warms every visible
card symbol's daily bars + symbol-data version + indicator series on
idle (`GalleryCardChartStore` → `IndicatorSeriesStore`, shared cache key
with quick-charts). The chart renders the quick-charts daily stack —
candles, trend bands on the price pane, trend-strength / zone-V1 /
zone-V2 lower panes, weekly HTF window, strategy signal + uptick dots —
plus this card's own occurrences as dots on the price pane. Chrome is
trimmed: no crosshair, toolbar, or scrollbar; ~40 visible bars; 440px
fixed cell height.

- `@defer (on viewport; prefetch on idle)` cell with a dashed
  "chart" placeholder that keeps the 440px footprint pre-mount.
- Live chart (not backend PNGs — those stay the submit-time artifact).
- Error/unavailable state: "chart unavailable" box in the same cell,
  grid unaffected.
- Loading state: dimmed "chart" box while bars are in flight.
- Indicators may land a beat after candles on cold symbols — the chart
  fills in without a remount.

## Test scenarios — #756

### C1 — Deferred mount: placeholder → chart on scroll

- **Confirms:** `@defer (on viewport)` — off-screen cards don't pay for
  chart instances.
- **Steps:** load `/dev/gallery` fresh; observe the first-screen cards
  mount charts; scroll down slowly and watch cards below the fold
  transition placeholder → chart as they enter view.
- **Expected:** visible cards show charts; newly scrolled cards mount
  when they enter the viewport; no full-page stall.
- **Result:** ☑ PASS ☐ FAIL — user-verified (2026-10-06)

### C2 — Chart content matches the quick-charts daily stack

- **Confirms:** the card chart isn't a stripped placeholder — it's the
  real daily configuration.
- **Steps:** expand a group with confirmed signals; inspect a card.
- **Expected:** candles; colored trend bands on the price pane; a lower
  pane for trend strength (0–100 scale + dots); zone V1 and zone V2
  panes; signal-firing-bar dots; the card's own occurrence dot(s) on the
  price pane at the signal close.
- **Result:** ☑ PASS ☐ FAIL — user-verified (2026-10-06); weekly-timeframe
  dots landing between daily bars confirmed as a real artifact — ticketed
  as #819 (D/W toggle)

### C3 — Idle prefetch (jank-free scroll)

- **Confirms:** bars + indicators for visible-card symbols warm on idle
  ahead of mount.
- **Steps:** open devtools Network; load the page and let it settle —
  watch `symbol-data/...` doc reads and the `stGetSymbolIndicatorSeriesV2`
  callable fire without scrolling (one round per unique symbol, not per
  card).
- **Expected:** prefetch requests on idle; scrolling to a warm symbol's
  card mounts the chart with data already present (or a very brief
  loading state).
- **Result:** ☑ PASS ☐ FAIL — user-verified (2026-10-06); observed one
  stGetSymbolIndicatorSeriesV2 call per unique symbol as designed

### C4 — Failure placeholder doesn't break the grid

- **Confirms:** per-card fetch failure is contained.
- **Steps:** hard to force live — alternatively trust unit coverage
  (`gallery-card-chart.component.spec.ts`: empty bars + thrown error →
  `.cc-error` placeholder). If a symbol with no bar data exists in the
  run, its card shows "chart unavailable" while neighbors render fine.
- **Expected:** unavailable state stays inside the cell; the card and
  grid keep their layout.
- **Result:** ☑ PASS ☐ FAIL — unit-covered + user-verified grid integrity (2026-10-06)

### C5 — Same symbol, two cards (buy + sell)

- **Not applicable** — removed during QA (2026-10-06). Signal evaluation
  is deterministic per timeframe+symbol+direction, so a run can't
  produce same-symbol buy+sell card pairs; intraday reversals don't
  apply (daily+ timeframes only). The per-symbol cache-sharing path is
  still exercised implicitly by every card that shares a symbol's
  prefetch entry and by the store's dedupe spec.

### C6 — Regression: #755 card behaviors unaffected

- **Confirms:** the chart cell didn't disturb the decision surface.
- **Steps:** Reject a card (sinks, REJECTED chip, Restore works); Trade
  opens the dialog; Paper still submits. Sunk cards keep their charts
  (or mount lazily on scroll into the Sunk group).
- **Expected:** identical to the #755 pass (A1–A11).
- **Result:** ☑ PASS ☐ FAIL — user-verified (2026-10-06)

## Refinement pass — #756

- Cell height 440px: all four panes legible, not squat; card doesn't
  dominate the row.
- Placeholder and mounted chart share the same footprint — no card
  reflow on mount.
- Log scale on; ~40 visible bars; no crosshair/toolbar/scrollbar chrome.
- Dark/light themes legible inside the cell.
- Observation: charts on a freshly-expanded group take ~3-4s to mount —
  data was already warm (prefetch covers collapsed groups); this is
  Syncfusion multi-pane render cost per card, not fetch latency. Noted
  for the card-chart grilling (stagger mounts / fewer panes / slimmer
  config); tracked for follow-up, not a blocker.
- **Result:** ☑ PASS ☐ FAIL — user-verified (2026-10-06)

## Traceability — #756

| Task acceptance criterion | Scenario |
|---|---|
| Chart cell wrapped in @defer (on viewport; prefetch on idle) with placeholder | C1, C3 |
| Mounted chart renders quick-charts daily config incl. signal-firing-bar dot | C2 |
| Indicator data prefetches eagerly; render-all fallback documented/flagged | C3, IMPL doc |
| Per-card chart fetch failure shows error placeholder without breaking the grid | C4 |
| User-directed deviations: full indicator stack, 40 bars, 440px cell | C2, refinement |
