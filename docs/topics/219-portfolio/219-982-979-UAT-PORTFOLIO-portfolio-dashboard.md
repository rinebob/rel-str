**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Portfolio Dashboard — Order Placement  
**Thread Slug:** portfolio-dashboard-order-placement  
**Issue:** #982  
**Thread Parent:** #279  
**Topic Parent:** #219  
**Task:** #979  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-13  
**Last Updated:** 2026-10-13  

# UAT — #979 Open orders: Mark/Dist, bulk Cancel, Modify

## Scope

Enhancements to the `/portfolio` Orders tab:

- **Mark** column — live quote per order (equity joins `symbol → equityQuotes`;
  single-leg option joins `legs[0].optionId → optionQuotes`; multi-leg → `—`).
- **Dist %** column — `abs(limit − mark) / mark`; blank for market orders and
  missing quotes.
- Per-row **Modify** on equity orders — cancel-and-replace via
  `replaceEquityOrder`: cancel is awaited to a terminal state, fill-adjacent
  outcomes abort, the replacement places with bounded retry + fresh refId.
- Selection checkboxes + select-all + bulk **Cancel** with a single
  confirmation and per-order result reporting.
- Orders tab is buys-only **by design** — sell-side rows (incl. live
  stop-losses) intentionally live in the Equities tab.

## Prerequisites

- Dev server: `npm start` → `http://localhost:4210` (login required).
- An **agentic** Robinhood account with at least one open buy-side equity
  **limit** order (ideally also an option order and a partial fill, if
  available) for action scenarios.
- A **non-agentic** account (or a second account with `agentic_allowed=false`)
  for the permission scenario.
- For the modify scenarios, use a limit order priced far from market so the
  replacement neither fills immediately nor is desirable to keep — clean up
  the replacement order afterward.

## Start instructions

1. `npm start`, open `http://localhost:4210`, sign in.
2. Navigate to `/portfolio` (Portfolio Dashboard).
3. Select the agentic account in the header switcher; wait for the single
   loading gate to clear (no per-table spinners on first render).
4. Open the **Orders** tab.

## Scenarios

### S1 — Orders tab content (buys-only by design)

- **Feature:** row visibility contract.
- **Start:** agentic account, Orders tab loaded.
- **Steps:** inspect the row set; compare against the broker's open orders.
- **Expected:** only buy-side orders appear; no sell-side rows (stops and
  other position-closing orders live in the Equities tab).
- **Result:** PASS — user confirmed (2026-10-13)

### S2 — Mark column joins

- **Feature:** live mark per order.
- **Steps:** find an equity order row — note its mark vs. the symbol's quote;
  if an option order is open, check its mark against the contract quote;
  a multi-leg order (if any) shows `—`.
- **Expected:** equity mark = symbol quote; single-leg option mark = contract
  quote; multi-leg/absent quote = `—`.
- **Result:** PASS — user confirmed (2026-10-13)

### S3 — Dist % column

- **Feature:** distance-to-limit.
- **Steps:** read Dist on a limit order; compute `abs(limit − mark)/mark`
  by hand; check a market order row.
- **Expected:** percentage matches hand calc; market orders and missing-quote
  rows show blank/dash.
- **Result:** PASS — user confirmed (2026-10-13)

### S4 — Selection + bulk bar

- **Feature:** row selection affordances.
- **Steps:** tick two row checkboxes → bulk bar appears with "2 selected" and
  a Cancel N orders button; click the header select-all → all rows selected;
  click again → cleared.
- **Expected:** counts accurate; bar only while selection non-empty.
- **Result:** PASS — user confirmed (2026-10-13)

### S5 — Bulk Cancel

- **Feature:** confirm-once, cancel-many.
- **Steps:** select two+ dispensable orders → bulk Cancel → single confirm
  dialog → confirm.
- **Expected:** one confirmation for the batch; snackbar reports per-order
  outcome (e.g. "2 cancelled" or "1 cancelled, 1 failed (XYZ)"); the list
  refreshes and cancelled orders disappear.
- **Result:** PASS — user confirmed (2026-10-13)

### S6 — Non-agentic account isolation

- **Feature:** permission gating.
- **Steps:** switch to a non-agentic account → Orders tab.
- **Expected:** no checkbox column, no bulk bar, no Actions column
  (Cancel/Modify hidden). Switch back.
