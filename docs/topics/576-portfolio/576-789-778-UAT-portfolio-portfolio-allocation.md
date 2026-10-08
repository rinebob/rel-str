**Topic:** Portfolio Allocation  
**Topic Slug:** portfolio-allocation  
**Thread:** Portfolio Visual Consistency  
**Thread Slug:** visual-consistency  
**Issue:** #789  
**Task:** #778  
**Topic Parent:** #576  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Draft  
**Created:** 2026-10-10  
**Last Updated:** 2026-10-10  

# UAT — Account switcher: header-bar button-toggle on both pages

## Scope

Task #778 replaced the account `mat-tab-group` on `/portfolio` and
`/portfolio/allocation` with a shared `AccountSwitcherComponent` pill row
(`mat-button-toggle-group`). Pills show `accountName` only; non-agentic
accounts carry a flag chip; switching is one click. On the dashboard the
switcher lives in the header bar; on allocation it sits under the interim
toolbar until #779 builds the real header.

Automated coverage (already green at review): 23 suites / 353 tests in
`src/app/features/portfolio-dashboard`, `tsc --noEmit` clean. This UAT
covers the manual/visual acceptance the specs can't see.

## Prerequisites

- Dev server running: `npm start` (or the already-running `ng serve` on
  port 4200).
- Signed-in user with **at least two** Robinhood accounts, ideally one
  non-agentic (`agenticAllowed: false`) to exercise the flag chip.
- Chrome/Edge devtools for viewport-resize checks.

## Start

1. Navigate to `http://localhost:4200/portfolio` (sign in if prompted).
2. From there, click **Allocations** (header, right side) to reach
   `/portfolio/allocation`; use **← Portfolio** in that page's toolbar to
   return.

## Scenarios

### 1. Dashboard — pills in the header bar

- **Start:** `/portfolio` loaded with ≥2 accounts.
- **Steps:** Observe the light-blue header row, left of the scoreboard.
- **Expected:** One pill per account showing the account **name only** —
  no account number in parentheses. The selected account's pill is
  visually pressed/checked.
- **Result:**

### 2. Dashboard — one-click account switch

- **Steps:** Click a different account pill.
- **Expected:** Section tabs (Equities / Options / Orders / History /
  Account) re-scope to the selected account immediately; scoreboard
  aggregate stays in the header. No page reload, no second click needed.
- **Result:**

### 3. Non-agentic flag chip

- **Start:** an account with `agenticAllowed: false` exists (else mark
  N/A).
- **Steps:** Locate that account's pill; hover the `non-agentic` chip.
- **Expected:** Chip renders inside the pill label (small uppercase
  badge); tooltip reads "Order placement is not enabled on this account —
  bucket management and assignment only". Identical chip on both pages.
- **Result:**

### 4. Allocation page — pill row replaces account tabs

- **Steps:** Navigate to `/portfolio/allocation`.
- **Expected:** A pill row (same component) under the `← Portfolio |
  Refresh` toolbar — **no** `mat-tab-group` for accounts. Below it,
  exactly ONE account header and ONE Buckets/Positions subtab row for the
  selected account (previously each account tab duplicated these).
- **Result:**

### 5. Allocation — account switch re-scopes content

- **Steps:** Click the other account's pill.
- **Expected:** Account header values, bucket table, and positions table
  all re-scope to the new account. The Buckets/Positions subtab selection
  persists across the switch (acknowledged behavior change).
- **Result:**

### 6. Edge — pill row hidden while accounts load

- **Steps:** Hard-reload `/portfolio/allocation` (Ctrl+F5) and watch the
  toolbar area during the load.
- **Expected:** "Loading accounts…" shows while fetching; **no empty
  bordered strip** renders in place of the pill row (regression check for
  the ungated-render finding).
- **Result:**

### 7. Edge — selected pill can't be deselected

- **Steps:** Click the currently-selected account pill.
- **Expected:** The pill stays selected; page content doesn't blank or
  throw (guard swallows the `undefined` deselect emit).
- **Result:**

### 8. Refinement pass — visual consistency

- **Steps:** Compare the two pages' pill rows side by side; also check
  the dashboard header at a narrow viewport (~800px) and in dark theme.
- **Expected:** Same pill styling both pages (border, 12px labels, chip);
  header doesn't overflow or wrap awkwardly; chip legible in dark theme.
- **Result:**

### 9. Regression — everything else still works

- **Steps:** On the dashboard: switch section tabs, open a position
  dialog / stop-loss dialog, click refresh. On allocation: switch
  Buckets/Positions subtabs, click Refresh.
- **Expected:** All function as before; no console errors.
- **Result:**

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Button-toggle in header bar (dashboard) / pill row (allocation) | 1, 4 |
| Labels render `accountName` only | 1, 4 |
| Non-agentic flag inside label, same tooltip/ARIA | 3 |
| Wired to existing `selectedAccountIndex`/`selectAccount` — no store changes | 2, 5 |
| Account `mat-tab-group` removed both pages | 4 |
| TestIDs `acct-toggle-*`; specs green | automated (jest) |
| Single-account / all-non-agentic edge cases | 6, 7, 8 |

## Regression / smoke

- Scenario 9 covers nearby surfaces: section tabs, dialogs, refresh,
  allocation subtabs.
