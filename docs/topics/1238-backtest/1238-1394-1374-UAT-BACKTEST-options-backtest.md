**Topic:** Options Backtest  
**Topic Slug:** 1238-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** 1266-backtest-analytics  
**Issue:** #1394  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1374  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-04  
**Last Updated:** 2026-11-04  

# UAT — #1374 options-replay-run-controls toolbar

## Scope

The Selection Replay section gains a filter/sort toolbar —
`options-replay-run-controls` — wired over the existing store filter
surface: New Replay button (moved out of the section header), status pills
(All/Pending/Success/Failed — **symbol-status** vocabulary), template
select (seeded `REPLAY_TEMPLATES` registry), symbol search, sort select
(Created/Start Date/Symbol) + direction toggle, and a conditional Clear
filters pill. The run list now distinguishes "no runs" from "no rows match
the current filters". No config/archive/date/refresh controls (replay
doesn't have those axes).

## Prerequisites

- `npm install` already run; repo at `C:\aa\projects\rel-str`, branch `prod`.
- For the live check: `npx ng serve` and an authenticated session (the
  route is behind `authGuard`), with at least one replay run in
  `st-options-replay-runs`.

## How to reach the feature

- UI: `/options/strategy/backtest` (auth-guarded; `AppRoutes.STRATEGY_BACKTEST`,
  left-nav "Strategy Backtest") → the **Selection Replay** section (bottom
  half); toolbar renders between the section header and the run list.
- Specs: `npx jest options-replay-run-controls options-replay-run-list
  options-replay.store --coverage=false`.

## Automated results (executed 2026-11-04)

| Check | Command | Result | Evidence |
|---|---|---|---|
| Replay suites | `npx jest options-replay --coverage=false` | **PASS*** | 8/10 suites, **111/118** tests — the 7 failures are confined to 2 foreign in-flight dialog suites (`contract-series-dialog`, `new-run-dialog`; user de-materify sweep spec debt). Every task-scoped suite green. |
| Task-scoped suites | `npx jest options-replay-run-controls options-replay-run-list options-replay.store` | **PASS** | **54/54** (controls 14, run-list 11, store 29 incl. new predicate spec) |
| Typecheck | `npx tsc --noEmit -p tsconfig.app.json` | **PASS** | clean repo-wide |
| Build | `npx ng build --configuration development` | **PASS** | bundle generated clean (foreign blockers resolved mid-gate) |
| Whitespace | `git diff --check` on task files | **PASS** | clean |

## Scenario results

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Status pill click emits `statusFilterChange`; store filters on `symbolStatus` (not run status) | PASS | controls spec (pill click → emit); store spec "status filter matches symbolStatus, not run status" |
| 2 | Active pill reflects the `statusFilter` input + `aria-pressed` | PASS | controls spec active-pill binding |
| 3 | Template select emits `templateFilterChange`; options = `REPLAY_TEMPLATES` identity + leading "All" | PASS | controls specs `templateOptions === REPLAY_TEMPLATES`; option count = registry + 1, first is 'all' |
| 4 | Symbol search emits `symbolSearchChange`; case-insensitive substring filter | PASS | controls spec input event; store spec "symbol search is a case-insensitive substring match" |
| 5 | Sort select emits `sortByChange`; `[value]` round-trips the input | PASS | controls specs change-emit + round-trip (R1 remediation) |
| 6 | Direction button emits flipped `sortDirectionChange`; icon swaps asc/desc | PASS | controls spec direction flip + `dse-icon` glyph pin |
| 7 | New Replay emits `newReplay` → dashboard `openNewReplayDialog()` | PASS | controls spec emit; dashboard wiring `(newReplay)` → `openNewReplayDialog()`; header button removed |
| 8 | Clear filters pill renders iff `hasActiveFilters()`; click emits `resetFilters` → all rows return | PASS | controls spec conditional render + emit; store spec "resetFilters" restores `filteredRows().length === 3` |
| 9 | Sort changes do NOT count as active filters | PASS | store spec "sort changes do not count as active filters" (R2) |
| 10 | Empty-under-filters copy: "No rows match the current filters" vs plain empty/loading states | PASS | run-list spec "reads as a filter miss when rows are empty under active filters" |
| 11 | No config/archive/date/refresh controls rendered | PASS | controls spec pins filter-label set to `['Status','Template','Symbol','Sort']` |
| 12 | Accessibility: `aria-label` on selects/input/icon-buttons, `role="group"` on pills, `aria-hidden` on decorative icons | PASS | markup verified in 2 review rounds (a11y trio + dse-icon gaps remediated) |
| 13 | Legacy `backtest-run-control` untouched | PASS | zero diff on the component (AC3; dead `mat-spinner` SCSS left to the de-materify sweep per AC) |
| 14 | Emit → setter → `filteredRows` chain intact end-to-end | PASS | all 5 setters + `resetFilters` bound at dashboard; `filteredRows` consumes all filter state fields |

## Traceability

| AC | Scenarios |
|---|---|
| Each control emits its change output; values drive `filteredRows` | 1, 3, 4, 5, 6, 8, 14 |
| Template options equal the seeded registry | 3 |
| Legacy `backtest-run-control` untouched | 13 |
| No config/archive/date controls | 11 |

## Refinement pass (manual, live app)

Executed 2026-11-04 against `npx ng serve`
(`http://localhost:4200/options/strategy/backtest`, auth-guarded) — user
drove the browser-preview check on the Selection Replay toolbar and
confirmed no visual issues.

- Toolbar renders above the run list (New Replay + status pills + template
  select + symbol input + sort + direction; strip doesn't compress).
- Each control visibly narrows/reorders rows; Clear filters appears only
  under an active filter and restores all rows.
- Filter-miss copy correct; New Replay opens the existing dialog; row
  click → detail expand still works.

## Regression / smoke

- Sibling `backtest-run-control` (sim section) untouched — AC3.
- `options-replay-run-list` unchanged except `hasActiveFilters` input +
  filter-miss copy + `aria-hidden` on icon spans.
- `options-replay-run-detail`, contract-series dialog, `optionsReplayStart`
  flow unchanged.
- Two foreign dialog spec suites remain red (user's in-flight
  `DsDialogService` sweep) — not this task's surface.
