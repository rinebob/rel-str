**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1357  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Domain:** BACKTEST  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-02  
**Last Updated:** 2026-11-02  

# Test Plan — BE: Backtest Analytics

## E2E User Journeys

- Retry journey: run with QQQ failed / SPY success → `optionsReplayRetry` → QQQ list regenerates, SPY untouched, run counters correct. (Node-test level: Firestore stub + task-capture stub, no live deploy.)
- Analysis journey: a `success` list doc with N pick rows → `optionsAnalysisStart` → worker produces R result docs with N records each, aggregates reconcile with records.

## Integration Tests

### `optionsReplayRetry`
- Failed-only reset: `listOutcomes` with mixed success/failed → only failed symbols' list docs reset to `pending`, `listOutcomes` entries removed, `failedLists` decremented, run `status:'running'`, exactly the failed symbols enqueued.
- No failed symbols → `{retriedSymbols:[]}`, zero writes, zero tasks.
- Run `status:'running'`/`'pending'` → no-op response, zero writes.
- Terminal-skip interaction: a re-enqueued task against a still-`success` doc no-ops (existing worker guarantee — regression spec only).

### `optionsAnalysisStart`
- Missing doc / non-`success` status → `failed-precondition`.
- Valid → task payload carries `contractListDocId`, `runId`, `symbol`, `templateId`, `registryVersion`.

### Worker
- Marker rows excluded; repeat contractId rows produce independent records.
- Per-contract fetch failure → `outcome:'error'` record; analysis still `success`; aggregate `errorCount` increments, hitRate denominator excludes it.
- Result doc idempotency: second task overwrites same `{listDocId}_{exitId}` docs (merge), no duplicate/append behavior.
- Chunk threshold: list over `ANALYSIS_CHUNK_THRESHOLD` enqueues slices (if the escape hatch is built v1; otherwise deferred-test note).

## Unit Tests

### Exit evaluators (`exit-evaluators.ts`) — the core deliverable
- `target-pct-premium`: fires on first day mark ≤ threshold; correct `exitDate`/`exitPrice`; doesn't fire if never reached.
- `absolute-price`: same shape at $1.00/$0.50 boundaries (inclusive comparison).
- `stop-pct-premium`: fires when mark ≥ 2× entry (adverse direction); never on favorable moves.
- `dte-time`: fires on first day remaining-DTE ≤ param; correctly derives DTE from series dates vs contract expiry.
- `hold-to-expiry`: never fires.
- **Non-termination property:** a series where target-50 fills day 5 still produces complete dte-21 and expiry scans (verifies per-rule independence — PRD story 6).
- MAE/MFE per rule window: worst/best mark + date over entry→exit only (not beyond the exit — PRD story 8).
- Post-expiry clip: bars past `expiration` produce no exits and no excursion (added #1371 review round 1 — the evaluator clips internally).
- Expiry outcome (worker #1372 — not the pure evaluators): `expiredItm` from last-bar mark/strike vs underlying close; `assignmentDistancePct` math; missing underlying-close field → defined fallback or error record (depends on the IMPL's flagged verification).

### Aggregator
- hitRatePct, avgDaysToExit, avgPremiumCapturedPct, worstMae, p50/p90 computed over synthetic record sets; empty-set and all-error edge cases → defined (no NaN).

## Test Seams

- SA client seam: `callPartnerHistoricalOptionsContractV2` stubbed (same fetch-stub pattern as `pick-doc-client.test.ts`) — series fixtures returned per contractId.
- Firestore seam: stubbed collection/doc handles (existing worker-test pattern).
- Task queue seam: capture enqueued payloads.

## Edge Cases

- Empty pick list (all markers) → result docs written with empty trades + zero aggregates, not a failure.
- Series shorter than hold window (contract delisted/missing tail) → record still produced; expiry fields absent.
- Same-day exit (mark fires on pick date) → `daysHeld: 0`, exit recorded.
- Upstream 429/5xx mid-fetch → per-contract error records; Cloud Task retry only on task-level failure.
