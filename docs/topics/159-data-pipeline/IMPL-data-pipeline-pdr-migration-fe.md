**Topic:** Refactor data pipeline to PDR-driven triggers, consolidate local bar store writers, and migrate charts to local reads  
**Issue:** #161  
**Topic Parent:** #159  
**Domain:** DATA-PIPELINE  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-08-23  
**Last Updated:** 2026-08-23  

---

# Implementation Plan: FE — Chart Migration to Local Bar Store

## Overview

Migrate the option chart (`options-contract-viewer.store.ts`) and spread chart (`spread-viewer.store.ts`) to read underlying bars from the local `symbol-data` Firestore collection instead of calling `getPairDailyBars` → `callPartnerTimeSeries` → SA.

## Components

### 1. Bar-read service (`src/app/core/services/local-bar-read.service.ts`)

New lightweight service for reading D/W/M bars from `symbol-data/{SYMBOL}` directly via Firestore client SDK. Follows the existing pattern in `rel-str-db-v2.service.ts` — `collection()`, `query()`, `getDocs()` with Angular zone wrapper.

**Methods:**
- `getDailyBars$(symbol: string, year: number): Observable<OhlcBar[]>` — reads `symbol-data/{SYMBOL}/daily/{year}`
- `getWeeklyBars$(symbol: string): Observable<OhlcBar[]>` — reads `symbol-data/{SYMBOL}/weekly/all`
- `getMonthlyBars$(symbol: string): Observable<OhlcBar[]>` — reads `symbol-data/{SYMBOL}/monthly/all`
- `getRecentDailyBars$(symbol: string, days: number): Observable<OhlcBar[]>` — reads current year shard, filters to last N days in memory

### 2. Option chart store update (`src/app/features/options-contract-viewer/options-contract-viewer.store.ts`)

Replace `RsBarsService.getDailyBars$()` call with `LocalBarReadService.getRecentDailyBars$()`. The store currently calls `dataService.fetchChartData$(baseline, symbol, interval)` which delegates to `RsBarsService`. The migration swaps the underlying data source while keeping the same store interface.

### 3. Spread chart store update (`src/app/features/spread-viewer/spread-viewer.store.ts`)

Same pattern — replace `RsBarsService.getDailyBars$()` with `LocalBarReadService.getRecentDailyBars$()`.

### 4. Firestore rules verification

The FE already has authenticated read access to `symbol-data/{symbolId}`, `daily/{year}`, `weekly/{docId}`, `monthly/{docId}` (firestore.rules lines 60-82). No rules changes needed. Verify with a manual read test.

## Phases

### Phase 1: Local bar-read service
- Create `LocalBarReadService` with D/W/M read methods
- Unit test with Firestore emulator

### Phase 2: Option chart migration
- Update `options-contract-viewer.store.ts` to use `LocalBarReadService`
- Verify chart renders correctly with local data
- Verify sub-100ms read time

### Phase 3: Spread chart migration
- Update `spread-viewer.store.ts` to use `LocalBarReadService`
- Verify chart renders correctly with local data
- Verify sub-100ms read time

## Dependencies

- BE Phase 1 must be complete (SDS writing to `symbol-data`) — the charts need data in the local store to read
- `getPairDailyBars` callable is NOT removed — it still serves the heatmap chart, RS chart, and dashboard (Topic #162)
