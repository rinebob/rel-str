**Topic:** Paper Trading Infra  
**Topic Slug:** `paper-trading`  
**Thread:** Signal Selection  
**Thread Slug:** `signal-selection`  
**Issue:** #1642  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** IMPL  
**Status:** Approved  
**Created:** 2026-11-20  
**Last Updated:** 2026-11-20  

# FE IMPL — signal-selection: /signals/symbol-review pane

## Architecture overview

A new page at `/signals/symbol-review`, laid out like `chart-view`:
a left pane over a chart. Differences from chart-view — the left pane
lists **signal occurrences for the active symbol** (not a symbol
viewport), and each row carries a checkbox that is literally ledger
membership:

```text
┌─ SymbolReviewPage (page = coordinator) ────────────────────────────┐
│  header: symbol picker (getSignalReviewQueue rows, new-signal dot) │
│  ┌──────────────────────────┬───────────────────────────────────┐ │
│  │ occurrence list          │  chart-view chart stack           │ │
│  │  [ ] 2026-08-14 TRIDER_L │   + signal markers for the        │ │
│  │  [x] 2026-07-30 TRIDER_L │     symbol's occurrences          │ │
│  │  ── new since last visit ──│                                   │ │
│  │  [ ] 2026-02-11 TRIDER_S │                                   │ │
│  └──────────────────────────┴───────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘

SignalReviewStore (NgRx SignalStore)
  queueRows | activeSymbol | bundle(occurrences, previousOpenedAt)
  | togglePending | rowErrors | queueLoading/bundleLoading | error

check   → generatePaperSignalTrades({items:[signalPickFromReviewOccurrence(occ)]})
          created/deduped → checked + tradeId   |  error → stays unchecked
uncheck → deletePaperTrades({tradeIds:[tradeId]})
          deleted/notFound → unchecked          |  failed → stays checked + reason
```

Every toggle is an independent ledger action — no cursor, no commit,
no batch. Review any region in any order.

## Boundary

- **`src/app/features/savant-trader/pages/symbol-review/`** (new) —
  page + occurrence-list component. Page coordinates the store;
  components are dumb views (feature-state convention).
- **`src/app/features/savant-trader/stores/signal-review.store.ts`**
  (new) — all lifecycle state: queue, bundle, toggles, divider.
- **`src/app/features/savant-trader/services/signal-review.service.ts`**
  (new) — `httpsCallable` wrappers ×4 (queue, bundle, mint, delete).
- **`src/app/core/common/constants.ts`** — `AppRoutes.SYMBOL_REVIEW` +
  `CallableName` ×4.
- **`src/app/core/core-routes.ts`** + **`PAGE_INFO`** + nav menu —
  route + entry point (Signals nav section, beside SIGNAL_REVIEW).
- **Reused unchanged:** `SymbolListStore`-adjacent services where
  already wired, chart-view's chart component + bar-loading path,
  `signal-marker-converters` (occurrence → marker), `SignalPick`
  mapper from SHARED.

## Files

- `src/app/features/savant-trader/pages/symbol-review/symbol-review.component.ts|html|scss|spec.ts` (new)
- `src/app/features/savant-trader/pages/symbol-review/occurrence-list.component.ts|html|scss|spec.ts` (new)
- `src/app/features/savant-trader/stores/signal-review.store.ts` + `.spec.ts` (new)
- `src/app/features/savant-trader/services/signal-review.service.ts` + `.spec.ts` (new)
- `src/app/core/common/constants.ts` (modified — route + CallableName)
- `src/app/core/core-routes.ts` (modified — route entry)
- `PAGE_INFO` map + nav component (modified — title + menu entry)
- `src/app/features/savant-trader/pages/chart-view/` — **read-only reuse**;
  extract a shared bar-load/chart seam only if the two pages can't
  coexist on the same component without changes (prefer reuse as-is)

## Modules

- **`SignalReviewStore`** — `loadQueue()` (picker data),
  `selectSymbol(sym)` → `loadBundle(sym)` (bundle fetch; sets
  `activeSymbol`, `occurrences`, `previousOpenedAt`; stale-response
  guard via a monotonic seq so switching symbols mid-fetch can't
  clobber), `toggle(occ)` → dispatches mint/delete by current `checked`,
  per-row `togglePending`, per-row error capture, `dividerIndex`
  computed (`occurrences` sorted newest-first; first index whose
  `signalBarDate <= previousOpenedAt` — `null` previous → divider at
  top edge, "all new").
- **`SignalReviewService`** — thin `httpsCallable` wrappers returning
  `Observable<…>`: `getSignalReviewQueue$`, `getSignalReviewBundle$`,
  `generatePaperSignalTrades$`, `deletePaperTrades$`. Callable names
  come from `CallableName` — parity with `index.ts` is an AC.
