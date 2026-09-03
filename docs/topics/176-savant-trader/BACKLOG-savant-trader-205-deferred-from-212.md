**Topic:** Savant Trader — deferred fixes from #212 UAT cleanup
**Issue:** #205
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** Backlog
**Status:** Open
**Created:** 2026-09-03
**Last Updated:** 2026-09-03

---

## Purpose

Tracks architectural and correctness fixes identified during the #212 code review (see `CODE-REVIEW-savant-trader-176-212-r2.md`) that should be addressed as part of the #205 decision pipeline simplification. These are not new features — they are existing problems in the accept/stage/order flow that the #205 refactor will naturally touch.

---

## Items

| # | Finding | File(s) | Notes |
|---|---------|---------|-------|
| D1 | Order-construction logic in review facade | `signal-review.facade.ts` lines 58-99, 445-474 | Extract to `SignalOrderBuilder` service. The facade should not build order intents — #205 collapses decisions and tickets into one collection, so this logic moves naturally. |
| D2 | `OrderTicketComponent` is 639 lines | `order-ticket.component.ts` | Extract stop-loss logic into separate component or service. Will be easier once #205 simplifies the ticket model. |
| D3 | `acceptSymbol` is non-atomic | `signal-review.facade.ts` line 365 vs 452-455 | Persists ACCEPT before checking account config — a missing account leaves an accepted signal with no staged order. #205's single-collection model makes accept+stage one write, fixing this. |
| D4 | Potential infinite loop in facade effect | `signal-review.facade.ts` lines 198-203 | Reads `activeRunId()` then writes `setActiveRun()` — wrap write in `untracked`. |
| D5 | `fetchAccountSnapshot` has no cancellation | `order.component.ts` lines 145-153 | Rapid signal changes launch overlapping fetches — add AbortController or switchMap. |
| D6 | Stop-loss bidirectional sync clobbers manual input | `order-ticket.component.ts` lines 391-401 | `onStopPriceInput` updates percent, which triggers effect to rewrite price — needs debounce or flag guard. |
| D7 | `saveEdits` drops option quantity | `order-ticket.component.ts` lines 413-419 | Only saves quantity for equity/ETF — add option branch. |
| D8 | `ngOnInit` subscription leak | `order.component.ts` lines 167-176 | Subscribes to `loadConfig()` without `takeUntilDestroyed`. |
| D9 | Hidden coupling: stop-loss from store | `order-ticket.component.ts` lines 173-180 | Ticket reads `stagingStore.intents()` directly — should receive stop-loss intent as input from parent. |
