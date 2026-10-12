**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Extend Gallery UI to Portfolio Page  
**Thread Slug:** portfolio-gallery-view  
**Issue:** #947  
**Thread Parent:** #926  
**Topic Parent:** #219  
**Domain:** PORTFOLIO  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

## Overview

FE-only test plan for `portfolio-v2`. Same shape as the signal gallery's: heavy coverage on the pure mapping/grouping/filter utilities, store-level specs for the facade composition, shallow component specs for DOM wiring. jest 30 + `jest-preset-angular`; `signalStore` specs drive state directly (no zone/fakeAsync tricks beyond the repo's established patterns — async flushes use `await new Promise(r => setTimeout(r, 0))`, never under fake timers).

## Test seams

| Seam | What's faked | What's real |
|---|---|---|
| `position-cards.util.ts` | nothing — pure | the whole join/group/filter/sort surface |
| Facade | `PortfolioDashboardStore`, `SymbolListStore`, `GalleryCardChartStore`, `PositionAttributionService`, `AllocationBucketService` (stub providers or `signalStore` test patching) | facade computeds + methods |
| `position-card` component | inputs | rendered meta/badge/buttons |
| `position-card-chart` | `GalleryCardChartStore` + `IndicatorSeriesStore` + mount queue (mirror the gallery-card-chart spec's approach — verify its mocking pattern and reuse it) | interval/override/seq wiring |
| Dialogs | `MatDialog.open` spy returning `afterClosed` observables | payload shape asserted against the v1 dialogs' data contract |
| Route | `TestBed` route config | lazy import resolves, guard applies |

## Unit — `position-cards.util.ts`

`buildPositionCards`:

- Joins position + quote + orders + entryDate + profile + attribution + protection into one card per live position.
- Missing quote → `marketPrice`, `dayChange`, `dayChangePct`, `marketValue`, P&L fields `null` (card still builds).
- Missing profile → `companyName`, `sector`, `industry`, `capTier`, `marketCap` `null` (card still builds).
- Missing attribution → `bucketName: null`.
- `side` derives from quantity sign (long positive, short negative).
- `dayChange`/`dayChangePct` compute from `lastTradePrice` vs `previousClose`; `previousClose: null` → both `null`.
- `daysHeld` = elapsed days (floored 24h periods) from entryDate to now; null when no entry date resolves.
- `protected`/`stopPrice`/`stopDistancePct` populate from the protecting live order; a sell stop on a shorted symbol is NOT protection (long-only predicate — short-position protection is future work).
- Options/option-positions never enter the card set (the input is `equityPositionsWithPnL` — a spec asserting the facade passes the equity slice only, plus a fixture-level guard that an option-shaped record can't produce a card).

`filterPositionCards`:

- `side: 'long' | 'short' | 'all'` filters on the derived side.
- `listFilter` mirrors the signal gallery's semantics — `ALL` passes everything; a named list passes only cards whose symbol is in that list; exclusive-list keys behave the same (the shared `shouldShowInListFilter` predicate is the spec source — if duplicated locally, its specs come too).

`groupPositionCards`:

- `BUCKET` groups by `bucketName`, unattributed positions into `(Unassigned)`.
- `SECTOR`/`INDUSTRY`/`CAP_TIER` group by profile field, missing profiles into `(Unknown)`.
- Group ordering and within-group ordering match the flat sort (marketCap desc, nulls last, symbol asc).
- `NONE`/flat returns one ungrouped ordered list.

`sortFlat`: marketCap desc — **company market cap, not position market value** (spec asserts a small position in a mega-cap sorts above a large position in a small-cap). Null marketCap sorts last; equal caps sort by symbol.

`classifyCardOrders`: protective stop orders land in `stopOrders`; limit/market/other resting orders land in `otherOrders`; the classification agrees with `isStopLossProtecting` on the same fixture (the badge and popup can never diverge — this is the spec that pins it). For long positions this also agrees with `computeProtectedSymbols`; shorts diverge by design — the card says UNPROTECTED (correct: a sell stop can't protect a short) while the v1 table's `stopLossProtectedSymbols` still counts non-zero quantity (known divergence, flagged for the v1 stop work).

## Store — `PortfolioGalleryUiStore`

- Defaults: `chartTimeframe` per the global default constant, `side: 'all'`, `listFilter: ALL`, `groupDimension: NONE`, empty `expandedGroups`.
- `setChartTimeframe` bumps `chartTimeframeSeq` (the resync tick per-card overrides watch).
- Per-card override survives until the seq tick — asserted at the chart component level.
- `resetForPage()` restores defaults.

## Store — `PortfolioGalleryFacade`

- `agenticAccounts` filters `accounts` on `agenticAllowed`; cards derive from the selected agentic account's data only.
- Zero agentic accounts → the "no agentic account" state, not an empty grid.
- `cards` composes the facade's inputs end-to-end (position+PnL in → PositionCard out).
- `flatCards`/`groups`/`unprotectedCount`/`summary` computeds track the UI-store facets.
- `refresh()` delegates to the dashboard store's refresh for the selected account.
- `onEnter` resets UI state and kicks `loadProfiles()` + dashboard refresh + daily-bar prefetch per symbol.
- Loading/error/partial-error surface from the underlying `Loadable` slices (one failure degrades, doesn't blank the page).
- **Live/paper isolation**: the facade reads only `PortfolioDashboardStore` equity slices — a spec fixture containing paper-position-shaped data in the same account asserts it produces no card (the paper pipeline lives in a different store entirely; this spec pins the boundary so a future refactor can't merge them).

## Component — `position-card`

- Renders the full meta set for a populated card; renders `—` for null fields without crashing.
- `PROTECTED @ price (pct)` vs `UNPROTECTED` badge; shorts always read UNPROTECTED (no sell-side protection).
- Stop action label resolves `Add Stop`/`Update Stop` from card state.
- `Add` and `Detail` buttons present and `disabled` with the tooltip.
- `Orders` button renders the live-order count; hover/focus opens the popup listing `STOP` vs `LIMIT`/`other` rows; popup is read-only (no buttons inside).
- `Close`/`Stop` click → `MatDialog.open` called with the v1 dialogs' exact `{ position, currentPrice, accountNumber }`-shaped data.
- Dialog `afterClosed` → facade `refresh()`.

## Component — `position-card-chart`

- Mounts through the mount queue, not directly (queue is the seam the spec asserts).
- `@defer (on viewport)` — the chart doesn't fetch until visible (mirror the gallery spec's approach for asserting defer behavior).
- Per-card D/W toggle switches interval and fetches the other timeframe's bars lazily.
- Global `chartTimeframeSeq` bump resets every card to the global timeframe (copy the gallery spec's seq-driven resync test, driving a real `PortfolioGalleryUiStore`).
- No signal-dot / signal-marker rendering path exists (assert the chart receives no signal input — negative test that pins the entity boundary).
- Chart-load failure renders the per-card error + retry (existing gallery behavior, same assertion shape).

## Component — page / header / group

- Route `portfolio-v2` lazy-loads the page behind the same auth guard as `portfolio`.
- Header renders the summary strip (total value, day P&L, cash, buying power, unprotected count), Refresh, Chart D/W pill, Side pills, List dropdown, Group dropdown (Bucket first), Expand-all — and **no** signal-timeframe pill.
- Group dropdown ordering: Allocation Bucket → Sector → Industry → Cap Tier → None.
- Expando panels open/close and persist in `expandedGroups`; Expand-all toggles all.
- States: loading skeleton, load-error + retry, no-agentic-account, zero-positions, filtered-empty (distinct copy), quote-missing card.
- Position removal: a position that vanishes from the store on refresh produces no card and no error (the no-triage invariant).

## Regression — the shared machinery

- `GalleryCardChartStore`, `IndicatorSeriesStore`, `GalleryChartMountQueueService`, `SymbolListStore`, `PortfolioDashboardStore` are consumed unmodified — **no changes means no new specs on them**; the existing suite must stay green.
- The signal gallery page (`dev/gallery`) is untouched — its existing specs staying green is the regression check; add nothing gallery-side.
- `ClosePositionDialogComponent`/`StopLossDialogComponent` unchanged — their existing specs stay green.

## Edge cases to pin

- Card for a position with zero live orders → `UNPROTECTED`, empty Orders popup ("No open orders").
- Symbol with no profile → card renders, groups to `(Unknown)`, sorts last in flat mode.
- Symbol in no symbol list → `listFilter` named-list selections filter it out; `ALL` keeps it.
- Attribution exists but the bucket doc is gone → `bucketName: null` (don't render a dangling id).
- Quote's `previousClose` null → day-change fields `—`.
- Short position → side chip `SHORT`, P&L/stop-distance signs correct.
- Multiple live orders on one symbol including both a stop and a limit → popup shows both, classified.
- `daysHeld` across month boundaries (Feb 28 → Mar 1) — pure function, no timezone surprises.

## Existing coverage leveraged

- `portfolio-dashboard.store.spec.ts` / `.selectors.spec.ts` — the store's computeds (positions+PnL, protected symbols, open orders, summary, entry dates) are already covered; the facade tests assert composition, not re-verification.
- `gallery-card-chart` / gallery component specs — the position-card-chart spec clones their mocking approach.
- `portfolio-dashboard.spec-fixtures.ts` — reuse the account/position/quote/order fixture factories.
