**Topic:** Signal Pipeline Maintenance  
**Topic Slug:** signal-pipeline-maint  
**Thread:** Misc fixes  
**Thread Slug:** misc-fixes  
**Issue:** #438  
**Thread Parent:** #434  
**Topic Parent:** #433  
**Task:** #705  
**Domain:** SIGNAL-REVIEW  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-29  
**Last Updated:** 2026-09-29  

# Code Review — FE: Queue cleanup (remove paper-order group + source-badge chips)

## Summary

Task #705 removes the Paper status group and PAPER badge from the signal-order
queue, removes all SIG/POS/MAN source-badge chips, and cleans up the resulting
dead code. Three review axes ran in parallel (Standards, Spec, Thermo-nuclear).
One major finding surfaced — a stale-selection dead end introduced by filtering
PAPER tickets out of the queue — and was fixed and re-verified within this
review cycle before gate evaluation. Final verdict: **PASS**.

## Files reviewed

- `src/app/features/savant-trader/components/order-queue/order-queue.component.ts`
- `src/app/features/savant-trader/components/order-queue/order-queue.component.html`
- `src/app/features/savant-trader/components/order-queue/order-queue.component.scss`
- `src/app/features/savant-trader/components/order-queue/order-queue.component.spec.ts`
- `src/app/features/savant-trader/pages/signal-order/order.component.ts`
- `src/app/features/savant-trader/pages/signal-order/order.component.spec.ts`

## Acceptance criteria (Spec axis)

| # | Criterion | Verdict |
|---|-----------|---------|
| 1 | Paper group removed from `groups()`; PAPER filtered from display, store/ledger untouched | Met — `visibleTickets` (`order-queue.component.ts:110`) + page-level filter (`order.component.ts:123`) |
| 2 | `paper-badge` removed from row template | Met — template + `.paper-badge` SCSS gone |
| 3 | SIG/POS/MAN source chips removed; `sourceBadge()` + CSS cleaned | Met — method, template block, SCSS, `OrderSource` import all removed |
| 4 | `onRemoveTickets` PAPER-guard revisited | Met — removed (dead once paper rows can't render); simplified to a plain loop |
| 5 | Specs updated, no regressions | Met — 71 tests in the two suites, all green; full suite 2238 green |

## Findings

### Major

- **Stale `selectedTicketId` dead-end after accept-as-paper** — accepting a
  selected ticket as paper dropped it from `allTickets` while `selectedTicketId`
  still pointed at it; `selectedTicket()` resolved null and the auto-select
  effect couldn't recover (it only fired on empty selection). Detail pane would
  dead-end on "Select an order" with a full queue.
  **Fixed:** the auto-select effect now clamps selection to visible tickets —
  if the selected id is absent from `allTickets`, it selects the first
  remaining row (`order.component.ts`, selection clamp in the fetch-prices
  effect). Matches the existing remove-then-auto-advance behavior.
  Covered by spec `re-selects the first visible ticket when the selected
  ticket leaves the queue`.

### Minor

- **`checkedIds` phantom removal** — a checked id could linger invisibly after
  its ticket transitioned to PAPER, and `removeChecked()` would emit it for
  deletion (the old paper-skip guard previously prevented this).
  **Fixed:** `removeChecked()` intersects checked ids with `visibleTickets`
  before emitting (`order-queue.component.ts`). Covered by spec `does not
  emit removal for checked ids whose tickets are no longer visible`.
- **Duplicated PAPER predicate at page + component layers** — `allTickets`
  filter and `visibleTickets` repeat the same predicate. Accepted: the page
  filter is required (selection, counts, auto-select all consume `allTickets`)
  and the component-level filter hardens the queue's own contract. Comments
  document the rule at both sites; if a future status needs the same
  treatment, promote to a named predicate then.
- **`ticketCount` dead code** — `order.component.ts` computed was never
  rendered. **Fixed:** removed along with its spec.

### Nit

- **Empty-state copy** — "No staged orders" shows even when the store holds
  only PAPER tickets. Cosmetic, pre-existing phrasing; left as-is.
- **`order-queue.component.spec.ts` ~650 lines** — above the 400-line smell
  threshold; cohesive single-component suite, non-blocking.

## Test results

- `order-queue.component.spec.ts` + `order.component.spec.ts`: **71/71 pass**
  (includes new specs for paper-exclusion, badge removal, select-all
  exclusion, invisible-checked-id removal, and selection clamp).
- Full suite: **161 suites / 2238 tests, all green.**

## Verdict

**PASS** — all acceptance criteria met; the one major finding was resolved and
re-verified in-cycle. Task is ready for the QA acceptance gate.

**Next:** `/proj qa 433 705`
