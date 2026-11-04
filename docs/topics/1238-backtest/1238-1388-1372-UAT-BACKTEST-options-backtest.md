**Topic:** Options Backtest  
**Topic Slug:** 1238-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** 1266-backtest-analytics  
**Issue:** #1388  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1372  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-03  
**Last Updated:** 2026-11-03  

# UAT — #1372 Analyzer worker + batch fetch + aggregates + writes

**QA issue:** #1388 · **Code review:** `1238-1365-1372-CODE-REVIEW-BACKTEST-options-backtest.md` (PASS, 1 round) · **Result: PASS**

## Results log

| # | Scenario | Expected | Actual | Result |
|---|---|---|---|---|
| 1 | Worker + aggregator + evaluator + start suites | All green | 62/62 | PASS |
| 2 | Sibling options-replay regression | All green | 65/65 | PASS |
| 3 | Status re-check (IMPL-BE §3) | missing doc → retryable throw; non-success ×3 → retryable; `rows` deleted → retryable; final attempt → quiet return, **zero writes** | 4 specs pin all postures | PASS |
| 4 | Per-contract fetch failure | `error` record under EVERY exitId; `status:'success'` docs still written; `hitRatePct` absent (denominator 0) | Spec'd | PASS |
| 5 | One record per pick per exit type | markers excluded; repeated `contractId` → independent records; `contractCount` reconciles | Spec'd | PASS |
| 6 | Outcome mapping | fired → `exit` + `daysHeld` calendar-days (Fri→Mon = 3); same-day = 0; no-fire + expiry bar → `expired` + ITM/intrinsic/distance | Spec'd | PASS |
| 7 | Error paths — never fabricated | truncated tail, **head-truncated** (missing pick-day bar), empty series, missing underlying close, unusable `resp.type` → `error` each | 5 specs | PASS |
| 8 | Final-attempt failure | ANY post-recheck failure → `failed` docs for all exits (IMPL-BE §3.6); mid-run → retryable throw | Spec'd | PASS |
| 9 | Idempotency + timeout | rerun writes same `{listDocId}_{exitId}` doc ids (batch, full `set()`); `timeoutSeconds: 540` | Spec'd + config | PASS |
| 10 | Aggregates reconcile | error-excluding hitRate denominator; `entryMark > 0` premium-captured filter; nearest-rank p50/p90; absent-stat convention; empty set → zero counts, no NaN | 13 aggregate specs | PASS |
| 11 | Fetch request contract | `symbol` + `contractID` + `startDate=entryDate` + `endDate=expiration` per pick | Spec'd | PASS |
| 12 | Toolchain | `tsc --noEmit`, eslint (options-analysis + async-utils), esbuild 2.0mb | All clean | PASS |
| 13 | Export wiring | `optionsReplayAnalysis` exported from `functions/src/index.ts` | Present | PASS |

## Refinement pass

N/A — no user-facing surface (backend task worker; FE caller is #1376).

## Verified configuration

`optionsReplayAnalysis`: `maxAttempts 3`, backoff 10–120s, `maxConcurrentDispatches 10`, `maxDispatchesPerSecond 5`, `512MiB`, `timeoutSeconds 540`. Writes: one `db.batch()` commit of full `set()`s; final-attempt `failed` docs via same seam.

## Carried forward

- Deploy lands the `optionsReplayAnalysis` queue consumer — the #1370 `optionsAnalysisStart` callable becomes live-safe once both are deployed (deploy together or worker-first).
- `ANALYSIS_CHUNK_THRESHOLD` deferred per IMPL-BE (~250-row lists).
- `side` unused until #1270 long-premium templates.
