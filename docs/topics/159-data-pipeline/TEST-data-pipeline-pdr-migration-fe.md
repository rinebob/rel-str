**Topic:** Refactor data pipeline to PDR-driven triggers, consolidate local bar store writers, and migrate charts to local reads  
**Issue:** #161  
**Topic Parent:** #159  
**Domain:** DATA-PIPELINE  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-08-23  
**Last Updated:** 2026-08-23  

---

# Test Plan: FE — Chart Migration to Local Bar Store

## E2E User Journeys

- **Journey 1:** User opens option chart for SPY → chart loads underlying bars from `symbol-data/SPY/daily/2026` → renders in under 100ms
- **Journey 2:** User opens spread chart for AAPL → chart loads underlying bars from `symbol-data/AAPL/daily/2026` → renders in under 100ms
- **Journey 3:** User switches interval (daily/weekly/monthly) on option chart → chart loads from `weekly/all` or `monthly/all` → renders correctly

## Integration Tests

- **LocalBarReadService + Firestore:** verify `getDailyBars$` reads from `symbol-data/{SYMBOL}/daily/{year}` and returns correct bar shape
- **LocalBarReadService + Firestore:** verify `getRecentDailyBars$` filters to last N days correctly
- **Option chart store + LocalBarReadService:** verify store receives bars and transforms them for the chart component
- **Spread chart store + LocalBarReadService:** verify store receives bars and transforms them for the chart component

## Unit Tests

- **Pure functions:**
  - `getRecentDailyBars$` filtering logic (filter to last N days from year shard)
  - Year boundary handling (Dec 2026 + Jan 2027 in a 30-day window)

- **Services:**
  - `LocalBarReadService.getDailyBars$` — mock Firestore, verify collection path and query
  - `LocalBarReadService.getWeeklyBars$` — mock Firestore, verify doc path
  - `LocalBarReadService.getMonthlyBars$` — mock Firestore, verify doc path

## Test Seams

- **Highest seam:** chart store with mocked `LocalBarReadService` — verify store behavior with controlled bar data
- **Medium seam:** `LocalBarReadService` with Firestore emulator — verify real Firestore reads
- **Lowest seam:** pure filtering functions — no mocks needed

## Existing Test Coverage

- No existing tests for option chart store or spread chart store data fetching
- `rel-str-db-v2.service.ts` has direct Firestore read patterns that can be referenced
- Gaps: no tests for local bar reads from `symbol-data` subcollections

## Edge Cases

- **Empty year shard:** no data for the requested year → service returns empty array, chart shows empty state
- **Year boundary:** 30-day window spans Dec→Jan → `getRecentDailyBars$` reads both year shards and merges
- **Missing symbol:** `symbol-data/{SYMBOL}` doc doesn't exist → service returns empty array, chart shows error or empty state
- **Large year shard:** 252 bars in one doc → verify read time is still sub-100ms
- **Weekly/monthly doc missing:** `weekly/all` or `monthly/all` doesn't exist → service returns empty array
