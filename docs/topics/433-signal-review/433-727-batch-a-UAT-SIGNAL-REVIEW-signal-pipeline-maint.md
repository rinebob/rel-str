**Topic:** Signal Pipeline Maintenance  
**Topic Slug:** signal-pipeline-maint  
**Thread:** Misc fixes  
**Thread Slug:** misc-fixes  
**Issue:** #727  
**Thread Parent:** #434  
**Topic Parent:** #433  
**Task:** #707, #709, #717, #719, #723 (Batch A)  
**Domain:** SIGNAL-REVIEW  
**Type:** UAT  
**Status:** Complete — PASS  
**Created:** 2026-10-01  
**Last Updated:** 2026-10-01  

# UAT — Batch A: requeue refId, accept-toggle sync, live cost, purchasing power, bulk paper send

## Scope

Five maintenance items shipped together under Blueprint #438:

- **#717** — Requeueing a CANCELLED or FAILED (broker-terminal) ticket regenerates
  the Robinhood `refId`, clears terminal state (`result`/`error`/`terminalAt`), and
  persists before the ticket is actionable. The Modify path on a resting live
  order does the same. Prevents the 409 "Reference ID must be unique" loop.
- **#719** — Removing the last live ticket for a signal clears its occurrence
  decision, so the signal-review Accept toggle un-checks and the signal can be
  re-accepted (fresh ticket). Legacy hyphen-format decision ids are normalized.
- **#723** — Limit/stop-limit tickets use the editable limit price as the cost
  basis; market tickets use the live quote. Cost and units recalc live as limit
  price or quantity change. Sell rows label the value "Proceeds".
- **#707** — The account header's available cash subtracts resting limit-buy
  notional (price x remaining qty) for non-terminal buys. Stop-limit buys are
  counted conservatively (RH does not distinguish triggered vs untriggered).
- **#709** — Checkboxes on staged rows only; Select all staged / Clear;
  "Send N to paper" converts checked eligible signal tickets to paper trades
  sequentially; failures stay staged with a row error and summary counts.

## Prerequisites

- Dev server running: `npm start` → http://localhost:4200 (verified running 2026-10-01)
- Signed-in session with the agentic account configured
- Paper trading enabled (paperSignalOrder callable deployed)
- At least one signal on the signal-review page to Accept (run a signal run
  first if the list is empty)
- DevTools for viewport resize (F12 → device toolbar)

## Start

1. Open signal-review (`/signals/review`) and Accept one signal — this stages a ticket.
2. Navigate to signal-order (`/trading/live` or the Order button).
3. Have the account header visible (Cash figure).

## Scenarios

