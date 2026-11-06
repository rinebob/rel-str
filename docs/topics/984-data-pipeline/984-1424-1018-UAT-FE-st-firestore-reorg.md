**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #996  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1018  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# UAT — #1018 FE-IMPL: ticket UX (cancel_pending, fillSummary, lastError)

QA issue: #1424 · Code review: `984-996-1018-CODE-REVIEW-FE-st-firestore-reorg.md` (PASS, 2 rounds)

## Getting to the feature

- **Route:** `/trading/live` — the signal-order page (ticket queue left, selected ticket detail right).
- Needs live RH orders to exercise cancel_pending/fills end-to-end; several states are spec-pinned because staging them live needs real broker actions.

## Scenarios

| # | Scenario | How to exercise | Expected | Evidence |
|---|---|---|---|---|
| S1 | cancel_pending pending state | Cancel a live submitted ticket (Modify→Cancel or Cancel button) | Badge CANCEL_PENDING (warning color), "Cancellation pending…" indicator replaces Modify/Cancel, Refresh from Broker stays; ticket sits in queue "Cancelling" group with warning dot | PASS — user-verified live 2026-11-05 |
| S2 | Fill row on filled ticket | Ticket whose canonical doc has `fillSummary` (a live filled order after reconcile) | Fill row `qty @ $price · <date:'short' timestamp>` in confirmation section | PASS — user-verified live 2026-11-05 |
| S3 | Stop-loss own exit fill | Filled stop-loss ticket detail | Stop's exit fill row in detail rows (distinct from "Protecting" entry fill) | PASS — spec-pinned (component.spec 804-818) |
| S4 | lastError on failed ticket | FAILED ticket with `lastError{category,message}` | Error section shows message + category code | PASS — spec-pinned |
| S5 | No bogus Fill on resting stop-limit | Working `stop_limit` RH order → `rh-stop-*` row / merged resting limit | NO "Fill" row — the r2 regression pin | PASS — user-verified live 2026-11-05 |
| S6 | Non-editable bookkeeping lastError | SUBMITTED ticket carrying lastError | Hint "Recorded at last broker sync…" (no Edit promise); SUBMITTED + Refresh button → refresh wording | PASS — spec-pinned |
| S7 | Expired stop no longer "protects" | Let a live stop TIF-expire | Position loses PROTECTED badge, stop-placement UI reappears, no `rh-stop-*` row, expired buy releases notional | PASS — spec-pinned (broker-order.util.spec r2) |
| S8 | Stop-loss header badge styled | Any stop-loss ticket detail | Header badge visibly colored (was unstyled pre-#1018) | PASS — user-verified live 2026-11-05 |
| S9 | Regression — staged/submitted/cancelled rows | Normal queue browsing | Unchanged rendering | PASS — user-verified live 2026-11-05 |

## Automated evidence

- 7 touched-area suites / 378 tests green: `order.component`, `order-ticket.component`, `order-queue`, `order-execution.service`, `order-ticket-st-mapper`, `order-ticket.store`, `broker-order.util`.
- Full suite (pre-r2): 300/300 suites, 5,222 tests.
- `tsc -p tsconfig.app.json --noEmit` clean post-r2.

## Results log

- **2026-11-05 — PASS.** User smoke on `trading/live`: cancel_pending lifecycle, Fill row w/ timestamp, no bogus Fill on resting stop-limit, styled stop-loss badge, regression browse — all verified live. S3/S4/S6/S7 closed as spec-pinned.

## Findings

- UX observation (not a defect): `trading/live` has no top-nav link — reached only via gallery-card/ticket-dialog/chart-view/signal-review navigations. User suspected deprecation; verified it's actively wired, but discoverability is low. Flag for a future navigation polish task if desired.

## Result

**PASS** — QA #1424 resolved; task #1018 cleared to ship.
