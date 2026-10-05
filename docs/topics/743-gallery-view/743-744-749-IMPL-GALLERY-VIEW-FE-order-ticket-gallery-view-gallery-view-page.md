**Topic:** Gallery Order Ticket View  
**Topic Slug:** order-ticket-gallery-view  
**Thread:** Gallery View Page  
**Thread Slug:** gallery-view-page  
**Issue:** #749  
**Thread Parent:** #744  
**Topic Parent:** #743  
**Domain:** GALLERY-VIEW  
**Type:** IMPL  
**Status:** Approved  
**Created:** 2026-10-03  
**Last Updated:** 2026-10-04  

# Implementation Plan — FE: Gallery View Page

## 1. Overview

Build the Order Ticket Gallery at `trading/gallery`: a responsive 3–4 column grid of cards, one card per symbol+side aggregating the latest completed run's signal occurrences. Each card shows minimal signal details, a compact daily chart (quick-charts daily config), and a ticket button with a hover order preview. Actions: act (OrderTicket modal), reject (durable REJECTs), watch (symbol → Monitor). Multi-select supports bulk reject + watch. Settled/watched cards sink to the end. Entry via "View Signal Gallery" on the run dashboard; `signals/review` and `trading/live` stay live.

Platform direction per ADR-009: the shell (grid, sort/filter rail, selection model, sunk section) is card-type-agnostic; the signal card is the first card type. Card-type abstraction is deferred until the positions thread adds a second type.

## 2. Architecture

### Seam model (mirrors `SignalReviewFacade` + `SignalReviewUiStore`)