| # | Task | Scenario | Steps | Expected |
|---|------|----------|-------|----------|
| 1 | #719 | Accept toggle clears on removal | Accept a signal → open signal-order → remove the staged ticket (checkbox → Remove selected, or row dismiss) → return to signal-review | The signal's Accept toggle is unchecked; re-accepting stages a fresh ticket |
| 2 | #719 | Surviving sibling keeps decision | (If two tickets share a signal — e.g. a signal staged twice historically) remove one ticket only | Toggle stays checked while a live ticket still references the decision |
| 3 | #717 | Requeue a cancelled order | Submit a limit order at a far-from-market price → Cancel it (row action) → row shows CANCELLED → Requeue | Ticket returns to Staged; submitting it again succeeds — no 409 "Reference ID must be unique" toast |
| 4 | #717 | Requeue a failed order | Any FAILED ticket row | Requeue button shown (not Submit); requeue returns to Staged with cleared error; subsequent submit is clean |
| 5 | #717 | Modify a resting order | Open a SUBMITTED/RESTING ticket → Modify → edit → ticket returns to Staged → Submit | Fresh refId — submits cleanly, no 409 |
| 6 | #717 | Terminal row affordances | CANCELLED / FAILED rows in the queue | Each shows Requeue + a dismiss (×) affordance; dismiss removes the row; SUBMITTED/RESTING rows show no checkbox and no dismiss |
| 7 | #723 | Limit cost basis live recalc | Stage or open a limit BUY ticket → edit limit price → edit quantity | Cost (=$) and units recompute immediately on each edit; cost = limit x qty |
| 8 | #723 | Market order basis | Open a market ticket | Cost/units derive from the live quote, not a stale price |
| 9 | #723 | Sell label | Open a limit SELL ticket | The value line reads "Proceeds" (not "Cost") |
| 10 | #723 | Queue row sizing basis | Queue shows a staged limit ticket alongside a staged market ticket | Limit row's $/shares reflect the limit price; market row reflects live quote — consistent with the detail pane |
| 11 | #707 | Purchasing-power hold | Note header Cash → place a resting limit BUY far below market (won't fill) → observe header | Available cash drops by qty x limit; a "held"/resting-buy figure is visible; cancelling the order restores the cash |
| 12 | #707 | Exclusions | Inspect header while market orders, sell orders, and a partially-filled buy are resting | Only non-terminal limit/stop-limit BUYS subtract; sells/market/cancelled orders do not; partial fill subtracts remaining qty only |
| 13 | #709 | Staged-only checkboxes | Queue with a mix of staged / submitted / terminal rows | Checkboxes appear on Staged rows only |
| 14 | #709 | Select all + Clear | Check a couple rows → Select all staged → Clear | Select-all checks every staged row; Clear unchecks all |
| 15 | #709 | Bulk send to paper | Check 2+ staged signal tickets → "Send N to paper" | Each converts to PAPER status; paper trades appear in the paper-trading surface; summary snackbar reports sent count |
| 16 | #709 | Ineligible tickets skipped | Include an option ticket or manual ticket in the checked set (if any) | Skipped — counted in the summary; not sent |
| 17 | #709 | Failure path | (If a send fails — e.g. ticket with no quantity and no dollarAmount) | Failed ticket stays STAGED with a visible error on the row; summary reports the failure count |
| 18 | #709 | In-flight guard | During a multi-ticket send, try clicking Send again / removing a sending row | Send button disabled while in flight; mid-send rows can't be removed or RH-submitted |
| 19 | #709 | Selection pruning | Check a staged ticket → send it to paper → observe checked state | Converted ticket leaves the staged pool; its check does not resurrect if a new ticket appears |
| 20 | UI | Batch bar layout | Signal-order queue at wide and <1200px widths | Select all / Clear / Send N to paper / Remove selected render cleanly at both widths; no clipping or overlap |
| 21 | UI | Header hold legibility | Account header with a resting-buy hold active | Hold amount legible next to Cash at both breakpoints |
| 22 | Regress | Nearby-behavior smoke | Click through rows, single Submit, Remove, Modify/Cancel flows, signal-review accept/reject, header aggregates | All behave as before; console free of new errors |

## Automated evidence

- Focused savant-trader suites: 170 tests green
- Full suite: `npx jest` — 164 suites / 2391 tests green (2026-10-01, post-review state)
- `npx tsc --noEmit -p tsconfig.app.json` — clean

## Traceability

| Acceptance criterion | Scenarios |
|----------------------|-----------|
| #717 requeue regenerates refId, no 409 (cancelled + failed + modify) | 3, 4, 5 |
| #717 terminal dismiss available | 6 |
| #719 removal clears decision; re-accept stages fresh | 1, 2 |
| #723 limit basis, live recalc, Proceeds label, queue consistency | 7, 8, 9, 10 |
| #707 resting limit-buy hold, exclusions, partial fills | 11, 12 |
| #709 staged-only checks, select-all/clear, batch convert, skip, failure, guard, pruning | 13–19 |
| Batch bar + hold legibility | 20, 21 |
| No regressions | 22 |

## Execution log

| Scenario | Result | Evidence |
|---|---|---|
| 1 | FAIL → fixed | User repro: accepted SPCX (multi-signal symbol) → deleted staged ticket → toggle stayed checked. Root cause: `acceptSignals` persists one decision doc **per signal** but `buildSignalOrderTickets` dedups by symbol+side — the single ticket carried only the first signal's `decisionId`, so removal cleared 1 of N docs and a surviving sibling kept `latestBySymbol` = ACCEPT. Fix: `signalContext.decisionIds` carries every same-side decision id; `onRemoveTickets` clears each unreferenced id. Legacy single-`decisionId` tickets fall back to the old behavior. Specs added (facade + component). |
| 1 (retest) | PASS | Re-accepted SPCX post-fix, deleted staged ticket, toggle unchecked — user confirmed 2026-10-01 ("ok it works") |
| 2–22 | PASS | User-approved manual pass on live app 2026-10-01 ("rest of uat is approved") |

**Note for scenario-1 retest:** the orphaned SPCX decision docs from the failed run may still exist. Clicking the still-checked Accept toggles de-accept (`resetSymbol` clears all SPCX docs in the active run) — do that once before re-testing, then re-accept and repeat the removal check with a freshly staged ticket carrying `decisionIds`.

**QA verdict: PASS** — Batch A (#707, #709, #717, #719, #723) ready to ship.
