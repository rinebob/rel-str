**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Extend Gallery UI to Portfolio Page  
**Thread Slug:** portfolio-gallery-view  
**Issue:** #947  
**Thread Parent:** #926  
**Topic Parent:** #219  
**Domain:** PORTFOLIO  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

## Overview

FE-only blueprint for `portfolio-v2` — a routed page that renders live equity positions as gallery-style cards. Reuse strategy per the approved grill: **fork the presentational shell, share the stores.** The expensive machinery (`PortfolioDashboardStore`, `GalleryCardChartStore`, `GalleryChartMountQueueService`, `IndicatorSeriesStore`, `SymbolListStore`, allocation attribution services) is consumed as-is; the card/group/header components are new `position-*` components under the portfolio feature, cloned-and-adapted from their `gallery-*` counterparts. Nothing under `savant-trader/` is modified; the `GalleryCard` model is never adapted for positions.

**Data flows (all existing):**

- Positions, quotes, P&L, orders, entry dates, account summary → `PortfolioDashboardStore` (root store, `selectedAccountIndex` keyed).
- Agentic gate → `Account.agenticAllowed` on the same store's `accounts`.
- Sector / industry / capTier / company marketCap / company name / list membership → `SymbolListStore.profilesBySymbol` (already loads via `signalService.getAllSymbols()`).
- Allocation bucket label → `PositionAttributionService.watchAttributions$(accountNumber)` joined to `AllocationBucketService` bucket names — the facade subscribes these two services directly rather than driving the whole `AllocationStore` (which is page-scoped state for the Allocation Manager).
- Daily/weekly bars + ST indicators → `GalleryCardChartStore` + `IndicatorSeriesStore` + mount queue (all symbol/interval keyed, no signal coupling).

## Architecture

### 1. Route, page component, UI store