- **`GalleryFacade`** (`@Injectable root`) — page-level orchestrator and test seam. Composes the existing domain stores; owns page enter/leave (eager data load), card view-model computeds, and all mutations (reject, watch, stage/submit/cancel sequencing, bulk ops).
- **`GalleryUiStore`** (`signalStore`) — ephemeral UI state: timeframe/direction/list filters, group dimension + expandedGroups (#783), selection set. Nothing durable lives here. (Post-#783 there is no sort key — grouping owns ordering.)
- **Domain stores reused as-is:** `SymbolListStore` (lists, Monitor toggle, activeListFilter, profiles), `OccurrenceDecisionStore` (durable ACCEPT/REJECT reads/writes), `OrderTicketStore` (ticket lookup/status, stageTicket, removeTicket, updateTicket, submitTicket), `StStore`/`SignalService` (latest completed run + its signals), `IndicatorSeriesStore` (chart data cache), `ChartStore` (chart config inputs), `TradingConfigService` (sizing defaults), `SymbolHistoryStore` if needed for occurrence detail.

### Card view-model

Derived computed in the facade: `GalleryCard` — `{ key: symbol+side, symbol, side, profile (name/sector/industry/marketCapTier), occurrences: StSignalItem[], status: 'pending'|'submitting'|'resting'|'settled'|'failed'|'watched', ticket?: OrderTicket, actionedAt, orderPreview: OrderPreview }` (orderPreview lands with #759-#761). 'sunk' is not a status — it's the grouping derived from watched/settled/failed.

Card status derivation (#755, shipped):
- `watched` — symbol ∈ Monitor (wins over ticket state)
- `failed` — ticket FAILED/CANCELLED
- `settled` — ticket FILLED/PAPER (stop-confirmed nuance deferred to the positions Thread)
- `resting` — ticket SUBMITTED/QUEUED/RESTING — stays in place, not sunk
- `submitting` — ticket SUBMITTING; `pending` — no ticket or STAGED
- Ticket↔card match: same symbol+side, signalContext decisionId (canonicalized) prefixed by the viewed runId; latest updatedAt wins
- REJECTed occurrences trim within the card (canonical decision id per occurrence); fully-rejected cards drop

`OrderPreview` — `{ side, quantity (whole shares via computeUnits), orderType, timeInForce, limitPrice?, suggestedStop (stopPriceFromPercent on signal closePrice), estNotional }` — same utils/config as `trading/live`.

## 3. Component tree

```
GalleryViewComponent (page, /trading/gallery)
├── GalleryHeaderComponent
│     ├── filter pills (timeframe, direction) + list selector   ← reuse SignalFilterPillsComponent / RhSelectMenuComponent
│     ├── "Group" selector (sector | industry | market cap) + expand/collapse-all   ← #783 replaces the planned sort selector
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

### Act flow (per card) — revised #755: labeled toolbar replaces ACR row

The card toolbar is **Trade / Reject / Paper** (labeled buttons, plus a
disabled Chart stub until #756). The ACR icon row + list toggles ported
from signal-review were removed during #755 QA — the gallery supersedes
that triage model; "accept" as a decision type is not written from the
gallery at all — the ticket IS the record.

1. **Trade** → `tradeCard` stages a whole-share quantity ticket (sized on
   the signal close, live-quote fallback; `quantity` not `dollarAmount`;
   **no decision writes**) via shared `buildSignalOrderTickets` → page
   opens `GalleryTicketDialogComponent` (MatDialog) hosting the existing
   `OrderTicketComponent` bound to the staged ticket id. An
   already-staged card ticket reopens instead of duplicating.
2. Dialog **submit/paper** → `OrderTicketComponent`'s own submit path
   (`OrderExecutionService` / `paperSignalOrder`) — no gallery-side
   decision writes. Dialog auto-closes when the ticket leaves STAGED.
3. Dialog **cancel/close while still STAGED** → `discardStagedTicket`
   removes the ticket *only if this click created it* — a reopened
   pre-existing ticket survives.
4. **Paper** → `paperCard` stages if needed, then the order queue's
   `paperSignalOrder` path (`paperQuantityFor` sizing, SUBMITTING guard,
   PAPER on success → card settles + sinks; STAGED + error on failure).
5. Card reacts to ticket status via `OrderTicketStore` — resting stays
   in place, filled/paper → settled → sinks, failed → sinks.

### Reject flow

Toggle per card: durable `REJECT` decisions for each contributing
occurrence + staged-ticket removal → card sinks as `rejected`. Clicking
**Restore** on the sunk card resets its decisions → returns to pending in
its dimension group.

### Watch flow

Monitor membership still derives `watched` → sinks — but the card no
longer carries a list-toggle row; toggling Monitor happens on
signal-review / the lists pages. Multi-select + bulk bar (#758) remains
the planned bulk path.

### Ordering

Post-#783 there is no user-facing sort: within-group order is fixed marketCap desc. Sunk cards (watched/settled/failed) leave the dimension groups entirely and collect in a pinned bottom "Sunk" expando ordered by action time desc (`actionedAt` = ticket terminalAt/updatedAt; untimestamped e.g. externally-watched cards go last). Resting stays in place — an in-flight order is still actionable context.

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
- **Stage-on-open (ticket only); no gallery-side decision writes; discard-on-cancel.** Revised during #755 QA — ACCEPT decisions are not written from the gallery at all ("accept isn't a thing anymore" — the staged/submitted ticket is the record); durable REJECT remains the only decision the page writes.
- **Whole-share only** — `quantity`-based tickets; no `dollarAmount`/fractional path offered.
- **Eager data, deferred render** — `@defer (on viewport; prefetch on idle)`; documented render-all fallback.
- **Multi-select** — reject + watch bulk actions; per-card ticket button unchanged.
- **Watch = Monitor**; reject/watch/ordered cards sink, failed sink with error styling.
- **Card-type-agnostic shell** (grid/selection/sink); signal card is the only card type this Thread (ADR-009).
- **Deferred — review/bookmark button repurpose:** the signal-review "review" flag button is slated to be repurposed in a future thread (user note, recorded during #755 QA); the gallery card does not carry it today.

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
- **Phase 1b — Grouped layout (#783, added post-#754):** signal-review-style expando groups, full-width; "Group" selector = sector | industry | market cap (same `GroupDimension` set as signal-review); page-entry defaults Daily + Long + PRIMARY + Sector; group headers show label + "N signals" + D/W + long/short counts; panels default collapsed; expanded panel body is the card grid; expandedGroups state + expand/collapse-all in GalleryUiStore; within-group order = marketCap desc; no sort dropdown.
- **Phase 2 — Card + chart:** gallery card, chart cell (@defer), occurrence chips, ordering/sink model (sunk becomes a bottom group / sunk-within-group).
- **Phase 3 — Actions:** reject, watch (Monitor), multi-select + bulk bar.
- **Phase 4 — Order flow:** quantity-based staging builder, ticket dialog, submit/cancel sequencing, preview popup, status styling, run-dashboard button.
