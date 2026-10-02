**Topic:** Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Journey Navigation  
**Thread Slug:** journey-navigation  
**Issue:** #704  
**Task:** #699  
**Topic Parent:** #625  
**Domain:** WORKFLOWS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-29  
**Last Updated:** 2026-09-30  

# UAT — #699 Canonical route tree

## Scope

`AppRoutes` renamed to domain-prefixed canonical paths; `''`→`/portfolio` landing; `/signals`+`/options` parent redirects; literal `navigate()` sites swept to `AppRoutes`; nav hrefs updated; post-login landing → `/portfolio`; stale `URL:` comments fixed; new `core-routes.spec.ts`.

## Prerequisites

- Dev server running: `npm start` (or existing `ng serve` on :4200 — changes are in the watch build).
- Signed-in user account (auth-gated routes need it for real page loads; signed-out exercises the guard instead).
- No seed data needed — all checks are URL-level.

## Scenarios

| # | Feature | Steps | Expected | Result |
|---|---|---|---|---|
| 1 | Landing | Open `/` signed-in | URL becomes `/portfolio`, Portfolio Dashboard renders | |
| 2 | Signals group root | Navigate to `/signals` | Redirects to `/signals/runs`, Run Dashboard renders | |
| 3 | Signals leaves | `/signals/review`, `/signals/charts` | Signal Review, Chart Review pages load | |
| 4 | Trading leaves | `/trading/live`, `/trading/paper` | Signal Order, Paper Trading pages load | |
| 5 | Options root + leaves | `/options` → then `/options/pct-change`, `/options/chart`, `/options/spread-chart`, `/options/strategy-dashboard`, `/options/strategy/build`, `/options/strategy/backtest` | `/options` redirects to `/options/chain`; each leaf loads its page | |
| 6 | Analysis + tools + dev | `/analysis/swings`, `/tools/account`, `/tools/topic-viewer`, `/dev/flex-chart` | Swing Analysis, RH Account Inquiry, Topic Viewer, Flex Chart Sandbox load | |
| 7 | Stale path fallthrough | Navigate to `/signal-review`, `/run-dashboard`, `/option-chain` (old paths) | Each lands on `/` → `/portfolio` — no blank/hang/console error | |
| 8 | Legacy surfaces | `/dashboard-v3`, `/heatmap-view` (nav-removed but code-alive) | Pages still load directly | |
| 9 | Post-login landing | Sign out → sign in | Lands on `/portfolio`, not `dashboard-v2` | |
| 10 | In-page pipeline | Run Dashboard → open a run → Signal Review → Chart Review → order ticket pill | Handoffs still chain to canonical routes | |
| 11 | Nav entries | Sidenav clicks: Portfolio Dashboard, Portfolio Allocation, Run Dashboard, Option Chain, Option Chain % Change, Topic Viewer | Each routes to its canonical URL | |
| 12 | Regression smoke | Header menu, header links, page back-buttons (goBack on order/triage/history) | No broken links; no console errors | |

## Traceability

| Criterion | Scenarios |
|---|---|
| Canonical leaf paths resolve | 3,4,5,6 |
| `/` → `/portfolio` | 1 |
| `/signals`, `/options` redirects | 2,5 |
| No stale literals | 7 (fallthrough confirms unregistered) + grep-clean (jest) |
| Legacy routes unchanged | 8 |
| Post-auth landing | 9 |
| In-page nav chains | 10,12 |
| Nav hrefs updated | 11 |

## Execution log

Executed 2026-09-30 against the live dev server (:4200), signed-in session — all scenarios PASS by user confirmation.

| Scenario | Result | Evidence |
|---|---|---|
| 1 Landing `/` → `/portfolio` | PASS | user confirmation |
| 2 `/signals` → `/signals/runs` | PASS | user confirmation |
| 3 Signals leaves | PASS | user confirmation |
| 4 Trading leaves | PASS | user confirmation |
| 5 Options root + leaves | PASS | user confirmation |
| 6 Analysis/tools/dev | PASS | user confirmation |
| 7 Stale-path fallthrough | PASS | old paths land on `/portfolio` |
| 8 Legacy surfaces | PASS | `/dashboard-v3`, `/heatmap-view` load |
| 9 Post-login landing | PASS | lands on `/portfolio` (was `dashboard-v2`) |
| 10 In-page pipeline | PASS | pills chain to canonical routes |
| 11 Nav entries | PASS | hrefs resolve canonical |
| 12 Regression smoke | PASS | no dead links / console errors |

Refinement pass: PASS — no UI surface changed beyond routing; nav clicks and page back-buttons verified in scenario 12.
