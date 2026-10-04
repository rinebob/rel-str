**Topic:** Gallery Order Ticket View  
**Topic Slug:** order-ticket-gallery-view  
**Thread:** Gallery View Page  
**Thread Slug:** gallery-view-page  
**Issue:** #749  
**Thread Parent:** #744  
**Topic Parent:** #743  
**Domain:** GALLERY-VIEW  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-10-03  
**Last Updated:** 2026-10-03  

# Implementation Plan — FE: Gallery View Page

## 1. Overview

Build the Order Ticket Gallery at `trading/gallery`: a responsive 3–4 column grid of cards, one card per symbol+side aggregating the latest completed run's signal occurrences. Each card shows minimal signal details, a compact daily chart (quick-charts daily config), and a ticket button with a hover order preview. Actions: act (OrderTicket modal), reject (durable REJECTs), watch (symbol → Monitor). Multi-select supports bulk reject + watch. Settled/watched cards sink to the end. Entry via "View Signal Gallery" on the run dashboard; `signals/review` and `trading/live` stay live.

Platform direction per ADR-009: the shell (grid, sort/filter rail, selection model, sunk section) is card-type-agnostic; the signal card is the first card type. Card-type abstraction is deferred until the positions thread adds a second type.

## 2. Architecture

### Seam model (mirrors `SignalReviewFacade` + `SignalReviewUiStore`)

- **`GalleryFacade`** (`@Injectable root`) — page-level orchestrator and test seam. Composes the existing domain stores; owns page enter/leave (eager data load), card view-model computeds, and all mutations (reject, watch, stage/submit/cancel sequencing, bulk ops).
- **`GalleryUiStore`** (`signalStore`) — ephemeral UI state: timeframe/direction/list filters, sort key, selection set, sunk order (action-time ordering). Nothing durable lives here.
- **Domain stores reused as-is:** `SymbolListStore` (lists, Monitor toggle, activeListFilter, profiles), `OccurrenceDecisionStore` (durable ACCEPT/REJECT reads/writes), `OrderTicketStore` (ticket lookup/status, stageTicket, removeTicket, updateTicket, submitTicket), `StStore`/`SignalService` (latest completed run + its signals), `IndicatorSeriesStore` (chart data cache), `ChartStore` (chart config inputs), `TradingConfigService` (sizing defaults), `SymbolHistoryStore` if needed for occurrence detail.

### Card view-model

Derived computed in the facade: `GalleryCard` — `{ key: symbol+side, symbol, side, profile (name/sector/industry/marketCapTier), occurrences: StSignalItem[], signalPrice, status: 'pending'|'submitting'|'resting'|'settled'|'failed'|'watched'|'sunk', ticket?: OrderTicket, orderPreview: OrderPreview }`.

Card status derivation:
- `watched` — symbol ∈ Monitor (post-action)
- `resting` — ticket SUBMITTED/QUEUED/RESTING, no fill
- `settled` — stop confirmed, or entry filled (whole-share stop placed), or terminal PAPER
- `failed` — ticket FAILED/CANCELLED
- `pending`/`submitting` — no ticket or SUBMITTING

`OrderPreview` — `{ side, quantity (whole shares via computeUnits), orderType, timeInForce, limitPrice?, suggestedStop (stopPriceFromPercent on signal closePrice), estNotional }` — same utils/config as `trading/live`.

## 3. Component tree

```
GalleryViewComponent (page, /trading/gallery)
├── GalleryHeaderComponent
│     ├── filter pills (timeframe, direction) + list selector   ← reuse SignalFilterPillsComponent / RhSelectMenuComponent
│     ├── sort selector (sector→industry→symbol | market cap→symbol | list)
│     ├── run-date/status strip                                  ← reuse RunMetricsStripComponent (light)
│     └── bulk action bar (visible when selection nonempty): Reject N / Watch N / Clear
├── GalleryGridComponent — responsive grid, 3–4 cols (CSS grid, minmax ~380–480px)
│     └── @for card of orderedCards
│           └── GalleryCardComponent (first card type: signal)
│                 ├── header: symbol, name, direction chip, selection checkbox
│                 ├── occurrence chips (timeframe + signalType, barDate, closePrice)
│                 ├── chart cell → @defer (on viewport; prefetch on idle) GalleryCardChartComponent
│                 │                    └── FlexChartComponent (daily config from quick-charts)
│                 ├── footer: order-ticket button (hover → OrderPreviewPopup) + Reject + Watch
│                 └── sunk/ordered styling variants + ticket-status line
└── OrderTicketDialogComponent — MatDialog host wrapping OrderTicketComponent (ticket input)
```

