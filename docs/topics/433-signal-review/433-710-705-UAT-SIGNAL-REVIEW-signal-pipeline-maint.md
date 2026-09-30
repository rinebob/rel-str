**Topic:** Signal Pipeline Maintenance  
**Topic Slug:** signal-pipeline-maint  
**Thread:** Misc fixes  
**Thread Slug:** misc-fixes  
**Issue:** #710  
**Thread Parent:** #434  
**Topic Parent:** #433  
**Task:** #705  
**Domain:** SIGNAL-REVIEW  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-29  
**Last Updated:** 2026-09-29  

# UAT — FE: Queue cleanup (remove paper-order group + source-badge chips)

## Scope

Task #705 removes paper-trading orders and source chips from the signal-order
queue. Paper tickets remain in the store and paper ledger — they are only
removed from this page's display. Delivered behavior:

- No `Paper` status group and no `PAPER` row badge on the order queue.
- No `SIG` / `POS` / `MAN` source chips on any queue row.
- Paper tickets excluded from queue count, select-all, batch remove, and the
  staged aggregates.
- Selection clamps to visible tickets — a ticket accepted as paper while
  selected advances the detail pane to the next queue row (review fix).

## Prerequisites

- `npm start` (dev server at `http://localhost:4200`, includes the RH
  observation API on :3456).
- Logged in to Firebase auth; Robinhood session connected.
- Test data: at least two staged tickets in the queue (stage from
  signal-review if needed). For scenario 3, one ticket that will be
  accepted-as-paper.

## Start

1. `npm start` (already running if the app is live on :4200).
2. Navigate to `/trading/live` (signal-order page, e.g. from signal-review
   `Review Orders`).

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|----------|-------|----------|--------|
| 1 | No Paper group or PAPER rows | With at least one ticket previously accepted as paper, load `/trading/live` | Group headers are Staged / Open Positions / Submitted / Resting / Filled / Cancelled as populated — no `Paper` group, no `PAPER` chip on any row | PASS — jest spec + user visual confirm |
| 2 | No source chips on rows | Inspect rows across sources (signal-staged, position-derived, manual if present) | No `SIG`, `POS`, or `MAN` chips anywhere; row layout starts with checkbox → symbol → side/type | PASS — jest spec + user visual confirm |
| 3 | Selection survives accept-as-paper | Select a staged ticket → in the detail pane, Accept as Paper | The row leaves the queue AND the detail pane automatically selects the next visible row (no dead-end "Select an order" state with a populated queue) | PASS — jest spec + user confirm "Passes" |
| 4 | Count and select-all exclude paper | With a paper ticket in the store (accepted one in scenario 3), compare queue header count vs rows; use Select all | Count = number of rendered rows; paper ids are never checked; batch remove only emits visible rows | PASS — jest specs |
| 5 | Empty state | Queue with zero visible tickets (remove or paper all staged tickets) | "No staged orders" empty state renders; no stale chips or counts | PASS — spec asserts `totalCount` 0 → empty-state path; nit on copy noted in review |
| 6 | Regression — normal queue ops | Row select, requeue a CANCELLED ticket, PROTECTED badge on a protected buy, staged group aggregates | All behave as before; no console errors | PASS — user confirm "All good" |

## Automated evidence

The following criteria are covered by jest specs and do not require manual
re-verification; evidence is the passing suite:

- `order-queue.component.spec.ts` — "excludes PAPER tickets entirely"
  (no Paper group, no `.paper-badge`, count excludes paper),
  "does not include PAPER tickets in select-all",
  "does not emit removal for checked ids whose tickets are no longer visible",
  "does not render source badges" (SIG/POS/MAN all absent).
- `order.component.spec.ts` — "excludes PAPER tickets from allTickets"
  (pre- and post-RH-load), "re-selects the first visible ticket when the
  selected ticket leaves the queue".

Run: `npx jest src/app/features/savant-trader/components/order-queue src/app/features/savant-trader/pages/signal-order --coverage=false`

## Traceability

| Acceptance criterion (task #705) | Scenario / spec |
|----------------------------------|-----------------|
| 1. Paper group + PAPER filtered from display | S1, S4 + queue/page specs |
| 2. `paper-badge` chip removed | S1 + queue spec |
| 3. SIG/POS/MAN source chips removed, `sourceBadge()` + CSS cleaned | S2 + queue spec |
| 4. `onRemoveTickets` PAPER-guard revisited | S4 + page spec (removes every emitted id; hidden ids never emitted) |
| 5. Specs updated, no regressions | automated suite + S6 |
| Review fix: selection clamp after accept-as-paper | S3 + page spec |

## Smoke / regression checklist

- [ ] signal-order page loads, queue renders grouped rows
- [ ] row click selects and populates the detail pane
- [ ] checkbox select + Remove selected deletes only visible rows
- [ ] requeue button still works on CANCELLED rows
- [ ] PROTECTED badge still renders on protected buys
- [ ] staged group header aggregates unchanged
- [ ] no new browser-console errors on the page
