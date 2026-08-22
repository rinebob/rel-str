**Topic:** Refactor data pipeline to PDR-driven triggers, consolidate local bar store writers, and migrate charts to local reads  
**Issue:** #161  
**Topic Parent:** #159  
**Domain:** DATA-PIPELINE  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-08-23  
**Last Updated:** 2026-08-23  

---

# Implementation Plan: BE — Data Pipeline PDR Migration

## Overview

Build the new PDR-triggered `symbolDataSync` (SDS) as a parallel Pub/Sub subscriber, completion signal with watchdog, fallback timer, open pass timer, intraday doc separation, PDRv2 currentPrice removal, dead code cleanup, and logging/monitoring.

## Components

### 1. SDS Pub/Sub subscriber (`functions/src/symbol-data-sync/sds.ts`)

New `onMessagePublished` Cloud Function on `partner-data-ready` topic. Parses PDR message attributes (`runType`, `phase`, `runId`, `marketDate`, `clockPt`, `interval`) and message body (`excludeSymbols`, `includeSymbols`). Determines symbol set and interval based on run type. Creates `symbol-data-sync-runs/{runId}` doc with idempotency check. For POST runs, also creates or updates a parent `symbol-data-sync-sequences/{sequenceRunId}` doc. Enqueues Cloud Tasks per symbol to the SDS task queue.

**PDR message reference:** `av-proxy-api/functions/docs/pdr-message-guide.md`

**Key decisions:**
- Per-interval processing: each POST message is handled independently — DAILY msg fetches DAILY, WEEKLY msg fetches WEEKLY, MONTHLY msg fetches MONTHLY. No deduplication.
- A vs B/C distinction: check for `excludeSymbols` (A) vs `includeSymbols` (B/C) in message body, or parse `runId` sequence segment (`-A-` vs `-B-`/`-C-`)
- Idempotency: check if `symbol-data-sync-runs/{runId}` exists with terminal status before enqueuing
- Symbol set resolution: POST A = all tracked minus excludeSymbols (per-interval), POST B/C = includeSymbols only (skip if empty), intraday = all tracked
- Uses `callPartnerTrackedSymbols` to get the full tracked symbol universe

### 2. SDS task worker (`functions/src/symbol-data-sync/sds-worker.ts`)

Cloud Task handler. Per symbol, per interval:
- Fetches the interval specified in the task payload from SA via `callPartnerTimeSeries({ interval })`
- POST DAILY: writes `daily/{YYYY}` shard using `set({ merge: true })`, writes `currentPrice` on root doc
- POST WEEKLY: writes `weekly/all` doc using `set({ merge: true })`. Does NOT write `currentPrice`.
- POST MONTHLY: writes `monthly/all` doc using `set({ merge: true })`. Does NOT write `currentPrice`.
- Intraday PRE: fetches DAILY bars, extracts intraday fields from latest bar, writes only `intraday/latest` doc with `ip/ipc/io/it/ic/marketDate`, writes `currentPrice` on root doc
- Increments `processedCount` in `finally` block (always, success or failure)
- On success: increments `successCount`. On failure: increments `failedCount`, appends to `failedSymbols`
- Calls `checkSyncRunCompletion` after incrementing (per-interval completion)

### 3. Completion signal + watchdog (`functions/src/symbol-data-sync/sds-completion.ts`)

`checkSyncRunCompletion` — transaction-wrapped per-interval check. When `processedCount >= totalSymbols`, marks interval run complete and updates the parent sequence doc (for POST runs). When all 3 intervals in a sequence complete, fires the sequence completion callback.

Sequence completion callback:
- Enqueues separate Cloud Tasks for each downstream consumer (selection, settlement, RH Agent)
- Marks `completionEnqueued: true` on the sequence doc only after all enqueues succeed
- If enqueue fails: leaves sequence in `completed_but_not_dispatched` status

Intraday runs have no fan-in — completion fires directly on the run doc.

`watchdog` — scheduled function every 5 minutes. Checks for:
- Stale interval runs (`status == 'processing'`, `startedAt` > 15 min ago) → forces per-interval completion
- Stale sequences (`status == 'processing'`, `startedAt` > 20 min ago) → forces sequence completion
- `completed_but_not_dispatched` runs/sequences → retries enqueue

**RS extension point:** the sequence completion callback has a defined interface (`enqueueRsConsumer(runContext)`) that is not wired up. Future topic plugs PDRv2 in here.

### 4. Intraday doc (`functions/src/symbol-data-sync/intraday-writer.ts`)