- **`OccurrenceListComponent`** — dumb view: emits `toggle` events,
  renders checkbox (disabled while `togglePending`), date, type,
  direction, `INTERIM`/`CONFIRMED` chip, checked-state styling, the
  divider element at `dividerIndex`, and the per-row error line
  (e.g. the delete callable's `failed` reason for cohort trades).
- **`SymbolReviewComponent`** — page shell: picker bound to queue rows
  (dot = `lastDailySignalDate > lastOpenedAt`), hosts list + chart,
  owns nothing stateful.
- **Chart seam** — chart-view's existing chart component fed with the
  active symbol's bars via its existing load path; occurrences pass
  through `signal-marker-converters` into markers (checked vs
  unchecked distinct styling is polish, not core AC).

## Contracts

SHARED IMPL owns the wire types; this doc owns the FE seam:

- `CallableName.GET_SIGNAL_REVIEW_QUEUE = 'getSignalReviewQueue'`
- `CallableName.GET_SIGNAL_REVIEW_BUNDLE = 'getSignalReviewBundle'`
- `CallableName.GENERATE_PAPER_SIGNAL_TRADES` / `.DELETE_PAPER_TRADES`
  — the existing deploy names, registered once.
- `AppRoutes.SYMBOL_REVIEW = 'signals/symbol-review'`.
- Toggle outcomes per SHARED/BE contracts: mint `error` → row stays
  unchecked; delete `failed` → row stays checked with the returned
  reason; delete `notFound` → unchecked (already gone).

## Decisions

- **Confirmed toggles, not optimistic** — the delete callable can
  *refuse* (accept-flow/cohort trades). Waiting for the response is the
  only honest checkbox; a per-row pending state keeps the UI honest
  about in-flight work.
- **Queue drives the picker, not SymbolListStore** — the queue callable
  already resolves PRIMARY ∪ SECONDARY membership server-side and
  carries the two badge fields; duplicating the union client-side
  would fork the universe definition.
- **Store holds `previousOpenedAt`, not the divider's index math** —
  the divider is a computed; refetches after toggles re-use the same
  stamp (BE stamps once per read), so it can't drift during a session.
- **Toggle refreshes the row only, not the bundle** — the response
  carries the authoritative `tradeId`/`tradeStatus` outcome; refetching
  the whole bundle per checkbox would re-stamp `lastOpenedAt` semantics
  for free but is wasteful and makes the divider depend on refetch
  timing. Row-level patch keeps the session's divider stable.
- **Markers = all occurrences** — the chart shows the full signal log;
  checked styling distinguishes ledger members. No marker filtering —
  the pane exists to see the *unselected* too.
- **Reuse chart-view's stack verbatim where possible** — the page is
  deliberately "chart-view with a different left pane"; new chart
  machinery would be a third chart surface to maintain.

## Sequence / phases

- **Phase 1 — Task: route + shell + picker** — `AppRoutes`, nav,
  `CallableName` entries, service wrappers, store skeleton
  (queue → picker; bundle fetch + stale guard), page shell layout.
- **Phase 2 — Task: occurrence pane + toggles** — list component,
  checkbox wiring through the store, confirmed-toggle semantics,
  divider render, per-row errors.
- **Phase 3 — Task: chart + markers** — chart stack reuse, occurrence
  markers, checked/unchecked marker styling, row↔marker affordance
  (hover/click sync if cheap).

Phases 1–3 are blocked by the BE callables task (live data shape) —
the SHARED contracts task lets FE compile first; BE delivers the
deployed callable before FE tasks leave the unit-test layer.

## Prior art / regression

- `chart-view.component` — the layout + chart + store-wiring template;
  the two-pane shell and bar-load path are copied from proven code.
- `signal-review.component` (`/signals/review`) — the *other* review
  page stays untouched; this page is a sibling, not a change to it.
- `topic-viewer.store` — the fresh precedent for SignalStore seams:
  monotonic-seq stale guard, per-entity pending/error maps.
- `signal-marker-converters.ts` — occurrence→marker conversion already
  exists for the review page's quick charts.

## Verify relay

- `npx jest --coverage=false` — store/service/component specs
- FE `tsc --noEmit`
- `CallableName` ↔ `index.ts` parity (spec asserting literal deploy
  names — the 619 thread's convention)
- UAT: `/signals/symbol-review` end-to-end against deployed callables —
  pick a member symbol, check → trade appears in `/trading/paper`,
  uncheck → gone, divider correct on reopen.

## Risks / open seams

- **Large logs** — a symbol with years of daily occurrences renders
  hundreds of rows; virtual-scroll the list if it lags (not built in
  v1 — measure first).
- **Chart bar coverage vs log depth** — occurrences older than the
  cached bar range just don't plot markers; the list still shows them.
- **Delete refusals** — cohort trades join as checked but refuse
  uncheck; the row error is the designed surface, but the pane should
  also make refusal *legible* (tooltip/help note) so it doesn't read
  as a bug.
- **Stale queue** — memberships change via other pages; the queue
  refetches on page load only (documented; pull-refresh on demand).
