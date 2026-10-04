**Topic:** Gallery Order Ticket View  
**Topic Slug:** order-ticket-gallery-view  
**Thread:** Gallery View Page  
**Thread Slug:** gallery-view-page  
**Issue:** #749  
**Thread Parent:** #744  
**Topic Parent:** #743  
**Domain:** GALLERY-VIEW  
**Type:** TEST  
**Status:** Approved  
**Created:** 2026-10-03  
**Last Updated:** 2026-10-04  

# Test Plan — FE: Gallery View Page

## E2E User Journeys

- **Journey 1 (triage → order):** run dashboard → "View Signal Gallery" → gallery shows one card per symbol+side for the latest completed run → hover ticket button shows derived order preview → click → ticket dialog opens on a staged whole-share ticket → submit → ACCEPT decisions written, card shows submitting → filled → stop-loss section appears → stop placed → card animates to the sunk end of the list.
- **Journey 2 (resting limit):** open ticket from a card → switch to limit order → submit → card shows resting styling in place (does not sink); ticket status visible on card.
- **Journey 3 (triage actions):** reject a card → durable REJECTs written for its occurrences, card removed → watch a card → symbol added to Monitor, card sinks → multi-select several cards → bulk reject removes all → bulk watch sinks all.
- **Journey 4 (cancel path):** open ticket dialog → close without submitting → staged ticket removed, no ACCEPT decisions exist, card returns to pending.
- **Journey 5 (filters/sorts):** apply timeframe/direction/list filters → visible cards update → switch sort (sector→industry→symbol / market cap→symbol / list) → unactioned order changes, sunk cards stay at the end.
- **Journey 6 (empty + legacy intact):** no-signal run → empty state; `signals/review` and `trading/live` still reachable.

## Integration Tests

- `GalleryFacade` + `SignalService`/run resolution: latest completed run's signals aggregate into `symbol+side` cards; D+W same-side occurrences merge into one card's `occurrences[]`.
- `GalleryFacade` + `OccurrenceDecisionStore`: reject writes one REJECT per contributing occurrence; rejected cards excluded for the viewed run; bulk reject iterates all selected cards.
- `GalleryFacade` + `SymbolListStore`: watch adds symbol to Monitor (idempotent when already a member); card status → watched → sinks.
- `GalleryFacade` + `OrderTicketStore`: stage-on-open creates quantity-based STAGED ticket with correct `signalContext`/`decisionId` provenance and **no** decision writes; submit path writes ACCEPT decisions + decisionIds then submits; cancel calls `removeTicket`; an existing staged ticket for the same symbol+side+run is reopened, not duplicated.
- `GalleryFacade` + `TradingConfigService`/sizing utils: `orderPreview` derives whole-share quantity (`computeUnits`), suggested stop (`stopPriceFromPercent`), order type/TIF from config — matching `trading/live` derivation.
- `GalleryCardComponent` + `IndicatorSeriesStore`/`FlexChartComponent`: chart cell renders the daily config with signal-dot extras; mount deferred to viewport.
- Ticket status → card state mapping: SUBMITTING/QUEUED/RESTING → resting-in-place; FILLED + stop confirmed → settled → sinks; FAILED/CANCELLED → sunk with error styling; PAPER → settled.

## Unit Tests

- `gallery-cards.util` (pure): symbol+side aggregation incl. same-symbol both-directions → two cards; filtering by timeframe/direction/list; ordering (sort keys × sunk-by-action-time); selection prune on filter change.
- `gallery-staging.util` (pure): quantity-based ticket builder — whole-share `quantity` (floored), no `dollarAmount`, `refId`/id/dedup/`signalContext.decisionIds` parity with `buildSignalOrderTickets`.
- `GalleryUiStore`: selection set toggling, range select over rendered order, select-all-visible, clear; sort/filter state transitions.
- Card status derivation: each status bucket maps correctly from ticket/monitor/decision inputs (pure function over view-model inputs).

## Test Seams

- **Highest seam: `GalleryFacade`** — facade specs (`gallery.facade.spec.ts`) with mocked domain stores/services, asserting card aggregation, action→durable-write mapping, and ticket sequencing. Prior art: `signal-review.facade.spec.ts`.
- **Component seam:** `gallery-card.component.spec.ts`, `gallery-view.component.spec.ts` — render cards from stubbed facade outputs, assert DOM states (chips, sunk styling, selection, bulk bar). Firebase tokens stubbed per AGENTS.md; async paths flushed via `setTimeout(r,0)` macrotask, not `fakeAsync`.
- **Dialog seam:** ticket dialog host spec asserts the staged ticket id is passed to `OrderTicketComponent` and close-without-submit calls `removeTicket` — do not re-test `OrderTicketComponent` internals (covered by `order-ticket.component.spec.ts`).

## Edge Cases

- No completed run / run in progress → empty state, actions inert.
- Both-directions same symbol → two cards; reject one leaves the other.
- Already-Monitor symbol watched → no duplicate/error; card still sinks.
- Existing staged ticket for symbol+side → reopened, not duplicated.
- Rejected earlier in session → stays out for that run; next run's signals produce fresh cards.
- Chart fetch failure → that card's chart shows error placeholder; grid unaffected.
- Selecting cards then changing filters → selection pruned to visible cards.
- All cards actioned → gallery shows only the sunk section; sort control still functions on empty unactioned set.
