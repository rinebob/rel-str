**Topic:** Signal Pipeline Maintenance  
**Topic Slug:** signal-pipeline-maint  
**Thread:** Misc fixes  
**Thread Slug:** misc-fixes  
**Issue:** #435  
**Thread Parent:** #434  
**Topic Parent:** #433  
**Domain:** SIGNAL-REVIEW  
**Type:** INVENTORY  
**Status:** Draft  
**Created:** 2026-09-19  
**Last Updated:** 2026-09-19  

# Item Inventory — Misc fixes lane

Living capture point for signal-pipeline maintenance items. Append one-liners under **Open Items** — no issue needed at capture time. When an item is ready to work, promote it to a task issue under the Thread's Blueprint (labeled `4_BACKLOG`) and move its entry to **Promoted** with the task number.

Scope reminder: run-dashboard, signal-review, chart-review, signal-order, signal-history, signal-action-report + supporting FE/BE code. Swing-analysis is out of scope.

## Open Items

<!-- Add items here, one line each: short description + where it lives (page/component). -->
- (empty — capture the next fix here)

## Promoted

| # | Item | Task | Status |
|---|------|------|--------|
| 1 | ACR actions disabled on prior runs — unlock all five actions on signal-review | #439 | 4_BACKLOG |
| 2 | Order queue header aggregates + real row data on signal-order | #440 | 4_BACKLOG |
| 3 | Heal jest-30 spec infra — jasmine shim gaps (`.calls`/`objectContaining`/`resolveTo`/`rejectWith`) + fakeAsync can't flush native `await`; ~98 failures across 43 suites at baseline | #447 | 4_BACKLOG |

## Parking Lot (maybe-out-of-scope)

<!-- Items that might be too big for the lane — park here until sized. -->
- (empty)
