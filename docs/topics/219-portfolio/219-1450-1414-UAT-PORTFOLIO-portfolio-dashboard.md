**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1450  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1414  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete — user-verified 2026-11-07 — PASS  
**Created:** 2026-11-07  
**Last Updated:** 2026-11-07  

# UAT — #1414: Positions-table stop columns + UNPROTECTED marker

QA issue: #1450 — QA: Positions-table stop columns + UNPROTECTED marker
Review: `219-1407-1414-CODE-REVIEW-PORTFOLIO-portfolio-dashboard.md`
(PASS, 2 rounds — r1: long-only protectedSymbols + pending-state fix;
r2: derive-failure settles to '—' instead of perpetual '…')

## Scenarios

### 1. Protected rows show the live stop

- **Steps:** Dashboard → Equities tab on an account with stop orders.
- **Expected:** Stop column quotes the real order's `stopPrice` —
  cross-check against Open Orders (same live order, highest of a
  ladder). Dist shows signed `$` + `%` from current to stop
  (`-$15.00 (-8.6%)` style). Hover → tooltip carries
  `type · qty · TIF · since <date>`.
- **Result:** PASS (user-verified)

### 2. UNPROTECTED marker + Add Stop

- **Steps:** A position with no live protective stop.
- **Expected:** Red-bordered `UNPROTECTED` chip in the Stop column —
  never blank — and the Add Stop action present in Actions.
- **Result:** PASS (user-verified)

### 3. Peak + Retr% land after positions

- **Steps:** Hard-reload → watch Peak/Retr% columns as the #1413 derive
  completes behind the painted table.
- **Expected:** `…` while deriving → peak price (hover = peak date) +
  retraced% (red on drawdown, green past the peak). Underivable symbols
  (transfers — margin account's GPRO) settle to `—` in both cells.
- **Result:** PASS (user-verified)

### 4. Stop-limit row

- **Steps:** Any stop-limit protective order (or simulate — none live
  is acceptable to skip if confirmed absent on all accounts).
- **Expected:** Stop column shows its price with a `stop-limit`
  tooltip; Actions shows the disabled Add Stop fallback, no Update
  Stop (existing eligibility rule).
- **Result:** PASS (user-verified)

### 5. No regression

- **Steps:** Sort each of the four new headers (Stop, Dist, Peak,
  Retr%); switch tabs and accounts; check totals row alignment.
- **Expected:** Sorts work with nulls last in both directions; Open
  Orders/History unchanged; totals row aligns under the right columns;
  no new console errors.
- **Result:** PASS (user-verified)

## Live findings (user-reported, logged during UAT)

- **Open Orders hides stop sells by design** — `isOpeningOrder` drops
  leg-less sell orders; protective stops are live-but-closing, visible
  nowhere in the tab. Logged on #1411 (audit fodder); #889 presumes
  stops listable there.
- **Table width** — 13 columns squeezed at `width:100%`; fixed with
  `white-space: nowrap` so `.pd-table-wrap` scrolls horizontally
  instead of clipping Actions.
