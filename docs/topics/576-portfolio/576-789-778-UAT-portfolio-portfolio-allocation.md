**Topic:** Portfolio Allocation  
**Topic Slug:** portfolio-allocation  
**Thread:** Portfolio Visual Consistency  
**Thread Slug:** visual-consistency  
**Issue:** #789  
**Task:** #778  
**Topic Parent:** #576  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-10  
**Last Updated:** 2026-10-11  

# UAT — Account switcher: header-bar button-toggle on both pages

## Scope

Task #778 replaced the account `mat-tab-group` on `/portfolio` and
`/portfolio/allocation` with a shared `AccountSwitcherComponent` pill row
(`mat-button-toggle-group`). Pills show `accountName` only; non-agentic
accounts carry a flag chip; switching is one click. On the dashboard the
switcher lives in the header bar; on allocation it anchors the real
header bar built by #779, alongside the account stat strip and page
actions (#789 refinement, 10-11).

Automated coverage (already green at review): 23 suites / 353 tests in
`src/app/features/portfolio-dashboard`, `tsc --noEmit` clean. This UAT
covers the manual/visual acceptance the specs can't see.

## Prerequisites

- Dev server running: `npm start` (Observation API `:3456` +
  `ng serve` on `:4210`).
- Signed-in user with **at least two** Robinhood accounts, ideally one
  non-agentic (`agenticAllowed: false`) to exercise the flag chip.
- Chrome/Edge devtools for viewport-resize checks.

## Start

1. Navigate to `http://localhost:4210/portfolio` (sign in if prompted).
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
- **Result:** PASS — user pass 2026-10-11; name-only labels, selected
  pill pressed, half-height pills confirmed

### 2. Dashboard — one-click account switch

- **Steps:** Click a different account pill.
- **Expected:** Section tabs (Equities / Options / Orders / History /
  Account) re-scope to the selected account immediately; scoreboard
  aggregate stays in the header. No page reload, no second click needed.
- **Result:** PASS — user pass 2026-10-11

### 3. Non-agentic flag chip

- **Start:** an account with `agenticAllowed: false` exists (else mark
  N/A).
- **Steps:** Locate that account's pill; hover the `non-agentic` chip.
- **Expected:** Chip renders inside the pill label (small uppercase
  badge); tooltip reads "Order placement is not enabled on this account —
  bucket management and assignment only". Identical chip on both pages.
- **Result:** PASS — spec pins chip + tooltip + ARIA; visually confirmed
  across QA passes (non-agentic account present)

### 4. Allocation page — pill row replaces account tabs

- **Steps:** Navigate to `/portfolio/allocation`.
- **Expected:** A pill row (same component) in the header bar — **no**
  `mat-tab-group` for accounts. The account stat strip and page actions
  (New bucket / Portfolio / Refresh) share the bar; below it, exactly
  ONE Buckets/Positions subtab row for the selected account (previously
  each account tab duplicated these).
- **Result:** PASS — user pass 2026-10-11; pills in bar, strip + actions
  inline, single subtab row

### 5. Allocation — account switch re-scopes content

- **Steps:** Click the other account's pill.
- **Expected:** Account header values, bucket table, and positions table
  all re-scope to the new account. The Buckets/Positions subtab selection
  persists across the switch (acknowledged behavior change).
- **Result:** PASS — user pass 2026-10-11; header values + both tables
  re-scope, subtab persists

### 6. Edge — pill row hidden while accounts load

- **Steps:** Hard-reload `/portfolio/allocation` (Ctrl+F5) and watch the
  toolbar area during the load.
- **Expected:** "Loading accounts…" shows while fetching; **no empty
  bordered strip** renders in place of the pill row (regression check for
  the ungated-render finding).
- **Result:** PASS — user pass 2026-10-11; page spec pins the loading
  gate (accounts-loading, no empty strip)

### 7. Edge — selected pill can't be deselected

- **Steps:** Click the currently-selected account pill.
- **Expected:** The pill stays selected; page content doesn't blank or
  throw (guard swallows the `undefined` deselect emit).
- **Result:** PASS — switcher spec pins the guard; user pass 2026-10-11

### 8. Refinement pass — visual consistency

- **Steps:** Compare the two pages' pill rows side by side; also check
  the dashboard header at a narrow viewport (~800px) and in dark theme.
- **Expected:** Same pill styling both pages (border, 12px labels, chip);
  header doesn't overflow or wrap awkwardly; chip legible in dark theme.
- **Result:** PASS — user pass 2026-10-11; one shared component drives
  both rows; agentic default confirmed; stat strip clips gracefully at
  narrow widths

### 9. Regression — everything else still works

- **Steps:** On the dashboard: switch section tabs, open a position
  dialog / stop-loss dialog, click refresh. On allocation: switch
  Buckets/Positions subtabs, click Refresh.
- **Expected:** All function as before; no console errors.
- **Result:** PASS — user pass 2026-10-11; 42/42 dashboard+switcher and
  40/40 allocation page+table specs green

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

## QA findings (2026-10-09 — user pass)

- **Pill row too tall** → `--mat-button-toggle-height: 24px` inside the
  shared `AccountSwitcherComponent` styles — one change, both pages.
- **Default selection** → both stores now fall back to the first
  `agenticAllowed` account instead of index 0 when no prior selection
  exists (dashboard keeps its primary-agentic sort; the fallback only
  matters when it isn't present).
- **Retired bucket list removed** — per user direction the collapsible
  Retired section was deleted from the buckets table (toggle, section,
  styles); retired buckets render nowhere. Specs updated: not-rendered
  assertion replaces the section test; retired-expand test deleted.
  Affects the earlier #693 design decision — supersedes it.
- 75/75 specs green across the four touched suites; `tsc --noEmit` clean.

## QA findings (2026-10-11 — user pass, round 2)

- **Vertical space reclaim** — the account stat strip (Value | Allocated
  | Cash | Unassigned | as-of) and the `New bucket` button moved into
  the header bar alongside the pills and page actions, leaving the whole
  content column for the tab panes. Strip is chromeless inside the bar
  tint, `flex:1` centered, clips at separators under narrow widths.
  `New bucket`'s dialog call moved to the page component; the buckets
  pane toolbar was removed. New button is tab-agnostic — visible on the
  Positions tab too.
- 40/40 allocation page+table specs green (create-button coverage moved
  to the page spec); `tsc --noEmit` clean.
