**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1357  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Domain:** BACKTEST  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-11-02  
**Last Updated:** 2026-11-02  

# Implementation Plan — BE: Backtest Analytics

## Architecture Overview

Three BE surfaces:

1. **`optionsReplayRetry` callable** — reruns failed per-symbol list docs of an existing run in place.
2. **`optionsAnalysisStart` callable** — validates a completed contract list and enqueues one analysis task.
3. **`optionsReplayAnalysis` task worker** — fetches every picked contract's series from SA (bounded concurrency), evaluates the full exit registry per contract through expiry, and writes one result doc per (list × exit type).

```mermaid
flowchart LR
    UI[FE run list] -->|optionsReplayRetry runId| RET[Retry callable]
    RET -->|"reset failed listOutcomes → pending,<br/>re-enqueue failed symbols only"| Q1[replay task queue]
    UI2[FE contract-list card] -->|optionsAnalysisStart listDocId| AST[Analysis start callable]
    AST -->|"validate success + registryVersion"| Q2[analysis task queue]
    Q2 --> W[optionsReplayAnalysis worker]
    W -->|"bounded-concurrency ×10"| SA[SA partnerHistoricalOptionsContractV2]
    W -->|"R result docs"| FS[(st-options-analysis-results<br/>{listDocId}_{exitId})]
```

## Modules

### 1. `functions/src/options-replay/retry.ts` — `optionsReplayRetry` (new)

- Request `{runId}`. Load run doc → `listOutcomes`; failed symbols = entries `=== 'failed'`.
- Empty failed set → return `{retriedSymbols: []}` (idempotent no-op).
- Per failed symbol: set list doc `status: 'pending'`, delete `rows`/`pickDocMeta`/`error`, then in one run-doc update: delete `listOutcomes.{symbol}` + `failedLists--` + `status: 'running'`.
- Enqueue `OptionsReplayPermutationPayload` per failed symbol on the existing replay queue — the worker's terminal-skip keeps success docs untouched.
- No-op while run `status === 'running'`/`'pending'` (per approved PRD story 4).

### 2. `functions/src/options-analysis/start.ts` — `optionsAnalysisStart` (new)

- Request `{contractListDocId}` (shape `{runId}_{symbol}` — validate it exists, `status === 'success'`; non-success → `failed-precondition`).
- Enqueue `OptionsAnalysisTaskPayload` on a dedicated Cloud Task queue — named `optionsReplayAnalysis` after the §3 worker function it feeds (queue names = `onTaskDispatched` export names); respond with `analysisId = contractListDocId`.
- Idempotent: re-invocation enqueues a fresh task that overwrites the same `{listDocId}_{exitId}` docs for the current `EXIT_REGISTRY_VERSION`.

### 3. `functions/src/options-analysis/worker.ts` — `optionsReplayAnalysis` (new, onTaskDispatched)

Per task (`contractListDocId`):

1. Load list doc; collect pick rows (`contractId` present) — markers skipped. **Status re-check required (#1370 review):** re-validate `status === 'success'` at run time — a doc enqueued while `success` can be reset to `pending`/`running` by a later `optionsReplayRetry` before the task dispatches. Missing/`undefined` `rows` is a reset-in-progress, NOT a valid empty analysis — treat as retryable (throw → Cloud Task retry), never write zero-count result docs over good ones. A genuinely empty `success` list (all markers) still writes empty result docs per TEST-BE.
2. **Series fetch** — for each pick row, `callPartnerHistoricalOptionsContractV2(contractId)` from `functions/src/options-contract-proxy.ts`. Bounded concurrency (10) via a simple p-limit-style pool. Per-contract fetch failure → `outcome:'error'` record, never aborts the analysis.
3. **Evaluate** — for each row × each `EXIT_STRATEGIES` rule, walk the series day-by-day from pick-date through expiry:
   - Evaluator functions keyed by `kind` — pure, non-terminating-friendly: each rule scans independently; when it fires, record `{exitDate, exitPrice}` and stop *that rule's* scan (its position is closed); other rules continue.
   - Marks evaluated against contract `mark` (or bid/ask convention — pick one and document; default: mark).
   - MAE/MFE recorded per (row × rule) over its own hold window.
   - No exit by the **expiry bar** → `outcome:'expired'` + `expiredItm`/`intrinsicAtExpiry`/`assignmentDistancePct` from that bar + underlying close — ONLY when the series's last bar is the expiry bar (`PickDocDay.expiration` is on the pick row for the comparison). A series that ends early (delisting, corpus hole) is truncated, not expired → `outcome:'error'`, never fabricated expiry fields (contract convention on `AnalysisExpiredTrade`). (Series carries contract marks; underlying close needed — pick rows already carry `underlyingClose` for pick day; expiry-day underlying comes from the series's last bar if present, else the underlying daily bars already fetched by the replay worker path — IMPL detail: prefer a `underlyingClose` field on the series bar; verify at implement time).
   - `hold-to-expiry` never fires — it absorbs the expiry outcome record.
4. **Aggregate** — per exit type: counts, hitRatePct, avgDaysToExit, avgPremiumCapturedPct, worstMae (+ optional p50/p90).
5. **Write** — `st-options-analysis-results/{listDocId}_{exitId}` `set(merge:true)` per exit type: `status:'success'`, trades, aggregate, `registryVersion`, `generatedAt`. **Stale-field trap:** merge keeps the prior `error` string on a failed→success rewrite — terminal success writes must clear `error` (`FieldValue.delete()` or a full `set`).
6. Failure before writes → mark in-flight docs `failed`; Cloud Task retry re-runs idempotently (overwrite semantics).

**Timeout posture:** explicit `timeoutSeconds` (e.g. 540s/9min — matches or exceeds the replay worker's posture; verify its config and match). ~250 contracts × concurrency-10 ≈ tens of seconds typical. Row-count escape hatch: if pick rows > `ANALYSIS_CHUNK_THRESHOLD` (e.g. 400), the task enqueues row-slice sub-tasks and a finalize pass; not expected to trigger v1.

### 4. Registry evaluators (`functions/src/options-analysis/exit-evaluators.ts`, new)

Pure functions: `(series: DayBar[], entryMark: number, rule: ExitStrategyDef) => ExitScanResult` — fires → `{fired:true,date,price,dayIndex}`; else `{fired:false}`. Hold-window MAE/MFE computed in the same walk. Unit-testable without network.

### 5. Reuse from legacy sim (adapted)

- `computeMetrics` — **not wired in v1** (no equity curve yet); kept available for the follow-on per-exit-type equity curve task.
- `BacktestTrade`-shaped record conventions — naming/dating conventions borrowed where sensible; `AnalysisTradeRecord` is its own contract.
- Exit predicates — the *ideas* (target/stop/DTE checks) ported into the new non-terminating evaluator shape; the sim's terminating position-loop is not reused.

## Decisions

- **One task per contract list**, not per exit type — series fetched once; evaluating R exits over an in-memory series is CPU-trivial. Per-exit tasks would fetch N×R series.
- **Dedicated analysis queue** — separate from the replay queue so a heavy analysis can't starve run fanout; independent retry config.
- **Series discarded post-eval** (ADR-010) — only computed records persist.
- **Underlying close at expiry** — flagged as the one unverified data dependency; the series-bar shape must be confirmed before the expiry-outcome fields are finalized.
