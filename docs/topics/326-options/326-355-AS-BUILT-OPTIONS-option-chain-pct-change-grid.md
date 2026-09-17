**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Option chain percent change grid  
**Thread Slug:** initial-impl  
**Issue:** #355  
**Thread Parent:** #327  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** As-Built  
**Status:** Complete  
**Created:** 2026-09-16  
**Last Updated:** 2026-09-16  

# As-Built: Option Chain Percent Change Grid

## Overview

This Topic delivered an in-app tool that fetches historical option-chain snapshots for a symbol, matches contracts across a start date and one or more target dates, and computes percentage price changes from the start snapshot to each target snapshot. Results are displayed as a heatmap grid per target date, with expiration as columns and strike as rows.

## What Was Built

### Shared Contracts (#343)

- Added `HistoricalOptionsChainSnapshot` and `HistoricalOptionsChainContract` types to `shared/options-contract-contracts.ts`
- Added `GET_HISTORICAL_OPTIONS_CHAIN` to the `CallableName` enum
- Promoted existing historical options types from `shared/options-common.ts`

### Backend Callable (#344)

- Added `getHistoricalOptionsChain` Firebase callable function in `functions/src/options-contract.callables.ts`
- Thin pass-through to the Alpha Vantage historical options proxy
- Request shape: `{ symbol, date }`
- Returns a `HistoricalOptionsChainSnapshot` with an array of `HistoricalOptionsChainContract` entries

### Frontend Utilities (#345)

- Added `computePctChange()` pure function in `pct-change.utils.ts`
  - Matches contracts by `contractID` across start and target snapshots
  - Resolves option prices via `mark` → bid/ask midpoint → `last` fallback
  - Normalizes option type values (`call`/`put`/`c`/`p` → canonical)
  - Computes ATM strike from actual start underlying price (not delta inference)
  - Returns `PctChangeGrid` with strikes, expirations, cells, p5/p95 percentiles
  - Includes `startUnderlyingPrice`, `targetUnderlyingPrice`, `atmStrike`, `durationDays`
- Added `pctChangeToColor()` in `color-mapping.utils.ts`
  - Directional scale: white at zero, green for positive, red for negative
  - No red-green mixing for one-sided ranges
  - Intensity increases with magnitude
- 36 unit tests across both spec files

### Frontend Service + Store (#346)

- Added `getHistoricalOptionsChain$` method to `OptionsContractService`
- Added `OptionChainPctChangeStore` (NgRx SignalStore)
  - State: symbol, startDate, targetDates, optionType, duration filters, strike filters, delta filters, grids, loading, error
  - `runAnalysis` effect: fetches start snapshot, target snapshots, and underlying daily bars in parallel
  - Passes actual start/target underlying prices to `computePctChange`
  - Default symbol: QQQ, default start date: 2025-04-07

### Frontend Grid Component + Page (#347)

- Added `PctChangeGridComponent` — renders a single heatmap grid
  - CSS Grid with expiration columns and strike rows
  - Each cell: percentage change, start price → target price, delta (Δ)
  - Row headers: strike + ATM diff (amount and pct from actual start underlying price)
  - Column headers: expiration date + days from start
  - Sticky headers
  - Compact cells (1px 3px padding, 14px min-height, 50px min column width)
  - Directional heatmap colors
- Added `OptionChainPctChangeComponent` — page shell
  - Fullscreen by default (via `UiStateService.setFullscreen`)
  - Left input panel with symbol, dates, filters (scrollable)
  - Right grid panel rendering one grid per target date
  - Underlying price summary (start → target with pct change)
- Added route and navigation entry
- External HTML and SCSS files per coding guidelines

## Architecture Decisions

1. **ATM from actual underlying price**: ATM strike is determined from the start-date underlying price fetched via `LocalBarReadService`, not inferred from option delta. This is more accurate and decouples ATM from delta data availability.

2. **Price resolution fallback**: `mark` → bid/ask midpoint → `last`. Matches the backend `av-eod-option-quote-provider` pattern. Handles AV historical data where `mark` is often missing.

3. **Directional color mapping**: White at zero, green-only for positive, red-only for negative. Avoids the diverging scale problem where one-sided ranges interpolate through the opposite color.

4. **Underlying price fetch**: Daily bars are fetched from Firestore (local bar store) for both start and target dates. Closest prior bar is used for non-trading dates.

5. **External templates/styles**: All HTML and SCSS in separate files per repo coding guidelines.

## Deviations from Original Design

- The original PRD mentioned delta-based ATM inference; this was changed to actual-price-based ATM per user request.
- The original color mapper used a diverging red-neutral-green scale; this was rewritten to directional (white-green / white-red) per user request.
- Result caching by parameter hash was deferred to a future Thread (post ZigZag integration).

## Future Work

- **ZigZag integration** (Topic #261): Automatically derive start/target dates from detected swing lows and swing highs.
- **Result caching**: ST-side caching of computed grids by parameter hash for idempotent, instant re-analysis.
- **Backend auth/CORS**: Historical CORS/auth issues with the callable endpoint were not fully resolved in backend code; frontend fixes made the page functional.
