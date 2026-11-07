**Topic:** Portfolio Allocation  
**Topic Slug:** portfolio-allocation  
**Issue:** #1443  
**Task:** #1441  
**Topic Parent:** #576  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete — 2026-11-06 — QA PASS (6/6 scenarios live-verified)  
**Created:** 2026-11-06  
**Last Updated:** 2026-11-06  

# UAT — Allocation page chrome parity: account order + amount masking

## Scope

Task #1441 fixed two chrome-parity gaps between `/portfolio` and
`/portfolio/allocation` reported in #1441:

1. The account picker now lists accounts in the **same order on both
   pages** — the primary agentic account sorts to the first tab
   (`sortAccountsPrimaryFirst`, shared helper).
2. The allocation page's header stats strip (Value / Allocated / Cash /
   Unassigned) is **masked by default** with an eye-icon reveal — same
   treatment as the portfolio scoreboard, sharing the `pd-show-amounts`
   localStorage key so one opt-in covers both pages.

Automated coverage (green at review): +1 store ordering spec + 4 page
masking specs; full suite 301/301. This UAT covers the live visual
behavior.

## Prerequisites

- Dev server running: `npm start` (Observation API `:3456` +
  `ng serve` `:4210`).
- Signed-in user with ≥2 Robinhood accounts incl. the primary agentic
  one (needed to observe the order difference; with 1 account the order
  scenario is vacuously satisfied).
- Chrome/Edge devtools (optional — localStorage check).

## Getting to the feature

1. `http://localhost:4210/portfolio` — note the account pill order.
2. Click **Allocations** in the header → `/portfolio/allocation`.
3. The surfaces: the account-switcher pills + the stats strip at the top
   of the page, and the new eye-icon button in the header actions.

## Scenarios

### 1. Same account order on both pages

- **Steps:** On `/portfolio`, read the pill order left→right. Navigate
  to `/portfolio/allocation` via the **Allocations** link.
- **Expected:** Identical order — primary agentic account first on both.
- **Result:** PASS — user-confirmed live, 2026-11-06.

### 2. Amounts masked by default

- **Start:** Fresh profile OR `localStorage 'pd-show-amounts'` absent
  (devtools → Application → Local Storage → remove the key, or use an
  incognito window).
- **Steps:** Open `/portfolio/allocation`.
- **Expected:** The header strip shows `•••` for Value / Allocated /
  Cash / Unassigned — not real dollars. An eye (`visibility_off`) icon
  sits in the header actions, same as the portfolio page.
- **Result:** PASS — user-confirmed live, 2026-11-06.

### 3. Eye toggle reveals + persists

- **Steps:** Click the eye icon → amounts appear (Value, Allocated,
  Cash, Unassigned in dollars; icon flips to `visibility`). Reload the
  page; then navigate to `/portfolio`.
- **Expected:** Amounts stay revealed after reload (localStorage
  `pd-show-amounts: 1`); the portfolio scoreboard is also revealed —
  the shared key means one opt-in covers both pages. Toggling off
  re-masks and persists `0`.
- **Result:** PASS — user-confirmed live, 2026-11-06
  ("stays revealed when flipping to /portfolio and back").

### 4. Holdings tables unaffected

- **Steps:** With amounts masked, check the Buckets and Positions tabs.
- **Expected:** Table values (exposure, market value, drift, etc.)
  still render real dollars — the mask covers only the header strip,
  matching the portfolio page (scoreboard masked, tables untouched).
- **Result:** PASS — user-confirmed live, 2026-11-06.

### 5. Cash-divergence tooltip masked

- **Start:** Requires an account where broker cash ≠ derived cash (the
  `⚠` marker shows on the Cash value). Not always observable.
- **Steps:** Hover the `⚠` marker.
- **Expected:** Tooltip shows `Broker cash ••• vs derived •••` when
  masked; real values when revealed.
- **Result:** PASS — user-confirmed live, 2026-11-06 (⚠ marker
  present, tooltip masked).

### 6. Non-agentic flag + selection behavior unchanged

- **Steps:** Confirm non-agentic accounts still carry their flag chip;
  the default selection still lands on the first agentic account;
  switching pills works.
- **Expected:** Unchanged — only tab *order* changed, not flags or the
  default-selection rule (agentic first, not index 0).
- **Result:** PASS — pinned by existing specs (non-agentic flag,
  first-agentic default) + live render in scenario 1.

## Traceability

| Issue #1441 requirement | Scenario |
|---|---|
| Accounts in same order as portfolio page | 1 |
| Balance + details hidden by default | 2, 5 |
| Eye icon reveals | 3 |
| Parity scope (header only, tables untouched) | 4 |
| No regression (flags, selection, tabs) | 6 |

## Notes

- The shared `pd-show-amounts` key is deliberate — opting in on either
  page un-masks both. If per-page prefs are preferred instead, that's a
  design decision to raise — not a bug.
- Review's forward observations (out of scope): `trading-config-dialog`
  pickers show raw API order; `portfolio-gallery-header` renders
  unmasked totals — candidates for a separate parity issue.
