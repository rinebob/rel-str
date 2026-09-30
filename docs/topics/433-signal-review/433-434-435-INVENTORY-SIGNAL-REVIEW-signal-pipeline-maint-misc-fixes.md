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
**Last Updated:** 2026-09-29  

# Item Inventory â€” Misc fixes lane

Living capture point for signal-pipeline maintenance items. Append one-liners under **Open Items** â€” no issue needed at capture time. When an item is ready to work, promote it to a task issue under the Thread's Blueprint (labeled `4_BACKLOG`) and move its entry to **Promoted** with the task number.

Scope reminder: run-dashboard, signal-review, chart-review, signal-order, signal-history, signal-action-report + supporting FE/BE code. Swing-analysis is out of scope.

## Open Items

<!-- Add items here, one line each: short description + where it lives (page/component). -->
- (none — signal-order batch captured 2026-09-29 was promoted same day; see Promoted)

## Promoted

| # | Item | Task | Status |
|---|------|------|--------|
| 1 | ACR actions disabled on prior runs â€” unlock all five actions on signal-review | #439 | 4_BACKLOG |
| 2 | Order queue header aggregates + real row data on signal-order | #440 | 4_BACKLOG |
| 3 | Heal jest-30 spec infra â€” jasmine shim gaps (`.calls`/`objectContaining`/`resolveTo`/`rejectWith`) + fakeAsync can't flush native `await`; ~98 failures across 43 suites at baseline | #447 | 4_BACKLOG |
| 4 | Remove Paper status group + PAPER badge from order queue — once paper, this page doesn't care | #705 | 4_BACKLOG |
| 5 | Remove SIG/POS/MAN source-badge chips from queue rows — dead space | #705 | 4_BACKLOG |
| 6 | Live quote on open-order/position rows — current price, current value, % gain/loss vs RH avg cost basis | #706 | 4_BACKLOG |
| 7 | Purchasing power nets out resting limit-buy notional | #707 | 4_BACKLOG |
| 8 | What-if: checked staged orders → staged-header aggregates (num/cost/units) + account-header what-if layer + readability pass | #708 | 4_BACKLOG |
| 9 | One-click bulk send of checked staged orders to paper trading | #709 | 4_BACKLOG |
| 10 | Manual order entry — ESCALATED to own Thread (placement under discussion: lives on signal-order, possible light entry point on signal-review) | — | pending thread |

## Parking Lot (maybe-out-of-scope)

<!-- Items that might be too big for the lane â€” park here until sized. -->
- (empty)