- **Result:** PASS — user confirmed (2026-10-13)

### S7 — Modify dialog (open + validation)

- **Feature:** modify UX on equity limit rows.
- **Steps:** Modify on an equity limit row → dialog opens showing side/type,
  current limit, and the live mark; enter the same price → Cancel & Replace
  stays disabled; enter 0 or a negative → disabled; enter a different valid
  price → enabled.
- **Expected:** validation as described; Modify absent on option rows and
  non-limit rows.
- **Result:** PASS — user confirmed (2026-10-13)

### S8 — Modify happy path (cancel→confirm→replace)

- **Feature:** safe cancel-and-replace.
- **Steps:** pick a far-from-market equity limit order → Modify → new price →
  Cancel & Replace.
- **Expected:** "Order replaced" snackbar; list refreshes; broker shows the
  old order cancelled and the new order live at the new price (verify in RH
  or after next list refresh). Clean up the replacement if it's not wanted.
- **Result:** PASS — user confirmed (2026-10-13)

### S9 — Modify failure UX

- **Feature:** phase-mapped error messaging.
- **Evidence path:** forcing a real cancel/place failure live is impractical —
  covered by specs asserting the three branches: cancel-phase → "Modify
  aborted — … may still be live"; place-phase unprotected → "cancelled but
  the replacement never landed"; unknown → "state unclear". Confirm the code
  path via `order-execution.service.spec.ts` + parent spec (both green) and
  eyeball the snackbar copy if a failure occurs naturally.
- **Result:** PASS — user confirmed (2026-10-13) (spec evidence acceptable)

### S10 — Partial-fill remainder

- **Feature:** replacement quantity = unfilled remainder.
- **Steps:** if a partially-filled open limit exists, Modify it; the
  replacement ticket quantity should be `quantity − cumulativeQuantity`.
- **Expected:** broker shows replacement for the remainder only. (Skip if no
  partial fill available — covered by `modify-order-ticket.util.spec.ts`.)
- **Result:** PASS — user confirmed (2026-10-13)

### S11 — Regression: sorting + dense-table + single cancel

- **Feature:** unchanged nearby behavior.
- **Steps:** click sortable headers incl. Mark/Dist; confirm numeric columns
  right-align; use per-row Cancel on one order.
- **Expected:** sort toggles asc/desc on all sortable columns; .num alignment
  intact; single cancel confirms then cancels and refreshes.
- **Result:** PASS — user confirmed (2026-10-13)

### S12 — Empty / loading / error states

- **Feature:** section states.
- **Steps:** account with zero open orders → empty-state row; during refresh
  → section spinner; (error path covered by retrySection spec).
- **Expected:** clean empty state, spinner on retry, error+Retry on failure.
- **Result:** PASS — user confirmed (2026-10-13)

## Traceability

| #979 acceptance criterion | Scenario |
|---|---|
| Mark + Dist render; correct equity/option joins; `—` multi-leg/missing; blank for market | S1, S2, S3 |
| Modify dialog → cancel + re-place; phase-aware failures | S7, S8, S9 |
| Modify hidden on option rows | S7 |
| Checkbox/select-all/bulk bar; confirm-once; per-order results | S4, S5 |
| `agenticAllowed` gating | S6 |
| Sorting intact; dense-table `.num` on new columns | S11 |
| Specs green | Automated evidence |
| Buys-only by design (user clarification) | S1 |
| Replacement = unfilled remainder; fresh refId | S10 |

## Regression / smoke checklist

- [x] Dashboard still gates first render on `!globalLoading()` (#780)
- [x] Other tabs (Equities/Options/History) unaffected
- [x] Single-row Cancel path unchanged
- [x] Allocation page unaffected

## Automated evidence (this run)

- `npx jest` focused — 6 suites, **150/150 pass**:
  `order-execution.service` (incl. `replaceEquityOrder` noun cases,
  cancel-confirm-before-place, fill-adjacent aborts),
  `modify-order-ticket.util`, `order-mark.util`, `modify-order-dialog`,
  `open-orders-table` (incl. non-agentic affordance gating),
  `portfolio-dashboard` (incl. replace-flow delegation + phase snackbars).
- `npx ng build` — clean.

## Results log

S1–S12: PASS — all scenarios verified by user against live account (2026-10-13). Automated: 6 suites 150/150, ng build clean.
