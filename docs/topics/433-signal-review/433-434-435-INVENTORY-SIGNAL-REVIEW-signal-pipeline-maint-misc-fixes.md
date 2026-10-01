**Topic:** Signal Pipeline Maintenance  
**Topic Slug:** signal-pipeline-maint  
**Thread:** Misc fixes  
**Thread Slug:** misc-fixes  
**Issue:** #435  
**Thread Parent:** #434  
**Topic Parent:** #433  
**Domain:** SIGNAL-REVIEW  
**Type:** INVENTORY  
**Status:** Complete  
**Created:** 2026-09-19  
**Last Updated:** 2026-09-30  

# Item Inventory — Misc fixes lane

Living capture point for signal-pipeline maintenance items. Append one-liners under **Open Items** — no issue needed at capture time. When an item is ready to work, promote it to a task issue under the Thread's Blueprint (labeled `4_BACKLOG`) and move its entry to **Promoted** with the task number.

Scope reminder: run-dashboard, signal-review, chart-review, signal-order, signal-history, signal-action-report + supporting FE/BE code. Swing-analysis is out of scope.

## Open Items

<!-- Add items here, one line each: short description + where it lives (page/component). -->
- Limit-order trade cost must recalculate live when the user edits limit price or quantity in the ticket detail pane (order-ticket.component on signal-order)
- Staged orders: show signal price + live price + %Δ like other groups — works for tickets staged post-#706, but pre-existing staged tickets lack stored `signalPrice` and fall back to limit anchor. Options: backfill `signalPrice` from the signal doc via `signalContext`, or accept the gap (re-staged tickets get it naturally). Non-signal (manual) staged tickets have no signal price — define expected display for those

## Promoted

| # | Item | Task | Status |
|---|------|------|--------|
| 1 | ACR actions disabled on prior runs — unlock all five actions on signal-review | #439 | 8_LIVE |
| 2 | Order queue header aggregates + real row data on signal-order | #440 | 4_BACKLOG |
| 3 | Heal jest-30 spec infra — jasmine shim gaps (`.calls`/`objectContaining`/`resolveTo`/`rejectWith`) + fakeAsync can't flush native `await`; ~98 failures across 43 suites at baseline | #447 | 8_LIVE |
| 4 | Remove Paper status group + PAPER badge from order queue — once paper, this page doesn't care | #705 | 8_LIVE |
| 5 | Remove SIG/POS/MAN source-badge chips from queue rows — dead space | #705 | 8_LIVE |
| 6 | Anchor→current→%Δ columns on queue rows — signal price at generation / avg cost / order price | #706 | 8_LIVE |
| 7 | Purchasing power nets out resting limit-buy notional | #707 | 4_BACKLOG |
| 8 | What-if: checked staged orders → staged-header aggregates (num/cost/units) + account-header what-if layer + readability pass | #708 | 4_BACKLOG |
| 9 | One-click bulk send of checked staged orders to paper trading (checkboxes scoped to the Staged group + single convert button) | #709 | 4_BACKLOG |
| 10 | Manual order entry — ESCALATED to own Thread (placement under discussion: lives on signal-order, possible light entry point on signal-review) | — | pending thread |
| 11 | BUG: requeue of a cancelled ticket reuses the burned RH `ref_id` → 409 "Reference ID must be unique". Regenerate `refId` on requeue (`onRequeueTicket`, order.component.ts) | #717 | 4_BACKLOG |
| 12 | BUG: Accept toggle on signal-review stuck ON after queue-ticket removal — can't de-accept/re-stage (PAYS/INTC case, 2026-09-30). Decision store ↔ staging store desync: removing a signal-sourced ticket orphans the accepted decision | #719 | 4_BACKLOG |

## Parking Lot (maybe-out-of-scope)

<!-- Items that might be too big for the lane — park here until sized. -->
- (empty)
