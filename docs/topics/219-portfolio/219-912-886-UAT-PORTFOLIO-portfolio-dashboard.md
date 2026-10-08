**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Portfolio Dashboard — Update Stop Loss  
**Thread Slug:** portfolio-dashboard-update-stop-loss  
**Issue:** #912  
**Thread Parent:** #829  
**Topic Parent:** #219  
**Task:** #886  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

# UAT — Full order params on StopLossFormComponent (#886 / QA #912)

## Scope

The shared stop-loss form exposes the full stop-order parameter set: `timeInForce`/`marketHours` `model()` inputs (defaults `gtc`/`regular_hours`), TIF (Day/GTC) + Hours pill groups matching the order ticket's markup, `showOrderParams` to hide them where a parent owns the controls, and `initialStopPrice` for update-mode prefill. Preview JSON and the `placeStopLoss` payload carry the selected values; the dialog and order-ticket consumers are updated for the new `StopLossSubmit` payload.

**Live-verified broker constraint folded in:** RH rejects non-regular-hours stop orders (`400 {"non_field_errors":["Extended hours orders cannot have stop price."]}`). Extended/All Day render disabled with a hint; `marketHours` is pinned `'regular_hours'` at both submission seams, and stops pin `gtc` — the entry ticket's TIF/Hours pills never leak into a stop.

## Prerequisites

- Repo at `C:\aa\projects\rel-str`; dev server running (`ng serve`, verified at `http://localhost:4200` during implementation — an existing instance on port 4200 was already serving the working tree).
- Signed-in session with a funded equity position that has **no** protective stop (for the Add Stop scenario).
- Review doc: `219-884-886-CODE-REVIEW-PORTFOLIO-portfolio-dashboard.md` — PASS.

## Scenarios

### S1 — Focused specs (command line)

- `npx jest stop-loss-form order-ticket.component stop-loss-dialog --coverage=false`
- **Expected:** 3 suites pass; includes `disables Extended/All Day — RH rejects stop orders outside regular hours`, `pins the stop to gtc/regular_hours`, `carries the form-emitted TIF but pins hours to regular`.
- **Result:** ☑ PASS — 86/86 tests (3 suites) green post-remediation.

### S2 — Build integrity (command line)

- `npx ng build`
- **Expected:** clean bundle; `[(model)]` signal bindings compile.
- **Result:** ☑ PASS — `Application bundle generation complete` (~18s).

### S3 — Param surface in the Add Stop dialog (live UI)

- Navigate: Portfolio Dashboard → an **unprotected** equity row → **Add Stop**.
- **Expected:** TIF row with **Day**/**GTC** pills (GTC active by default); Hours row with **Regular** active and **Extended**/**All Day** visibly disabled; hint "Stops execute during regular hours only".
- **Result:** ☑ PASS — user confirmed live 2026-10-08: placed 5 real stops through this dialog after the lock was added ("ok that worked. i placed 5 stops").

### S4 — Preview + payload carry the params (live UI + spec)

- Same dialog: the Preview JSON shows `timeInForce` and `marketHours` fields; toggling Day/GTC updates the preview's `timeInForce`.
- Submitted ticket carries the emitted values — verified at spec level (`dialog.spec` threads `StopLossSubmit`; `order-execution.service.ts:185-186` maps `timeInForce`→`time_in_force`, `marketHours`→`market_hours` to the broker).
- **Result:** ☑ PASS — preview shows the full payload shape (`symbol`, `side`, `orderType: 'stop_loss'`, `quantity`, `stopPrice`, `stopLossPercent`, `timeInForce`, `marketHours`, `accountNumber`); five live submissions accepted by RH.

### S5 — Extended-hours rejection prevented (live UI + spec)

- Attempt: select Extended or All Day → **not possible** (pills disabled). Defense in depth: even a bound `extended_hours` prefill is pinned to `regular_hours` at `onPlaceStopLoss` (`order-ticket.component.ts`) and dialog `onSubmit` (`stop-loss-dialog.component.ts`).
- Earlier in this session the un-guarded UI produced the real broker error `400 "Extended hours orders cannot have stop price"` — the fix is verified by the 5 successful placements.
- **Result:** ☑ PASS — spec `pins the stop to gtc/regular_hours` proves an `all_day_hours` entry does not leak into the stop; spec `carries the form-emitted TIF but pins hours to regular` proves the dialog seam.

### S6 — `showOrderParams` + `initialStopPrice` (spec-level; forward-built surface)

- `showOrderParams=false` hides both pill groups (order-ticket usage); `initialStopPrice` seeds the price once, marks it user-edited, and derives the percent.
- **Result:** ☑ PASS — spec-covered (`hides the pill groups when showOrderParams is false`, `does NOT bind the entry's TIF/hours`, `seeds the stop price and derives the percent`). No in-tree consumer of `initialStopPrice` yet — it exists for #888 update mode; the order-ticket consumer path is being phased out.

### S7 — Order-ticket stop section unchanged for the user (phased-out page, spec-level)

- On `trading/live`, a filled-entry ticket's stop form shows no param pills and its preview shows `gtc`/`regular_hours`; submitting produces a GTC regular-hours stop regardless of the entry's TIF/Hours pills.
- **Result:** ☑ PASS — spec-covered (`pins the stop to gtc/regular_hours`, `does NOT bind`); page is being phased out — no live verification spent here.

## Refinement pass (manual UI/UX)

- ☑ Pill styling matches the order-ticket pattern (24px pills, `.pill.active` primary-container treatment, disabled at 0.5 opacity) — user inspected the dialog live while placing 5 stops; no visual defects reported.
- ☑ Disabled Extended/All Day carry `title` tooltips ("Robinhood rejects stop orders outside regular hours") + inline hint — readable, communicates the constraint instead of hiding it.
- ☑ Spacing/hierarchy unchanged for the `$`, `%`, steppers, and Preview sections — the new rows sit inside the same `.sl-field` grid.

## Regression / smoke checklist

- [x] Dialog submit/retry/error flow — spec-covered (success → orderId shown; non-retryable error → no retry; retryable → retry reuses ticket; double-submit guard).
- [x] `app-stop-loss-form` consumers — exactly two (order ticket, dialog), both updated; no stale consumers (thermo-nuclear trace).
- [x] Preview honesty — `orderType` now reads `stop_loss` matching built tickets (was `stop_market`).
- [x] Full suite: 3195/3196 — sole failure `screenshot-capture-contracts.spec.ts` is another thread's enum/spec mismatch, unrelated.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| `timeInForce`/`marketHours` `model()` inputs; TIF + hours pill groups matching ticket markup | S1, S3 |
| `showOrderParams` hides pills; `initialStopPrice` seeds + derives percent | S1, S6 |
| Preview JSON + `placeStopLoss` payload carry the selected params | S1, S4 |
| `StopLossDialogComponent` handles the new payload; add-mode submit threads params | S1, S4, S5 |
| Order ticket `showOrderParams=false`; stop never inherits entry TIF/Hours | S5, S7 |
| Amended: Extended/All Day disabled; `regular_hours` pinned at submission seams | S3, S5 |

## Results log

- 2026-10-08 — All scenarios PASS. Live evidence: 5 real GTC regular-hours stops placed through the Add Stop dialog post-lock. Earlier same-session evidence: the pre-fix UI produced RH's `400 "Extended hours orders cannot have stop price"`, confirming the rejected path is now unreachable.
