**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Extend Gallery UI to Portfolio Page  
**Thread Slug:** portfolio-gallery-view  
**Issue:** #969  
**Thread Parent:** #926  
**Topic Parent:** #219  
**Task:** #951  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

# UAT — PositionCard model + card + grid/grouping (#951)

## Scope

Task #951 replaces the #950 stub grid with real `PositionCard` components and
adds grouping end-to-end: `groupPositionCards`, `classifyCardOrders`, the
`position-card` component, and facade group wiring. Per mid-QA refinement,
grouping renders as a **group-sorted flat grid** (contiguous group blocks in
row-wrap) — the expando path (`position-gallery-group`, expansion state,
expand-all) is retained behind the view's `useExpandos` flag but dormant.
#950's page-shell scenarios (route, states, summary strip, side/list facets,
refresh) are covered by `219-966-950-UAT-…` — this doc covers only the card +
grouping delta plus a regression pass on the shell.

## Prerequisites

- Dev server running: `npm start` (or reuse an existing session) →
  `http://localhost:4200`
- Logged in; at least one agentic-enabled account with ≥1 live equity
  position (real data — no seed step needed; whatever the account holds)
- A position with a resting sell stop-loss is ideal for scenario 4, but
  UNPROTECTED coverage is automatic without one

## Start

Navigate to `http://localhost:4200/portfolio-v2`.

## Scenarios

### 1. Position cards render with full meta

**Feature:** `PositionCard` join + component.  
**Steps:** Load `/portfolio-v2` with Group = **None** (default).  
**Expected:** one card per held equity position; each shows cap-tier badge
left of symbol + company name + LONG/SHORT chip in the header, `qty @ $cost`,
mark price, signed day change, signed P&L, value, days held (`Nd`), bucket
name, sector · industry line. Action row sits above the chart cell (signal
gallery convention). No signal dots, triage buttons, or sunk styling.
Closed/zero-qty remnants never render.  
**Result:** PASS — user visual confirmation

### 2. Market-cap ordering

**Feature:** `sortFlatPositionCards`.  
**Steps:** Scan flat-mode card order.  
**Expected:** positions ordered by the *company's* market cap descending —
a small position in a mega-cap sits above a large position in a small-cap;
symbols without profile data sink to the bottom.  
**Result:** PASS — user visual confirmation

### 3. Short-side sign conventions

**Feature:** position-perspective day change.  
**Steps:** Inspect any SHORT card (or mentally verify against the v1
positions table).  
**Expected:** the card's day change is *position*-signed — a rising day on a
short displays red `−$x.xx (−y%)`, consistent with the P&L row beside it.
Summary-strip Day P&L unchanged.  
**Result:** PASS — user visual confirmation

### 4. Protection badge + stop label

**Feature:** protection join + badge.  
**Steps:** Inspect cards with and without resting sell stops.  
**Expected:** protected cards read `PROTECTED @ $price (x.xx%)`; unprotected
read `UNPROTECTED`; the stop button reads `Update Stop` / `Add Stop`
accordingly. SHORT cards always read UNPROTECTED even with a sell stop
resting (sell stops can't protect a short).  
**Result:** PASS — user visual confirmation

### 5. Action row skeleton

**Feature:** card action row (#953 boundary).  
**Steps:** Inspect each card's action row; hover the disabled buttons.  
**Expected:** `Close` + `Add/Update Stop` enabled (clicking does nothing
yet — wiring is #953); `Add`, `Detail`, `Orders` disabled with "coming soon"
tooltips; `Orders` shows the live order count when > 0.  
**Result:** PASS — user visual confirmation

### 6. Grouped mode — Bucket / Sector / Industry / Market Cap

**Feature:** `groupPositionCards` ordering flattened into the grid.  
**Steps:** Set Group dropdown to **Bucket**, then each other dimension.  
**Expected:** the row-wrap grid stays flat (no expandos, no group headers)
but cards reorder into contiguous group blocks — blocks ordered by
dimension value (alphabetical for Bucket/Sector/Industry; MEGA→µ tier
order for Market Cap), market-cap desc within each block. Switching back
to **None** restores the pure market-cap sort.  
**Result:** PASS — user visual confirmation

### 7. Sink cards last

**Feature:** sink ordering.  
**Steps:** Group by **Bucket** and **Sector** with at least one
unattributed/unprofiled position.  
**Expected:** `(Unassigned)` / `(Unknown)` cards always sort to the bottom
of the grid regardless of how large the missing-data positions are.  
**Result:** PASS — user visual confirmation

### 8. Expando controls dormant

**Feature:** `useExpandos` flag.  
**Steps:** Group by any dimension; scan the toolbar.  
**Expected:** no unfold_more/unfold_less icon renders — expansion state and
the expand-all control only exist for the dormant expando path. The Group
dropdown is purely a sort control now.  
**Result:** PASS — user visual confirmation

### 9. Filters still apply in grouped mode

**Feature:** filter → group pipeline order.  
**Steps:** With Group = Sector, flip side pills to Short; apply a List
filter.  
**Expected:** the grid shows only the filtered cards, still in contiguous
group blocks; the card count header reflects the filtered total.  
**Result:** PASS — user visual confirmation

### 10. Degraded fields

**Feature:** independent degradation.  
**Steps:** Any symbol whose quote/profile is missing.  
**Expected:** card still renders with `—` in the absent fields — no
missing card, no crash, no blank cells.  
**Result:** PASS — user visual confirmation

## Regression / smoke

- [x] `/portfolio` (v1) unchanged — untouched files
- [x] `/gallery` (signal gallery) unchanged — shared helpers identical
  behavior (`scheduleIdle`, sentinel options); 98-spec gallery suite green
- [x] Page states (loading / error+retry / no-agentic / empty /
  filtered-empty / partial-warn banner) — covered by #950 UAT; unchanged
  code paths; view spec pins grouped/flat suppression
- [x] Refresh clears chart cache + reloads pipeline — #950 UAT; also
  retries `loadProfiles` after a failed first fetch
- [x] Live/paper isolation — facade consumes only the dashboard's live
  equity slice; spec pins equity-only ordering
- [x] Options positions/orders never produce cards — input is
  `equityPositionsWithPnL` only; order join re-filters `instrumentType`

## Traceability

| Acceptance criterion (IMPL/TEST task 2) | Scenario |
|---|---|
| `buildPositionCards` full join + degradation | 1, 10 |
| `filterPositionCards` side/list | 9 |
| `sortFlatPositionCards` company-cap desc | 2 |
| `groupPositionCards` dims + sinks + ordering | 6, 7 |
| `classifyCardOrders` badge-consistent | 4, 5 (Orders count) |
| Card meta + badges + stop label | 1, 3, 4 |
| Action-row skeleton | 5 |
| Group-sorted flat render (expandos dormant) | 6, 8 |
| Flat vs grouped render | 1, 6 |
| Long-only protection | 4 |

## Findings

No defects raised. Mid-QA refinements applied at user request:

1. Cap-tier badge moved from the sector·industry line to the header, left
   of the symbol — it could wrap onto a second line in the meta row.
2. Action row moved above the chart cell (signal-gallery ordering).
3. Grouped mode changed from expando groups to a group-sorted flat grid —
   compactness beats collapsibility for this review surface. The expando
   path (`position-gallery-group`, `expandedGroups`, expand-all) is
   retained behind the view's `useExpandos` flag pending confirmation that
   the flat layout wins; deletion is a small follow-up if it does.