New writer for `symbol-data/{SYMBOL}/intraday/latest`. Small doc with `ip`, `ipc`, `io`, `it`, `ic`, `marketDate`. Overwritten on each intraday run. Preserved (not cleared) by POST runs.

### 5. Fallback timer (`functions/src/symbol-data-sync/sds-fallback.ts`)

Scheduled function at 3 PM PT (cron, America/Los_Angeles). Queries `symbol-data-sync-sequences` for any doc where `marketDate == today` and `sequence == 'A'` and `status` is `processing` or `completed`. If none, creates 3 interval sync runs (DAILY, WEEKLY, MONTHLY) plus a parent sequence doc — same structure as a PDR-triggered POST A. No `excludeSymbols` filtering. Logs alert on failure.

### 6. Open pass timer (`functions/src/options-strategy-engine/passes/open-pass-timer.ts`)

Scheduled function every 5 minutes during market hours (6:30 AM–1 PM PT). Computes current 5-minute slot (truncate to 5-min boundary, format as `HH:MM`). Queries active strategy instances `where('openTimePT', '==', currentSlot)`. Runs open pass for matching instances only. Reads from `symbol-data` for underlying price — does NOT depend on SDS completion.

### 7. PDRv2 currentPrice removal

Surgical removal of `upsertSymbolCurrentPrice` call at line 717 of `partner-webhooks.ts` (inside `processPairLive`, called by `processDataReadyRunV2`). No other changes to PDRv2.

### 8. Dead code cleanup

- Delete `processSymbolsReady` and `processSymbolsReadyHttpTest` from `partner-webhooks.ts`
- Remove `PARTNER_SYMBOLS_READY_TOPIC` from `webhooks-config.ts`
- Remove commented-out export from `index.ts`
- Remove `USE_SYMBOL_DRIVEN_PIPELINE` flag from `webhooks-config.ts`
- Delete `rhAgentPdrTrigger` entirely from `rh-agent-trigger.ts`
- Delete `symbolDataSyncNightly` (old cron-based function)
- Delete `syncTrackedSymbolsDaily`
- Disable `backfillSymbolDataForTradesDaily` scheduled function (remove from `index.ts` exports). Keep `backfillSymbolDataForTrades` function and `backfillSymbolDataFromTradesAdmin` HTTP endpoint — code may be reused later.

### 9. Logging and monitoring

Structured logging with consistent fields (`runId`, `marketDate`, `symbol`, `phase`, `runType`) on every function. Write `docs/topics/159-data-pipeline/MONITORING.md` with tested Logs Explorer queries.

## Phases

### Phase 1: SDS core (subscriber + worker + intraday doc)
- SDS Pub/Sub subscriber with per-interval message handling and idempotency check
- SDS task worker with per-interval fetch/write paths (DAILY/WEEKLY/MONTHLY/intraday)
- Intraday doc writer
- `symbol-data-sync-runs` doc schema (per-interval)
- `symbol-data-sync-sequences` doc schema (parent sequence for POST fan-in)
- Delete `symbolDataSyncNightly` and `syncTrackedSymbolsDaily`

### Phase 2: Completion signal + watchdog + downstream consumers
- Transaction-wrapped `checkSyncRunCompletion` (per-interval)
- Sequence fan-in: when all 3 intervals complete, fire sequence completion
- Sequence completion callback with separate Cloud Task enqueue per consumer
- `completionEnqueued` safety flag on sequence doc
- Watchdog scheduled function (per-interval + sequence level)
- RS extension point interface (not wired)
- Wire SDS sequence completion → selection, settlement, RH Agent (nightly + intraday)
- Wire SDS intraday completion → RH Agent intraday
- Delete `rhAgentPdrTrigger`

### Phase 3: Fallback timer + open pass timer
- Fallback timer with race condition prevention
- Open pass timer with 5-minute slot query
- Delete old `optionsOpenPass` cron

### Phase 4: PDRv2 cleanup + dead code + logging + monitoring
- Remove `currentPrice` side-effect from PDRv2
- Delete `processSymbolsReady`, `PARTNER_SYMBOLS_READY_TOPIC`, `USE_SYMBOL_DRIVEN_PIPELINE`
- Add structured lifecycle logging to all new functions
- Write MONITORING.md with tested Logs Explorer queries

## Dependencies

- Phase 1 → Phase 2 (completion needs the worker to exist)
- Phase 2 → Phase 3 (open pass and fallback are independent of each other but both depend on SDS existing)
- Phase 4 can run in parallel with Phase 3 (PDRv2 cleanup is independent of timers)
