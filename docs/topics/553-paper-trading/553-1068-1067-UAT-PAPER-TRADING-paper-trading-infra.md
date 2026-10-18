**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** — (one-off task, direct child of Topic)  
**Thread Slug:** —  
**Issue:** #1068  
**Thread Parent:** —  
**Topic Parent:** #553  
**Task:** #1067  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete — QA PASS  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-17  

# UAT — #1067 paper trades table (sticky header, sortable, no curve)

## Scope

Task #1067 acceptance criteria (issue body + post-implementation feedback):

1. Trades table scrolls **rows only** — column header stays sticky.
2. All 8 columns sortable, click toggles asc/desc, sort applies within each group.
3. Equity curve panel removed.
4. Ungrouped (`all`) table fills available viewport height.
5. Grouped mode has an outer scrollbar reaching every group section.
6. Cohort sections render collapsed; expando opens the table, re-click closes it.
7. The duplicated per-trade drill-down divs under expanded cohorts are gone.

## Prerequisites

- `npm start` dev server (or a deployed build) and a signed-in user with
  paper trades — the live ledger has ~200+ signal-linked trades, enough to
  overflow the viewport.
- `npx jest src/app/features/savant-trader/pages/paper-trading
  src/app/features/savant-trader/stores/paper-trading` for the automated
  evidence row.

## Start instructions

1. `npm start` → `http://localhost:4200` → sign in.
2. Navigate to **trading/paper** (Savant Trader → Paper Trading).
3. Confirm the account stat strip renders (Cash, Equity, Realized,
   Unrealized, Capital Required, Open) and a "Group by" selector.

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|----------|-------|----------|--------|
| 1 | Ungrouped fill-height | Group by = **All trades**. Observe layout. | Table's bottom edge reaches the viewport bottom; rows scroll inside the table, not the page; header row stays pinned while scrolling | **PASS** — user-verified after two remediations (dead `:only-child` flex chain → panel made `display:flex`; residual ~50px gap → removed `:only-child` margin + bottom page padding) |
| 2 | Column sort | Click **Symbol** header. Click again. Click **Realized** twice. | Rows reorder A→Z then Z→A; arrow icon appears on the active column; Realized sorts numerically (e.g. −5 < 0 < 50 < 80, not lexical) | **PASS** — user-verified; asc/desc toggle + numeric ordering also pinned by spec (DOM click test) |
| 3 | Sort within groups | Group by = **Symbol**. Sort **Realized** desc. | Each symbol section sorts independently; other sections unaffected | **PASS** — per-group sort exercised during grouped-mode verification; ordering pinned by spec |
| 4 | Grouped outer scroll | Group by = **Symbol** (or **Signal Type**) with several groups. Scroll the page. | The whole panel scrolls — every group section is reachable; each group's table caps at ~40vh with its own row scroll | **PASS** — user-verified ("grouping is good") after `flex-shrink: 0` fix (sections previously compressed into strips, no outer scrollbar) |
| 5 | Cohort expando | Group by = **Signal cohort**. Observe, then click a cohort expando; click again. | Sections start collapsed (header + stats only, no table); expando opens the cohort's table; re-click closes it; opening another cohort closes the first (accordion) | **PASS** — user-verified after rework (table rendering is now gated on `selectedCohort`; previously only the drill-down toggled so "close" did nothing) |
| 6 | No duplicated rows | With a cohort expanded, inspect its section. | Each trade appears exactly once — as a table row; no repeated div block with legs/marks/variant chips below the table | **PASS** — user-verified ("the second rendering isn't needed" → `.cohort-detail`/`.variant-runs` block removed entirely) |
| 7 | No equity curve | Scan the page. | No chart panel, no scope selector for the curve; trades panel takes full width | **PASS** — user-verified; removal pinned by spec asserting `.chart-panel`/`ejs-chart`/`.scope-jump` absent |
| 8 | Keyboard sort | Tab to a column header, press Enter/Space. | Sort toggles without a mouse; `aria-sort` reflects direction | **PASS (code-verified)** — Enter/Space bindings route through the same `toggleSort` path as the DOM-clicked test; physical Tab+Enter not separately exercised |
| 9 | States | Throttle network / sign out and reload / empty account. | Loading spinner; error banner on failure; "No paper trades yet" empty state | **PASS (spec-covered)** — error banner and empty state pinned by specs; live session rendered without errors |
| 10 | Regression | Click **Strategy Builder** link; change group-by repeatedly. | Route navigation works; group changes re-render without a page reload | **PASS** — group-by repivots exercised across all dims this session (all/symbol/cohort/sector/industry/capTier/signalStatus/direction specs + live symbol/cohort); nav link markup unchanged |
| 11 | Multi-level sort | Click **Symbol**, then Shift+click **Realized** (twice). | Secondary key joins the chain: primary symbol asc, ties broken by realized desc; rank badges (1, 2) appear on sorted headers | **PASS** — added 2026-10-17 per user request; secondary-key ordering + asc→desc→removed cycle pinned by specs |

## Automated evidence

`npx jest` on the component + store specs — 43/43 pass (run 2026-10-17;
component spec now 23 tests after the multi-sort additions), covering:
sortable toggle/direction/numeric/per-group, shift-click secondary sort,
asc→desc→removed cycle, DOM click wiring + aria-sort, cohort
collapse/accordion, curve removal, group-by repivot, account header,
empty/error states.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Sticky header, rows-only scroll | 1, 4 |
| All 8 columns sortable asc/desc within group | 2, 3, 8 |
| Equity curve removed | 7 |
| Ungrouped fills viewport | 1 |
| Outer scrollbar when grouped | 4 |
| Cohort expandos collapse; no duplicate rendering | 5, 6 |
| Multi-level sorting (shift+click secondary keys) | 11 |
| Regression — header stats, group-by, nav link | 3, 10 |
