**Topic:** Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Journey Navigation  
**Thread Slug:** journey-navigation  
**Issue:** #698  
**QA Issue:** #721  
**Task:** #700  
**Topic Parent:** #625  
**Domain:** WORKFLOWS  
**Type:** UAT  
**Status:** Complete — all 10 scenarios PASS (user-executed)  
**Created:** 2026-09-30  
**Last Updated:** 2026-10-01  

# UAT — #700 NavSection model + NAV_SECTIONS data

Code review: `625-698-700-CODE-REVIEW-WORKFLOWS-trading-workflows.md` —
PASS (3 finding rounds, converged). This task is primarily a data/model
change; the user-visible surface is: (a) sidenav now lists only the 18
canonical items, still flat (grouped rendering is #701), and (b) the
header topnav button row is gone.

**Note — #702 shipped before this QA pass.** The header scenarios below
are written against the shipped #702 header: brand is "Savant Trader",
refresh-time is gone, a fullscreen toggle + floating reveal chevron
exist, and the Select Stock dialog service is fully deleted (not just
unreachable).

Dev server: `localhost:4200` (already running).

## Scenarios

| # | Check | Expected |
|---|---|---|
| 1 | Open sidenav | Exactly 18 items, in PRD order: Portfolio Dashboard, Portfolio Allocation, Runs, Signal Review, Chart Review, Live, Paper, Chain, % Change, Chart, Spread Chart, Strategy Dashboard, Build, Backtest, Swing Analysis, Account Inquiry, Topic Viewer, Dashboard V3 |
| 2 | Sidenav item order relative to groups | Flat list preserves section order (Portfolio pair first, Dashboard V3 last) — no group headers yet (that's #701) |
| 3 | Click each sidenav item | Routes to its canonical URL (`/portfolio`, `/signals/runs`, `/trading/live`, `/options/chain`, …, `/dashboard-v3`), page loads, no console errors |
| 4 | Retired items | Absent: dashboard, dashboard-v2, decision board, positions, trade journal, heatmap, heatmap chart, rs-chart, sync-chart, rs-table, history, documentation, contact |
| 5 | Auth entries in sidenav | login/signup/logout/symbols absent from the list (auth lives in the header block) |
| 6 | Header | Menu button, brand "Savant Trader", fullscreen toggle, and auth block render on the slim dark bar; **no topnav button row, no refresh-time** |
| 7 | Header auth block (signed out) | Login + Sign up buttons → `/login`, `/signup` |
| 8 | Header auth block (signed in) | User label + Logout button; logout works |
| 9 | Select Stock dialog | **Fully removed** — the dialog service was deleted in #702; nothing in the sidenav or header can open it |
| 10 | Console | No errors on sidenav open/close, nav clicks, or header auth actions |

## Results

| Scenario | Result | Evidence |
|---|---|---|
| 1–10 | PASS | User-executed manual pass on live app 2026-10-01 ("uat is approved") — sidenav 18 canonical items in PRD order (flat interim), retired/auth items absent, header shows Savant Trader + fullscreen toggle with no topnav row or refresh-time, Select Stock fully unreachable, no console errors |

**QA verdict: PASS** — #700 is ship-eligible at `7_QA`.
