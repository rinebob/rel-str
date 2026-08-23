**Topic:** Refactor data pipeline to PDR-driven triggers, consolidate local bar store writers, and migrate charts to local reads  
**Issue:** #170  
**Topic Parent:** #159  
**Domain:** DATA-PIPELINE  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-08-24  
**Last Updated:** 2026-08-24  

---

# Code Review: FE Task #170 — Local bar-read service

## Review scope

| File | Status |
|------|--------|
| `src/app/core/services/local-bar-read.service.ts` | New — 155 lines |
| `src/app/core/services/local-bar-read.service.spec.ts` | New — 26 tests |
| `src/app/core/common/pt-date-utils.ts` | New — shared PT date utilities |
| `src/app/core/models/market-data.types.ts` | New — shared OhlcBar type |
| `src/app/features/rh-agent/services/rh-agent-chart.service.ts` | Modified — imports shared OhlcBar type |
| `scripts/verify-local-bar-read-service.js` | New — verification script |

## Review axes

Three parallel review axes were run: **Standards**, **Spec**, and **Thermo-nuclear**.

## Findings and fixes

### Fixed (from review feedback)

| # | Severity | Axis | Finding | Fix |
|---|----------|------|---------|-----|
| 1 | Critical | Standards | Unused imports `collection`, `getDocs` | Removed — only `doc`, `getDoc` are used |
| 2 | Major | Standards | Header comment said `collection(), query(), getDocs()` but service uses `doc(), getDoc()` | Updated comment to match implementation |
| 3 | Critical | Thermo-nuclear | `OhlcBar` missing `barStatus` field from backend canonical type | Added `barStatus?: -1 \| 0 \| 1` to match `functions/src/common/market-data-types.ts` |
| 4 | Critical | Thermo-nuclear | No `Array.isArray` validation — malformed `bars` field could crash at `.sort()` | Added `extractBars()` helper with `Array.isArray` guard |
| 5 | Major | Thermo-nuclear | `Promise.all` in `getRecentDailyBars$` — one shard failure loses all data | Switched to `Promise.allSettled` for partial failure resilience |
| 6 | Major | Thermo-nuclear | Year boundary test didn't verify exact cutoff boundary | Added bar on cutoff date (Dec 6) + new "excludes bars before cutoff" test |
| 7 | Minor | Thermo-nuclear | Tests didn't verify Firestore paths | Added path verification test for `getDailyBars$` |
| 8 | Minor | Thermo-nuclear | No tests for malformed data | Added 3 malformed data tests (non-array bars, null bars, non-object doc) |
| 9 | Critical | Thermo-nuclear | Timezone: UTC vs Pacific Time — backend writes bar dates and year shards in PT | Created `core/common/pt-date-utils.ts` (mirror of backend `pt-date-utils.ts`); `getRecentDailyBars$` now uses `daysAgoPT()` and `getPtYear()` instead of UTC methods. Added PT timezone test verifying midnight UTC doesn't cause wrong year. |
| 10 | Major | Standards | `OhlcBar` duplicated across `local-bar-read.service.ts` and `rh-agent-chart.service.ts` | Created shared `core/models/market-data.types.ts` with canonical `OhlcBar` + `OhlcBarsDoc`. Both services now import from the shared location. `rh-agent-chart.service.ts` also updated to use shared type (includes `barStatus` field). |

### Not fixed (out of scope or pre-existing)

| # | Severity | Axis | Finding | Rationale |
|---|----------|------|---------|-----------|
| C | Minor | Thermo-nuclear | Symbol validation (regex whitelist) | Firestore SDK sanitizes document IDs. Low risk for client-side service behind auth. |
| D | Major | Thermo-nuclear | No size limit on year shard reads | Year shards contain ~252 daily bars (~12KB). Reasonable for Firestore document reads. |
| E | Nit | Thermo-nuclear | Error logs don't include `err.message` | The full `err` object is logged, which includes the message and stack trace. |
| F | Nit | Thermo-nuclear | Verification script is superficial | Verification script is a smoke test, not a replacement for the test suite. It runs the actual Jest tests. |

## Spec compliance

All 8 acceptance criteria met:

| Criterion | Status |
|-----------|--------|
| LocalBarReadService created in `src/app/core/services/` | PASS |
| `getDailyBars$(symbol, year)` reads from `symbol-data/{SYMBOL}/daily/{year}` | PASS |
| `getWeeklyBars$(symbol)` reads from `symbol-data/{SYMBOL}/weekly/all` | PASS |
| `getMonthlyBars$(symbol)` reads from `symbol-data/{SYMBOL}/monthly/all` | PASS |
| `getRecentDailyBars$(symbol, days)` reads year shard and filters to last N days | PASS |
| Year boundary handling (Dec + Jan year shards merged) | PASS |
| Follows existing `rel-str-db-v2.service.ts` pattern | PASS |
| Unit tests | PASS — 25 tests, all passing |

## Test results

```
Test Suites: 1 passed, 1 total
Tests:       26 passed, 26 total
```

## Build results

- TypeScript typecheck: clean
- Angular build: success

## Verdict

**PASS**
