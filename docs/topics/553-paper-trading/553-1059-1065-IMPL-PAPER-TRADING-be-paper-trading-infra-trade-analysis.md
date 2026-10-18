# BE IMPL — Trade Analysis & Forensics

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1065  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-17  

## Scope

Generation side of the pipeline (PRD US1/US2). One write path — **all** generation (live snapshot AND replay) enqueues a Cloud Task; the index doc appears immediately as `generating` and transitions to `ready`/`failed` on completion. No callable writes a dataset synchronously — replay already needs the task timeout budget, and one write path means one writer to test.

## 1. Dataset writer — `functions/src/paper-trading/analysis/dataset-writer.ts`

- `writeDataset(rows, meta, deps)` → serializes via the SHARED codec, uploads to `getStorage().bucket()` at `analysis-datasets/{datasetId}.csv` (precedent: `screenshot-capture/storage-writer.ts`), then updates the index doc at `analysisDatasetsPath()/items/{datasetId}` with `status: 'ready'`, `rowCount`, `gcsPath`.
- Failure flips the doc to `status: 'failed'` + `error` — never leaves `generating` stuck.
- Dataset id: `ds-{yyyymmdd}-{origin}-{shortHash(params)}` — versioned, never overwritten (PRD: snapshots accumulate). **As-built (#1076):** the hash input is `canonicalParams|isoTimestamp|nonce` — pure params-hash would collide on same-day same-config reruns; the nonce keeps "never overwritten" while honoring "two same-day runs → distinct ids".

## 2. Entry callable — `generateTradeDataset` (new `CallableName`)

- Validates params (`origin`, symbolScope, signalTypes, exitRule grammar, barRange, entryConvention, entryFilters), creates the index doc `generating`, enqueues `analysisDatasetTask` (pattern: `auto-paper-ingest-task.ts` — `onTaskDispatched`, dedupe on active dataset id is unnecessary since ids are unique), returns `{ datasetId }`.
- **As-built (#1076):** request/response/`AnalysisRunParams`/`AnalysisDatasetTaskPayload`/`ENTRY_CONVENTIONS` live in `shared/analysis-dataset-contracts.ts`; `entryFilters` added to `AnalysisDatasetDoc` (provenance-only). Validation whitelists `entryConvention` + `signalTypes`, checks exit-rule grammar via `parseVariantKey` gated to the three firing PRD families (`initial-stop`/`trailing-stop`/`time-stop` — `limit-stddev` parses but is stubbed never to fire, so it's rejected here), requires real calendar dates in `barRange` (regex + `Date.parse` — '2026-13-45' rejected), and uppercases `symbolScope` (the ledger keys symbols uppercase — a lowercase scope would silently produce an empty dataset).
- **As-built (#1076):** `analysisDatasetTask` ships as a stub `onTaskDispatched` that flips the index doc to `failed` ('not implemented — #1077/#1078') — an undeployed enqueue target would wedge docs at `generating`; a fail-loud stub keeps the deployable surface honest. Real passes land in #1077 (live) / #1078 (replay).
- **As-built (#1076):** verify scripts must name the bucket (`rel-str.appspot.com`) — parameterless admin init resolves the default bucket only in the function runtime, not under local ADC.

## 3. Task handler — `functions/src/paper-trading/analysis/analysis-dataset-task.ts`

- **live path**: enumerate `paper-trading/trades/items` (repo read), map each trade → `TradeAnalysisRow`: ledger-observed lifecycle fields, stamped `ind.*` from signal context, `strength.*` computed from SDS bars at entry date (reuse SDS reader used by eval-pass), `excursionSource: 'marks'`.
- **replay path**: for each symbol in scope, read SDS daily bars (`symbol-data/{sym}/daily/{yr}`), run `detectAllStTrendRiderSignals` (`st-cloud-function/strategies/signal-detection.ts`), filter to selected signalTypes, walk each signal forward under the exit-registry grammar (`paper-trading/exits/` — `trailing-N`, `time-Nd`, `initial-stop-N`) on daily closes; entry at signal-day close per `entryConvention`; outcomes/excursion modeled, `excursionSource: 'replay'`.
- Row batching: accumulate rows per symbol, write once at end; progress logged per symbol for multi-symbol runs.

## 4. Verify script — `functions/scripts/verify/paper-trading-analysis-dataset.ts`

- Dry-run live snapshot (counts rows, samples columns) without writing.
- Replay AMAT with defaults → row count + stats (98 closed, ~32.7% profitable, payoff ~1.30) compared to the validated prototype tolerances.
- Registered in `scripts/verify/run-all.ts` under the paper-trading group.

## Risks

- **Detection parity**: regenerated signals must match what production detected — `detectAllStTrendRiderSignals` needs the same zone inputs (ltfZone/windowV2) production feeds it; verify script pins the AMAT prototype numbers.
- **Exit grammar fidelity**: replay walk must use the registry, not a reimplementation — import from `exits/`.
- **Index-orphan**: task crash between enqueue and finalize leaves `generating` — writer fail-soft flips to `failed`; a sweep is out of scope.
