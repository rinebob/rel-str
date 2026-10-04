# ADR-009: Gallery card layout becomes the primary workflow surface

**status:** accepted  
**issue:** #749  
**topic parent:** #743  
**thread parent:** #744  
**date:** 2026-10-03  
**decision owners:** savant-trader  

## context

The Order Ticket Gallery began as a targeted replacement for the `signals/review` + `trading/live` double-review flow. During planning the intent broadened: the trader processes the daily workflow as a sequence of "review many charts side by side, then act" steps — existing positions (exit / move stop / no action), new signal triage, order configuration, order placement, and follow-up management. Every one of those steps is the same shape: a scrollable set of cards, each carrying a chart and a small action set. Single-chart-at-a-time detail views are the current bottleneck.

## decision

The **gallery card layout is the primary workflow surface** for the app, not a niche page. Concretely:

- The gallery shell — responsive 3–4 column card grid, sort/filter rail, selection model, and the "acted cards sink to the end" ordering rule — is **card-type-agnostic**. Signal cards are the first card type (Thread `gallery-view-page`); position-review and order-management card types land in later Threads under Topic `order-ticket-gallery-view`, on the same page surface.
- **Data is loaded eagerly; rendering is deferred.** The full signal set and indicator-series data prefetch on page enter — the gallery is the workhorse surface users land on first. Chart *mount* is deferred (`@defer (on viewport)`, render-all fallback) because chart instances are the heavy resource, not the data.
- **Cards are multi-selectable** (click / ctrl+click / shift-range / select-all-visible). Bulk actions are limited to non-order operations (Reject, Watch) in this Thread; the selection model is built to be extensible if bulk order actions are added later.
- **The shell is generalized now; card types are not.** The selection/sort/sink machinery is built once against a card contract. Abstracting the card types themselves is deliberately deferred until the second card type (positions review) exists — a framework designed around one card type guesses its seams wrong.
- A detail page per card is anticipated but not designed in this Thread.

## consequences

- Later Threads (positions review, resting-limit stop follow-ups, order management) plug new card types into the existing shell rather than building parallel pages.
- Eager data load adds one indicator-series call per visible symbol at page enter — accepted, the volume is small and the cache is shared with other surfaces.
- `signals/review` and `trading/live` remain reachable during transition; the run dashboard redirects to the gallery once the page proves stable (cleanup Thread).
