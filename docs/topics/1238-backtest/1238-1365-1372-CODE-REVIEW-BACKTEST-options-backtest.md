**Topic:** Options Backtest  
**Topic Slug:** 1238-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** 1266-backtest-analytics  
**Issue:** #1365  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1372  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-03  
**Last Updated:** 2026-11-03  

# CODE-REVIEW — #1372 Analyzer worker + batch fetch + aggregates + writes

## Verdict: PASS (one round)

All three axes report the remediation set as fixed-by-construction after the in-cycle batch. Verdict advanced `6_REVIEW` → `7_QA`.

## Review surface

New: `functions/src/options-analysis/worker.ts`, `functions/src/options-analysis/records.ts`, `functions/src/options-analysis/aggregate.ts`, `functions/src/common/async-utils.ts`, `tests/functions/options-analysis/{worker,aggregate}.test.ts`. Modified: `functions/src/index.ts` (export), `functions/src/webhooks/partner-webhooks.ts` (helper promotion re-export), `shared/options-analysis-contracts.ts` (comment fixes), IMPL-BE §3 as-built annotation.

## Round 1 findings → remediation

### Convergent (multiple axes)

| Finding | Axes | Fix |
|---|---|---|
| Doc-id template literal bypassed `stOptionsAnalysisResultDocId` (st-collections:116) | Standards (hard), Spec, TN | Helper imported, both write sites |
| Inline payload shape duplicated `OptionsAnalysisTaskPayload` (contracts:191) | Standards (hard) | Shared type imported for fn param + `onTaskDispatched` generic |
| `logger` from `firebase-functions/v2` vs sibling `firebase-functions/logger` | Standards, TN | Swapped |
| `AnalysisExpiredTrade` comment "type parsed from contractId" vs as-built `resp.type`; `avgPremiumCapturedPct` missing the `entryMark > 0` filter note | Standards, Spec, TN | Shared contract comments corrected |

### Thermo-nuclear judo (all applied)

- **Bespoke fetch pool deleted** — `forEachWithConcurrency` promoted to `common/async-utils.ts`, re-exported from `partner-webhooks.ts` (its 3 existing call sites unchanged); worker imports from `common/` (no backward dep into webhooks).
- **Rule-invariant branching hoisted** — `buildPickRecords` (records.ts) returns one record per exitId in registry order; fetch-failure/empty/head-truncated short-circuits to `error` under every exitId outside the per-rule loop; the shared no-fire expired/error outcome is computed once per pick (only `exitId` varies).
- **Writes atomic** — `Promise.all` of six `set()`s → one `db.batch()` commit behind the `writeResultDocs` seam.
- **Dead `sub()` deleted** — `''` excursion dates require an empty window, unreachable under the empty-bars guard.
- **Failed-doc aggregate** via `aggregateExitType(exitId, 0, [])` — single-source zeroed shape.
- **Silent empty underlying map** → `options_analysis_underlying_empty` warn (the symbol-data loader swallows failures into empty bars).

### Spec gap

- **IMPL-BE §3.6 was partial** — only write-failures marked docs `failed`. Now a top-level catch: ANY post-recheck exception on the final attempt writes `failed` docs for all exits (the inner write try/catch folded in). Reset-in-progress still returns silently — never clobber good docs.
- **Head-truncated series** — a series missing the pick-day bar violated the evaluator's `series[0]` precondition while still emitting records. Now `error` ("pick-day bar missing"), spec'd.

### Deferred / judgement (not blocking)

- `RecordSeed` mirrors unexported `AnalysisTradeBase` — kept (documents intent; exporting the base couples shared contracts to worker internals).
- No `contractId` fetch dedup — repeated IDs are independent positions with different windows; correct as-is.

## Files after remediation

`worker.ts` 290 lines (was 456 — under the 400 guideline): deps seam + status re-check + orchestration + prod wiring. `records.ts` 201 lines: `toScanBars` + record construction + `buildPickRecords`. `aggregate.ts` 79 lines (unchanged).

## Verified post-remediation

- `test:options-analysis` → **62/62** (incl. new: fetchSeries request-contract, head-truncation)
- `test:options-replay` → **65/65**
- Full jest → **288/288 suites, 5,008/5,008**
- `tsc --noEmit` + eslint (src/options-analysis, async-utils) + esbuild — all clean
- `git diff --check` — clean for task files (foreign `scripts/verify/run-all.ts` has pre-existing trailing whitespace)
- partner-webhooks.ts: 98 pre-existing eslint warnings → 97 after (promotion removed the deleted function's own warning)

## Carried forward

- `side` on pick rows remains unused until #1270 long-premium templates (documented in contracts + IMPL-BE §4).
- `ANALYSIS_CHUNK_THRESHOLD` deferred per IMPL-BE's own allowance (~250-row lists).
- Contract-doc comments now ratify `resp.type` + `entryMark > 0` premium-captured filter.