Selection model: click toggles (with checkbox affordance), ctrl+click toggles, shift+click range-selects over the currently rendered order, "select all visible" in the bulk bar. Selection lives in `GalleryUiStore` as a `Set<cardKey>`.

## 4. Data flow

### Page enter (`facade.enterGallery()`)

1. Resolve latest completed run (`isCompletedRun`) — same path signal-review uses.
2. Eager loads (all kicked off together; the gallery is the workhorse surface):
   - run's signal occurrences (`SignalService`)
   - occurrence decisions (`OccurrenceDecisionStore.load`)
   - symbol lists + Monitor membership + profiles (`SymbolListStore`)
   - tickets (`OrderTicketStore.loadTickets`)
   - trading config (sizing defaults)
3. Cards computed from signals → grouped `symbol+side` → filtered (timeframe/direction/list) → minus rejected → ordered (sort + sunk-at-end by action time).
4. Indicator-series data per card prefetches as cards enter view via `prefetch on idle`/`on viewport`; full eager prefetch of all visible symbols' chart data on idle after first paint (data volume is small — see ADR-009).

### Act flow (per card)

1. Ticket button → `stageTicket` (quantity-based whole-share ticket built by the gallery's staging builder — `buildSignalOrderTickets` variant emitting `quantity` not `dollarAmount`; **no decision writes**) → open `OrderTicketDialogComponent` bound to the staged ticket id.
2. Dialog **submit** → write ACCEPT `StOccurrenceDecision`s for contributing occurrences + attach `decisionIds` → `submitTicket`. Decisions only materialize on actual order placement.
3. Dialog **cancel/close without submit** → `removeTicket` (deletes the staged ticket; no decisions exist to clean).
4. Card reacts to ticket status via `OrderTicketStore` — submitting styling → resting (limit) stays in place / filled → stop-loss section in ticket → settled → sink to end.
5. Paper path unchanged (`isPaperEligibleTicket` → paper send; PAPER counts as settled).

### Reject flow

Per card and bulk: write durable `REJECT` decisions for each contributing occurrence (`OccurrenceDecisionStore`), card drops from gallery.

### Watch flow

Per card and bulk: `SymbolListStore.toggleMonitor(symbol)` → card marked watched → sinks to end.

### Ordering

`orderedCards` = unactioned cards in active sort; then sunk cards (acted/watched/failed) by action timestamp desc. Sort keys: `sector→industry→symbol`, `marketCapTier→symbol`, `list→symbol` (list sort groups by the card's exclusive-list membership then key order).

## 5. Module/file layout (feature-local)

```
features/savant-trader/pages/gallery-view/
  gallery-view.component.{ts,html,scss,spec.ts}
features/savant-trader/components/gallery-header/
features/savant-trader/components/gallery-grid/
features/savant-trader/components/gallery-card/
features/savant-trader/components/gallery-card-chart/
features/savant-trader/components/order-preview-popup/
features/savant-trader/components/order-ticket-dialog/
features/savant-trader/stores/gallery.facade.ts (+spec)
features/savant-trader/stores/gallery-ui.store.ts (+spec)
features/savant-trader/utils/gallery-cards.util.ts  (aggregation, ordering, preview builders — pure, unit-testable)
features/savant-trader/utils/gallery-staging.util.ts (quantity-based ticket builder variant)
```

Route: develop at `dev/gallery` first (parallel to `dev/screenshot`); the canonical `AppRoutes.GALLERY = 'trading/gallery'` lands as the final task (route promotion — the route is just a string over the same component). Lazy `loadComponent`, `authGuard`. Run dashboard gains "View Signal Gallery" button (RouterLink) at promotion. Note: a `dev/` URL does not sandbox order flow — submissions from `dev/gallery` are real.

## 6. Reuse inventory

- `buildSignalOrderTickets` (facade util) — template for the quantity-based variant; keep dedup + `signalContext`/`decisionId` provenance identical.
- `OrderTicketComponent` — hosted unchanged in a MatDialog wrapper (input: ticket).
- `FlexChartComponent` + `chart-indicators` utils + `IndicatorSeriesStore` — daily-only chart cell reusing `DEFAULT_CHART_INDICATORS`/intervals extras incl. signal dots.
- `SignalFilterPillsComponent`, `RhSelectMenuComponent`, `RunMetricsStripComponent` — header.
- `position-sizing.util` (`computeUnits`, `stopPriceFromPercent`, `DEFAULT_STOP_PERCENT`), `paper-ticket.util`, `broker-order.util` — preview + status derivation.
- `SymbolListStore.toggleMonitor`, `OccurrenceDecisionStore` reject path, `OrderTicketStore` full API.

## 7. Key decisions (from grilling)

- **FE only** — no BE/SHARED area.
- **Facade + UI store seam** — no new domain stores; durable state stays in existing stores.
- **Stage-on-open (ticket only); decisions on submit; removeTicket on cancel.** Accept = order placed.
- **Whole-share only** — `quantity`-based tickets; no `dollarAmount`/fractional path offered.
- **Eager data, deferred render** — `@defer (on viewport; prefetch on idle)`; documented render-all fallback.
- **Multi-select** — reject + watch bulk actions; per-card ticket button unchanged.
- **Watch = Monitor**; reject/watch/ordered cards sink, failed sink with error styling.
- **Card-type-agnostic shell** (grid/selection/sink); signal card is the only card type this Thread (ADR-009).

## 8. Edge cases

- No completed run / run in progress → "no signals" empty state; actions disabled.
- Symbol fires D+W signals both directions → two cards (symbol+buy, symbol+sell); same side → one card.
- Symbol already in Monitor → watch is a no-op (idempotent toggle handled: check membership first).
- Symbol already has a staged ticket for this run → opening ticket reopens the existing staged ticket rather than staging a duplicate.
- Rejected symbols stay out for the viewed run only; next run's signals produce fresh cards.
- Limit order resting for days → card shows resting state in place; fill+stop handled by future positions Thread.
- Chart data fetch failure per card → card shows chart error placeholder; other cards unaffected.
- Selection + filter change → selection prunes cards no longer visible.

## 9. Risks

- **Syncfusion instance cost** — 40+ chart mounts; mitigated by defer-on-viewport + compact height; render-all is the fallback if defer janks.
- **`OrderTicketComponent` dialog width** — built for a right panel; dialog sizing/styling may need a wrapper layout pass.
- **`buildSignalOrderTickets` divergence** — quantity-based variant must stay provenance-identical; extract shared builder rather than fork logic.
- **Indicator-series call burst** — N symbols × callable on idle; cache is shared, but first-load burst should be bounded (prefetch on idle, not all-at-once).

## 10. Phases (preview for task split)

- **Phase 1 — Shell + data:** route, page, facade/UI store, signal aggregation, grid, filters/sorts, empty states.
- **Phase 1b — Grouped layout (#783, added post-#754):** signal-review-style expando groups, full-width; groupBy selector = interval | side | list; expanded panel body is the card grid; expandedGroups state + collapse-all in GalleryUiStore.
- **Phase 2 — Card + chart:** gallery card, chart cell (@defer), occurrence chips, ordering/sink model (sunk becomes a bottom group / sunk-within-group).
- **Phase 3 — Actions:** reject, watch (Monitor), multi-select + bulk bar.
- **Phase 4 — Order flow:** quantity-based staging builder, ticket dialog, submit/cancel sequencing, preview popup, status styling, run-dashboard button.