- `AppRoutes` (`src/app/core/common/interfaces.ts`) gains `PORTFOLIO_GALLERY_V2 = 'portfolio-v2'`; `core-routes.ts` registers a lazy standalone route with the same auth guard + `PAGE_INFO` pattern as `DEV_GALLERY`. No nav-menu entry in v1 — the page is reachable by URL; promotion to the menu is a separate decision (same pattern as the signal gallery's #762).
- `features/portfolio-dashboard/pages/portfolio-gallery/` holds:
  - `portfolio-gallery-view.component.{ts,html,scss}` — page shell: header, flat grid or grouped expandos, loading/error/empty states.
  - `portfolio-gallery-ui.store.ts` — page-scoped `signalStore` mirroring `GalleryUiStore`'s chart/facet shape minus the signal-only facets:
    - `chartTimeframe: 'D' | 'W'` + `chartTimeframeSeq: number` — global pill sets the timeframe and bumps the seq so every card resyncs (the #838 semantics); per-card overrides survive until the next seq tick.
    - `side: 'all' | 'long' | 'short'` — defaults `'all'`.
    - `listFilter: SymbolListFilter` — defaults `ALL` (the signal gallery's `PRIMARY` default is a signal-workflow choice; positions default to showing everything).
    - `groupDimension: PositionGroupDimension` — new local enum `{ BUCKET, SECTOR, INDUSTRY, CAP_TIER, NONE }`, default `NONE` (flat); BUCKET is listed first in the dropdown.
    - `expandedGroups: Record<string, boolean>`.
  - `portfolio-gallery.facade.ts` — the composition seam (see §3).
- `SymbolListFilter` and `SymbolList` are imported from `savant-trader/common/savant-trader.constants` — importing constants/pure types across features is acceptable; the coupling boundary the PRD protects is the `GalleryCard` *entity* model, not shared vocabulary.

### 2. `PositionCard` model + card-building utilities

New file `pages/portfolio-gallery/utils/position-cards.util.ts` — pure functions, the file's tests carry most of the mapping coverage.

```ts
export interface PositionCard {
  key: string;                    // `${accountNumber}:${symbol}`
  accountNumber: string;
  symbol: string;
  side: 'long' | 'short';         // sign of quantity
  quantity: number;
  averageCost: number;
  marketPrice: number | null;     // quote lastTradePrice; null when quote absent
  dayChange: number | null;       // marketPrice - quote.previousClose; null without a quote
  dayChangePct: number | null;
  unrealizedPnl: number | null;   // from equityPositionsWithPnL
  unrealizedPnlPct: number | null;
  marketValue: number | null;     // quantity * marketPrice
  daysHeld: number | null;        // today - entryDate (computeEntryDates)
  bucketName: string | null;      // attribution → bucket name; null = unassigned
  protected: boolean;             // symbol ∈ stopLossProtectedSymbols
  stopPrice: number | null;       // from the protecting live order, when identifiable
  stopDistancePct: number | null; // (marketPrice - stopPrice) / marketPrice, signed for shorts
  openOrders: BrokerOrder[];      // live orders on the symbol, classified in the card view-model
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  capTier: string | null;
  marketCap: number | null;       // company market cap — the flat sort key
}
```

- `buildPositionCards(positionWithPnl[], quotes, orders, entryDates, profiles, bucketBySymbol, protectedSymbols)` — the join. Every field tolerates a missing source (quote absent → price/P&L fields null; profile absent → meta fields null; attribution absent → `bucketName: null`).
- `filterPositionCards(cards, side, listFilter, lists, exclusiveListKeys)` — reuses the `shouldShowInListFilter` predicate signature (`savant-trader/utils/utils.ts`) by importing it; if that import is judged too deep a reach into the feature the predicate is duplicated locally — decide at task time, prefer import.
- `groupPositionCards(cards, dimension)` — BUCKET groups by `bucketName ?? '(Unassigned)'`; SECTOR/INDUSTRY/CAP_TIER group by profile field with an `(Unknown)` sink, same as the gallery's convention.
- `sortFlat(cards)` — marketCap desc, `null` marketCap last, symbol asc tiebreak. Grouped mode sorts cards within each group the same way.
- `classifyCardOrders(orders, position)` → `{ stopOrders: BrokerOrder[]; otherOrders: BrokerOrder[] }` using the same protective-stop classifier the store uses (`computeProtectedSymbols` internals — expose/reuse the per-order predicate so the popup's "STOP" badge and the protection badge can never disagree).

### 3. Facade — `PortfolioGalleryFacade`

`signalStore` provided at the page level (the pattern used by `PortfolioAllocationStore` for the allocation page). Composes — does not duplicate — the root stores:

```ts
withState(() => ({
  accounts:        inject(PortfolioDashboardStore).accounts,
  agenticAccounts: computed(() => accounts().filter(a => a.agenticAllowed)),
  accountIndex:    // selectedAccountIndex resolved against agenticAccounts; v1 assumes index 0 of the filtered set
  positions:       // acct.equityPositionsWithPnL (withPnl computed already exists)
  quotes:          // acct.equityQuotes
  liveOrders:      // acct.equityOrders filtered by LIVE_ORDER_STATES (portfolio-dashboard/utils/order-states.util.ts — same feature, no cross-import)
  profiles:        inject(SymbolListStore).profilesBySymbol,
  attribution:     // toSignal(PositionAttributionService.watchAttributions$(acct.accountNumber))
  buckets:         // toSignal(AllocationBucketService bucket list for the account)
  cards:           computed(() => buildPositionCards(...)),
  flatCards:       computed(() => sortFlat(filterPositionCards(cards(), side(), listFilter(), ...))),
  groups:          computed(() => groupPositionCards(flatCards(), groupDimension())),
  unprotectedCount:computed(() => cards().filter(c => !c.protected).length),
  summary:         // acct.aggregateSummary → { totalValue, totalDayPnl, cash, buyingPower, unprotectedCount }
  loading / error / partialError — surfaced from the store's per-slice Loadable state
}))
```

- **On `reset()`** (`resetForPage()` — called from the page's `onEnter`): `SymbolListStore.loadProfiles()` (idempotent — already loaded is a no-op or cheap refresh, matching the signal gallery's preload), dashboard `refresh()` for the selected agentic account, and `GalleryCardChartStore` prefetch of recent daily bars for every position symbol (same eager-prefetch the gallery does so card charts don't pop in).
- **Agentic gating**: the facade derives `agenticAccounts`; the page renders for the first agentic account. If the store's `selectedAccountIndex` doesn't point at an agentic account, the facade selects the first agentic one rather than requiring the user to visit v1 first. Zero accounts or `agenticAllowed` false on all → the "no agentic account" error state, not an empty grid.
- **Days held**: `computeEntryDates` already runs inside the dashboard store — the facade reads the resulting entry dates (or recomputes via the same util against `equityOrders` if the store doesn't expose the map — verify at implementation; prefer reuse).

### 4. `position-card` component (new)

`pages/portfolio-gallery/components/position-card.component.{ts,html,scss}` — cloned-and-adapted from `gallery-card.component`. Layout mirrors the signal card: **meta top block → chart → action row.** No status lane, no triage buttons, no sunk/rejected styling — a position card has no decision state.

- Meta rows: symbol + company name, side chip, qty @ avgCost, mark + day chg ($ + %), unrealized P&L ($ + %), market value, days held, bucket name.
- Protection badge: `PROTECTED @ {stopPrice} ({distancePct}%)` or `UNPROTECTED` — the morning-scan headline per the PRD.
- Per-card D/W toggle on the chart.
- Action row (all present in v1): **Close** · **Stop** (label resolves Add vs Update) · **Add** (disabled stub) · **Detail** (disabled stub) · **Orders** (small icon-button; hover popup).
- SCSS cloned from the gallery card then stripped of triage/status styles; class names renamed `position-*` so the two surfaces can diverge.

### 5. `position-card-chart` component (new)

`pages/portfolio-gallery/components/position-card-chart.component.ts` — cloned-and-adapted from `gallery-card-chart.component`:

- Same bar fetch via `GalleryCardChartStore` (`ensureDaily`/`ensureWeekly` — verify exact method names at implementation), same `IndicatorSeriesStore` indicator computation, same `GalleryChartMountQueueService` deferred-mount, same `@defer (on viewport)` block.
- Same default ST indicator set as the gallery chart.
- **No signal dots, no signal markers** — the chart draws price + indicators only. This is the concrete place the "same chart, different entity" boundary lives: the chart component takes `symbol` + `interval` + `override` inputs, never a `GalleryCard`.
- Per-card D/W override + global `chartTimeframeSeq` resync — copy the gallery's lane computed/effect verbatim (it has no signal coupling).
- `'Position Chart'` is registered in the chart-config vocabulary as a reserved name mapping to this same chart in v1 (a `PositionChartConfig` placeholder/enum entry + comment; overlays — entry/stop levels — land in a later thread).

### 6. `position-gallery-group` + header (new)

- `position-gallery-group.component` — cloned from `gallery-group.component`: expando panel, group label, card count, counts derived from the filtered card set. Group dropdown order: **Allocation Bucket → Sector → Industry → Cap Tier → None**.
- `position-gallery-header.component` — cloned from `gallery-header.component`:
  - **Summary strip** (top, replaces the run-banner): total value, day P&L, cash, buying power, `N unprotected` — all from `aggregateSummary` + facade count.
  - **Chart D/W pill**, **Side pills** (All/Long/Short), **List dropdown**, **Group dropdown**, **Expand-all**, **Refresh**.
  - No signal-timeframe pill, no run-date context.
- Grid/expando SCSS in the page component clones the gallery's responsive card grid.

### 7. Actions and popups

- **Close** — `MatDialog.open(ClosePositionDialogComponent, { data: { position, currentPrice, accountNumber } })` — same data contract the v1 table uses; on close → `refresh()`.
- **Stop** — resolves mode from card state: `protected → 'update'` pre-selecting the protecting order where the dashboard's update-mode candidate logic identifies one; otherwise `'add'`. `MatDialog.open(StopLossDialogComponent, …)` — same data contract; on close → `refresh()`. **Verify at implementation:** the update-mode candidate selection on v1 keys off account-level order lists (`updateAllStops`/`updatableStopsBySymbol` selectors or the dialog's internal candidate logic) — the card must reuse the same path, not re-derive it.
- **Add / Detail** — rendered buttons, `disabled`, tooltip "Coming soon." No dead emitters.
- **Orders popup** — hover/focus opens a small non-modal overlay (Angular CDK overlay or `matTooltip`-style panel — pick the lightest pattern already in the codebase) listing the symbol's live orders: each row `STOP @ price · qty` or `LIMIT SELL qty @ price` (stop classification via the same predicate as §2 so badge and popup agree). Read-only; no cancel/update affordances in v1.
- All actions are no-ops when `position == null` and respect the dashboard store's `loading` state (buttons disabled during refresh, matching v1's affordance).

### 8. States

- Loading → skeleton/spinner block.
- Load error → error panel + Retry (retries the dashboard refresh).
- No agentic account → distinct error state.
- Zero positions → "No live positions" empty state.
- Filters exclude everything → "No positions match the current filters" (distinct copy from zero-positions).
- Quote missing for a symbol → card renders with `—` for price/P&L fields, still actionable.
- Chart load failure → per-card chart error block with retry (existing gallery behavior — reuse).
- Position disappears after a refresh → card simply vanishes (no sunk state; the grid re-derives from the store).

### 9. Out of scope (explicit)

Options positions, paper positions, multi-account UI, order cancel/update actions in the Orders popup, `Add`/`Detail` destinations, position-specific chart overlays (`'Position Chart'` v1 = the existing chart), nav-menu promotion, any change to the v1 portfolio page, any change under `savant-trader/`.

## Task decomposition

Sequential; each task blocks the next. All under the FE Blueprint issue.

1. **Page shell + facade + UI store** — route, page component, `PortfolioGalleryUiStore`, `PortfolioGalleryFacade` (store composition, card building wired through `buildPositionCards`, summary/loading/error states), header skeleton with summary strip + refresh. Grid renders placeholder card count first (real cards land in task 2 — the task's done-state is the shell live with data flowing through the facade, verified by a "cards.length" render + unit tests).
2. **PositionCard model + card + grid/grouping** — `position-cards.util.ts` full join + group/filter/sort, `position-card` component (meta + badges + action row skeleton), `position-gallery-group`, group dropdown + flat mode + market-cap sort end-to-end.
3. **Card chart** — `position-card-chart` with shared chart stores + mount queue + per-card/global D/W + defer-on-viewport; `'Position Chart'` reserved-name registration.
4. **Actions + orders popup** — Close and Stop dialog wiring, Add/Detail stubs, Orders hover popup with stop/limit classification, dialog-close → refresh contract.
