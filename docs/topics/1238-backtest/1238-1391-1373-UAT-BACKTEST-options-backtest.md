**Topic:** Options Backtest  
**Topic Slug:** 1238-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** 1266-backtest-analytics  
**Issue:** #1391  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1373  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-04  
**Last Updated:** 2026-11-04  

# UAT — #1373 Per-symbol rows + store filteredRows

## Scope

The Selection Replay run list now renders one row per `(runId, symbol)` instead
of one row per run, with the symbol's own status derived from the run doc's
`listOutcomes` map (`pending` when absent, including legacy runs). Row click
selects the `(runId, symbol)` pair and the run detail auto-expands that symbol's
contract-list card. The store carries the filter/sort state and `runRows` /
`filteredRows` derivations that #1374's control strip will consume — there is
**no filter UI yet** in this task; the filters are store-side only and exercised
by specs.

## Prerequisites

- `npm install` already run; repo at `C:\aa\projects\rel-str`, branch `prod`.
- For the live check: `npx ng serve` and an authenticated session (the route is
  behind `authGuard`), with at least one replay run in
  `st-options-replay-runs` — ideally a multi-symbol run.

## How to reach the feature

- UI: app → Savant Trader → "Strategy Backtest" route → the **Selection Replay**
  section (bottom half of the dashboard).
- Specs: `npx jest options-replay --coverage=false`.

## Automated results (executed 2026-11-04)

| Check | Command | Result | Evidence |
|---|---|---|---|
| Replay suites | `npx jest options-replay --coverage=false` | **PASS** | 9/9 suites, **103/103** tests |
| Typecheck | `npx tsc --noEmit -p tsconfig.app.json` | **PASS** | clean |
| Build | `npx ng build --configuration development` | **PASS** | bundle generated clean |
| Whitespace | `git diff --check` on task files | **PASS** | clean |

## Scenario results

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Multi-symbol run → one row per `run.symbols[]` entry | PASS | `options-replay.store.spec.ts` "derives one row per run.symbols entry" (3 symbols → 3 rows) |
| 2 | Single-symbol run → exactly one row | PASS | "a single-symbol run produces exactly one row" |
| 3 | `listOutcomes` present → row shows recorded status | PASS | "derives symbolStatus from listOutcomes" (success + failed) |
| 4 | Symbol missing from `listOutcomes` → `pending` | PASS | "missing symbol entry in listOutcomes derives pending" |
| 5 | Legacy run, no `listOutcomes` field at all → pending, no crash | PASS | "legacy runs with no listOutcomes produce pending rows without crashing" |
| 6 | Filters compose — status × template × case-insensitive symbol search | PASS | "filters compose — status × template × symbol"; "status filter matches symbolStatus, not run status"; "symbol search is a case-insensitive substring match" |
| 7 | Default sort `createdAt` desc; all three sort fields both directions | PASS | "default sort is createdAt descending"; "sorts by createdAt ascending"; "sorts by startDate in both directions"; "sorts by symbol in both directions" |
| 8 | Empty filters → all rows | PASS | "returns all rows with default filters"; `resetFilters` spec |
| 9 | Row click emits `(runId, symbol)` pair | PASS | list spec "emits the (runId, symbol) pair on row click" |
| 10 | Selected row highlighted only on composite runId+symbol match | PASS | "marks the selected row by the composite runId + symbol key"; "does not mark a row selected when only the runId matches" |
| 11 | Selecting a row auto-expands that symbol's contract-list card | PASS | detail spec "auto-expands the selectedSymbol card so its contract list is visible" |
| 12 | Same-run symbol hop keeps list stream; cross-run restreams | PASS | "same-run symbol hop keeps the existing list stream"; "cross-run selection restreams that run's contract lists" |
| 13 | Dead stream (error) recovers on reselection | PASS | "same-run hop restreams when the list stream died on an error" |
| 14 | Stale lists cleared on run switch | PASS | `loadContractLists` clears `contractLists` in its start patch (code-review R2) |
| 15 | Converter maps `listOutcomes`, normalizes keys, absent → undefined | PASS | converter specs ×3 |

## Traceability

| AC | Scenarios |
|---|---|
| Multi-symbol → one row per symbol; missing `listOutcomes` → pending | 1, 2, 3, 4, 5 |
| Filters compose; default sort `createdAt` desc | 6, 7, 8 |
| Row click selects `(runId, symbol)`; detail shows that symbol list | 9, 10, 11 |
| Jest specs per TEST doc | all of the above + 12–15 |

## Refinement pass (manual, live app)

Executed 2026-11-04 against `npx ng serve` (localhost:4200, auth-guarded
route) — user drove the browser-preview check on the Selection Replay
section and re-invoked QA with no visual issues reported.

- Replay section renders per-symbol rows (symbol, run ID, created, template,
  start date, status icon, progress, failed badge).
- Row click → composite highlight + detail auto-expands that symbol's card.
- Selecting a different run clears the previous run's cards/lists.
- Empty state renders when no runs exist.

## Regression / smoke

- Sibling `backtest-run-list` (sim runs) untouched — separate component/store.
- `options-replay-run-detail` header, symbol cards, row-table toggle, and the
  contract-series dialog all unchanged except the `selectedSymbol` input.
- `optionsReplayStart` / new-run dialog flow unchanged (`selectRun` retained).
