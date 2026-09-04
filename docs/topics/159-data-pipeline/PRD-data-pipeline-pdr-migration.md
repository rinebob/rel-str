**Topic:** Refactor data pipeline to PDR-driven triggers, consolidate local bar store writers, and migrate charts to local reads  
**Issue:** #160  
**Topic Parent:** #159  
**Domain:** DATA-PIPELINE  
**Type:** PRD  
**Status:** Approved  
**Created:** 2026-08-21  
**Last Updated:** 2026-08-23  

---

## Problem Statement

rel-str's data sync runs on fixed cron schedules that guess when SA's data is ready. Three separate functions fetch from SA and write `currentPrice` to the local bar store, causing redundant API calls, race conditions, and drift between `currentPrice` and the latest bar in the year shards. The options open pass runs all strategies in a single batch at 6:45 AM, but each strategy needs its own open time. The option chart and spread chart fetch underlying bars via an HTTP round trip to SA, causing 5-10 second load times for data that already exists in the local bar store. A dead Pub/Sub subscriber (`processSymbolsReady`) and its associated config/flags are still in the codebase despite being disabled.

## Solution

Build a new PDR-triggered `symbolDataSync` (SDS) as a parallel Pub/Sub subscriber alongside the existing RS pipeline. SDS triggers on all 12 PDR messages per trading day (3 intraday PRE + 9 POST — 3 per interval D/W/M for each of A/B/C sequences). Each POST message is handled per-interval — DAILY messages fetch and write daily shards, WEEKLY fetches and writes weekly, MONTHLY fetches and writes monthly. A sequence-level fan-in tracks when all 3 intervals for a POST sequence complete, then triggers downstream consumers. Intraday PRE messages fetch daily bars, extract intraday fields, and write a separate intraday doc. SDS is the single writer of `currentPrice` (written on DAILY and intraday runs only). SDS completion triggers all RH Agent and options engine downstream consumers (selection, settlement, RH Agent nightly and intraday). The RS pipeline (`processDataReadyRunV2`) is completely untouched — it stays as its own PDR subscriber, fetches from SA independently, and writes to `pairs-data` as today. The only change to PDRv2 is removing the `currentPrice` side-effect write (non-RS code). SDS includes an extension point for a future RS consumer so RS can migrate to reading from the local bar store in a later topic. Replace the single batch open pass with a periodic timer. Migrate option/spread charts to read from the local bar store. Clean up dead code.

## User Stories

1. As a strategy researcher, I want the data sync to trigger when SA confirms data is ready, so that I'm not syncing stale or incomplete data.

2. As a strategy researcher, I want `currentPrice` to be written by a single process, so that it's always consistent with the latest bar in the year shards.

3. As a strategy researcher, I want each strategy instance to open at its configured `openTimePT`, so that I can test multiple open times throughout the trading day for the same strategy.

4. As a strategy researcher, I want to create strategy instances with different open times without code changes, so that I can rapidly iterate on research configurations.

5. As a user viewing the option chart, I want underlying bars to load in under 100ms, so that the chart renders instantly instead of making me wait 5-10 seconds.

6. As a user viewing the spread chart, I want underlying bars to load in under 100ms, so that the chart renders instantly instead of making me wait 5-10 seconds.

7. As a developer, I want the selection pass to trigger automatically after the data sync completes, so that I don't need a separate cron job guessing when data is available.

8. As a developer, I want the settlement pass to trigger automatically after the data sync completes, so that expiring positions are settled as soon as closing bars are available.

9. As a developer, I want the settlement pass to retry straggler symbols after POST B and C complete, so that positions whose underlyings failed in POST A still get settled when data becomes available.

10. As a developer, I want the RH Agent nightly run to trigger after the data sync completes, so that signals are generated on fresh data.

11. As a developer, I want the RH Agent nightly run to retry straggler symbols after POST B and C complete, so that symbols that failed in POST A still get signals when data becomes available.

12. As a developer, I want a fallback timer at 3 PM PT that triggers the full sync if no POST A PDR arrives, so that a SA Pub/Sub failure doesn't result in a completely missed nightly run.

13. As a developer, I want an alert when the fallback sync fails, so that I know SA/AV is down and can investigate.

14. As a developer, I want the dead `processSymbolsReady` subscriber and its config removed, so that the codebase doesn't carry abandoned code from a failed approach.

15. As a developer, I want `rhAgentPdrTrigger` deleted entirely (SDS completion replaces it), so that there's no dead trigger logic confusing future readers.

16. As a developer, I want `syncTrackedSymbolsDaily` deleted, so that there's no redundant midnight fetch competing with the PDR-triggered sync.

17. As a developer, I want the sync to respect `excludeSymbols` on POST A and `includeSymbols` on POST B/C, so that I'm not wasting SA calls on symbols known to have failed. `excludeSymbols` are symbols SA could not fetch data for in the POST A run; they become `includeSymbols` in POST B/C if SA successfully fetches them in those retry runs. If SA never fetches data for a symbol, it has no data for that market date.

18. As a developer, I want the RS pipeline (`processDataReadyRunV2`) to remain completely untouched by this work, so that RS calculations are not affected by the data pipeline refactor.

19. As a developer, I want SDS to include an extension point for a future RS consumer, so that RS can migrate to reading from the local bar store in a later topic without architectural rework.

20. As a developer, I want the mark pass to remain independent of the data sync, so that it continues fetching live option quotes from RH every 30 minutes without depending on SA data availability.

21. As a developer, I want extensive logging throughout every function's lifecycle, so that I can track progress of each run during and after completion.

22. As a developer, I want a process monitoring guide doc with Logs Explorer queries that work, so that I can monitor each function's progress through its lifecycle without guessing at query syntax.

## Implementation Decisions

### SDS — new parallel PDR subscriber

- A new `symbolDataSync` (SDS) function is created as a Pub/Sub subscriber on `partner-data-ready`. It runs in parallel with `processDataReadyRunV2` (PDRv2) — both fire on the same PDR messages.
- **PDR message reference:** see `av-proxy-api/functions/docs/pdr-message-guide.md` for the authoritative spec of all PDR messages, attributes, and runId formats.
- **PDR message cadence:** SA publishes 12 PDR messages per trading day:
  - 3 intraday PRE messages (`runType=intraday-snapshot`, `phase=pre`) at 8:00, 10:00, 12:00 PT. One message per tick, not per-interval.
  - 3 POST A messages (`runType=ts-post-all-intervals`, `phase=post`) at 1:35 PM PT — one per interval (DAILY, WEEKLY, MONTHLY), each with its own `runId` ending in `-DAILY`/`-WEEKLY`/`-MONTHLY`.
  - 3 POST B messages at 6:00 PM PT — one per interval.
  - 3 POST C messages at 4:00 AM PT (next day) — one per interval.
- **Per-interval processing:** each POST PDR message is handled independently — no deduplication or composite run ID. Each message triggers a sync run that fetches only its interval from SA and writes only its shard:
  - DAILY message → fetch DAILY bars via `callPartnerTimeSeries({ interval: 'DAILY' })`, write `daily/{YYYY}` shard, write `currentPrice` on root doc.
  - WEEKLY message → fetch WEEKLY bars, write `weekly/all` doc. Does NOT write `currentPrice` (same close as DAILY, redundant).
  - MONTHLY message → fetch MONTHLY bars, write `monthly/all` doc. Does NOT write `currentPrice`.
- **Intraday runs (PRE):** single message per tick, not per-interval. SDS makes one bulk call to `callPartnerIntradaySnapshotV2(allSymbols)` — a bulk endpoint that returns `{ ip, ipc, io, it, ic }` per symbol in a single response. SDS writes the intraday doc (`symbol-data/{SYMBOL}/intraday/latest`) and `currentPrice` for each symbol directly from the subscriber — no per-symbol Cloud Tasks needed for intraday. EOD year shards are NOT written on intraday runs. Completion fires directly (no fan-in).
- **A vs B/C distinction:** the `runType` Pub/Sub attribute is `ts-post-all-intervals` for ALL POST runs (A, B, and C). SDS distinguishes A from B/C by checking for `excludeSymbols` (A only) vs `includeSymbols` (B/C only) presence in the message body, or by parsing the `runId` sequence segment (`-A-` vs `-B-`/`-C-`).
- **Idempotency:** SDS uses the PDR message's `runId` directly as the sync run ID (e.g., `2026-01-24-FRI-A-DAILY-LIVE-POST-1335`). Before enqueuing tasks, it checks if `symbol-data-sync-runs/{runId}` already exists with a terminal status. If so, the PDR is a duplicate (Pub/Sub at-least-once delivery) and is skipped. Same pattern as PDRv2's `partner-events` idempotency check.
- **POST A (initial):** syncs all tracked symbols minus `excludeSymbols` for the message's interval. `excludeSymbols` are per-interval — a symbol could be stale for DAILY but fresh for WEEKLY.
- **POST B/C (retry):** syncs only `includeSymbols` for the message's interval. If `includeSymbols` is absent or empty, SDS skips enqueuing tasks but still records the run for completeness.
- **Intraday doc separation:** intraday fields live in a separate doc (`symbol-data/{SYMBOL}/intraday/latest`), NOT on the EOD year shard bars. This eliminates bloat on historical bars (no null intraday fields on 252 bars per year) and minimizes write volume on intraday runs (one small doc write vs full year shard rewrite). The `OhlcBar` type is NOT extended — EOD and intraday data are separate concerns with separate storage.
- **POST runs preserve intraday doc:** SDS POST runs do NOT clear the intraday doc. Same behavior as SA — the POST run writes EOD fields to the year shard and leaves the intraday doc intact. The intraday doc is overwritten by the next intraday run (next trading day).
- **Future RS migration:** when PDRv2 migrates to read from the local bar store (future topic), it reads the year shard for EOD bars and the intraday doc for today's intraday fields, then merges the intraday fields onto today's bar in memory. The `IDEA-rs-migration-to-local-bar-store.md` doc should be updated to reflect this read pattern.
- `syncTrackedSymbolsDaily` is deleted. Its responsibilities (write `currentPrice`, trigger selection) are absorbed by SDS.
- `symbolDataSyncNightly` (the old cron-based function) is deleted — SDS replaces it.

### PDRv2 — RS pipeline untouched

- `processDataReadyRunV2` remains a PDR subscriber. It continues to fetch D/W/M bars from SA independently and write RS computations to `pairs-data`. The RS pipeline is completely unaffected by this work.
- The ONLY change to PDRv2 is removing the `currentPrice` side-effect write (the `upsertSymbolCurrentPrice` call at line 717 of `partner-webhooks.ts`, inside `processPairLive`). This is non-RS code — `currentPrice` is not used by RS calculations. SDS is now the single `currentPrice` writer for tracked symbols.
- This means SDS and PDRv2 both fetch from SA on PDR messages. The duplicate SA calls are an accepted tradeoff until RS migrates to read from the local bar store in a future topic.

### Completion signal — SDS as gatekeeper for RH Agent and options

- SDS tracks each interval sync run in a `symbol-data-sync-runs/{runId}` doc. Fields: `runId`, `marketDate`, `runType`, `sequence` (A/B/C/intraday), `interval` (DAILY/WEEKLY/MONTHLY/intraday), `totalSymbols`, `processedCount`, `successCount`, `failedCount`, `failedSymbols` (array), `status` (`processing` | `completed` | `completed_but_not_dispatched` | `forced_complete`), `startedAt`, `completedAt`, `completionEnqueued`, `sequenceRunId` (points to parent sequence doc for POST runs).
- Each task worker increments `processedCount` in a `finally` block — always increments, whether the sync succeeded or failed. On success, also increments `successCount`. On failure, increments `failedCount` and appends the symbol to `failedSymbols`.
- The per-interval completion check is wrapped in a transaction to prevent the race condition where multiple workers read the count simultaneously and both trigger completion. Follow the precedent of `spread-run-worker.ts`.
- **Per-interval completion fires when either:**
  1. `processedCount >= totalSymbols` (all tasks have reported, success or failure) — normal completion.
  2. A **watchdog** forces completion after a timeout (see below).
- **Completion does NOT require 100% success.** If 862 of 863 symbols sync successfully, the run completes. Failed symbols are passed to the sequence-level completion.
- **POST sequence fan-in:** POST runs produce 3 independent interval sync runs per sequence (DAILY, WEEKLY, MONTHLY). A parent sequence doc `symbol-data-sync-sequences/{sequenceRunId}` (e.g., `2026-01-24-POST-A`) tracks: `intervalRunIds: { DAILY, WEEKLY, MONTHLY }`, `completedIntervals: []`, `failedSymbols` (merged across intervals), `status`, `completionEnqueued`. When an interval run completes, it adds its interval to `completedIntervals` on the sequence doc (transaction). When `completedIntervals.length >= 3`, the sequence is complete and downstream consumers are triggered.
- **Intraday runs have no fan-in:** a single sync run per tick. Completion fires directly — no sequence doc needed.
- **Watchdog:** a separate scheduled function runs every 5 minutes. It checks for:
  - Stale `symbol-data-sync-runs` docs where `status == 'processing'` and `startedAt` > 15 minutes ago → forces per-interval completion.
  - Stale `symbol-data-sync-sequences` docs where `status == 'processing'` and `startedAt` > 20 minutes ago → forces sequence completion with whatever intervals have reported.
  - `completed_but_not_dispatched` runs or sequences → retries enqueue.
- **Downstream consumers are separate Cloud Tasks:** the sequence completion callback does NOT call downstream consumers directly. It enqueues a separate Cloud Task for each consumer, then exits. This keeps the task worker fast and lets each consumer run independently with its own timeout and retry behavior.
- **Completion enqueue safety:** the sequence completion callback marks `completionEnqueued: true` on the sequence doc only after all downstream tasks are successfully enqueued. If the enqueue fails (transient GCP error, quota exceeded), the sequence stays in `completed_but_not_dispatched` status. The watchdog picks this up on its next tick and retries the enqueue.
- SDS completion callback enqueues (on sequence completion for POST, on run completion for intraday):
  - **POST A sequence completion:** selection pass task, settlement pass task (full), RH Agent nightly task (full). Failed symbols are merged across all 3 intervals and passed to each consumer.
  - **POST B/C sequence completion:** settlement pass task (scoped to `includeSymbols`), RH Agent nightly task (scoped to `includeSymbols`). Selection pass does not re-run.
  - **Intraday run completion:** RH Agent intraday task (replaces `rhAgentPdrTrigger`).
- **RS extension point:** the sequence completion callback includes a defined interface for enqueuing a future RS consumer task. This is not wired up — it's a documented extension point where PDRv2 will plug in when RS migrates to read from the local bar store in a future topic.

### Selection pass output

- The selection pass (`runEodSelectionPass`) produces an in-memory `EodSelectionPassResult` (selected contract quote, DTE, selection metadata).
- The EOD orchestrator writes two outputs to Firestore:
  - `options-rh-instrument-map/{occId}` — maps OCC option ID to RH instrument ID, chain ID, chain symbol, expiration, strike, type.
  - `options-strategy-instances/{instanceId}/daily-analysis/latest` and `daily-analysis/{date}` — overnight delta simulation (base underlying price, base contract ID, range/step pct, grid of underlying move pct vs delta/mark/theta).

### Settlement pass output

- The settlement pass (`runSettlementPass`) produces an in-memory `SettlementPassResult` (settled positions with status, value, P&L, errors).
- It writes transactionally to three locations:
  - `options-strategy-positions/{positionId}` — status (`EXPIRED_WORTHLESS` or `ASSIGNED_HOLDING_SHARES`), currentValue, unrealizedPnl, assignment details (if assigned).
  - `options-strategy-positions/{positionId}/legs/{legId}` — outcome (`EXPIRED_WORTHLESS` or `ASSIGNED`), closeDate.
  - `options-strategy-positions/{positionId}/daily-updates/{date}` — date, markPrice, underlyingClose.

### RH Agent trigger consolidation

- `rhAgentPdrTrigger` is removed. SDS completion now starts RH Agent for both intraday and nightly runs.
- Intraday SDS completion → `startRhAgentRun(marketDate, 'pdr')` (same call `rhAgentPdrTrigger` made).
- POST A SDS completion → `startRhAgentRun(marketDate, 'nightly')`.
- POST B/C SDS completion → `startRhAgentRun(marketDate, 'nightly')` scoped to `includeSymbols`.
- RH Agent workers continue to read D/W/M from `symbol-data` and fetch the intraday snapshot from SA via `callPartnerIntradaySnapshotV2` as an in-memory partial bar. This behavior is unchanged.

### Fallback timer

- A single scheduled function at 3 PM PT (cron, America/Los_Angeles) checks whether a POST A sync has already been triggered for today's market date.
- **Race condition prevention:** the fallback timer queries `symbol-data-sync-sequences` for any doc where `marketDate == today` and `sequence == 'A'` and `status` is `processing` or `completed`. If any such doc exists — whether in-progress or done — the fallback skips. This prevents a concurrent PDR-triggered SDS run and fallback run from both writing to the same `symbol-data` docs simultaneously.
- If no sync exists or is in progress, the fallback creates 3 interval sync runs (DAILY, WEEKLY, MONTHLY) plus a parent sequence doc — same structure as a PDR-triggered POST A. The task worker is the same per-interval code path. No `excludeSymbols` filtering since there's no PDR message to read.
- If the fallback sync fails (SA/AV down), an alert is logged. No retry loop — POST B/C are SA's own retries and will trigger normally if SA recovers.
- If all three POST runs and the fallback fail, the day is lost. This has never happened in months of stable operation.

### Open pass replacement

- `optionsOpenPass` (single cron at 6:45 AM) is replaced with a periodic scheduled function running every 5 minutes during market hours (6:30 AM–1 PM PT).
- Each tick queries active strategy instances where `openTimePT` matches the current 5-minute slot. `openTimePT` is a `HH:MM` 24-hour string (e.g., `"09:30"`, `"12:00"`). The tick computes the current slot by truncating to 5-minute boundaries (e.g., 09:32 → "09:30") and queries `where('openTimePT', '==', '09:30')`.
- Runs the open pass for matching instances only.
- No contract change — `openTimePT` remains a single string field on `StrategyInstanceConfig` (regex `/^([01]\d|2[0-3]):[0-5]\d$/`). Multiple instances of the same strategy with different open times are separate instance docs.
- The 5-minute granularity is sufficient for research purposes (checking fills and premium through the day).
- The open pass reads from `symbol-data` for underlying price data. It does NOT depend on SDS completion — it runs on its own schedule and reads data from the previous day's SDS run.

### Chart migration

- Option chart (`options-contract-viewer.store.ts`) and spread chart (`spread-viewer.store.ts`) are migrated to read underlying bars from the local bar store (`symbol-data/{SYMBOL}`) instead of calling `getPairDailyBars` → `callPartnerTimeSeries` → SA.
- `getPairDailyBars` callable is NOT removed — it still serves the heatmap chart, RS chart, and dashboard. A separate future topic will capture migrating those.
- `RsBarsService` remains for the out-of-scope consumers. The option/spread chart stores will read directly from Firestore or via a new lightweight bar-read service.
- **Firestore rules:** the FE already has authenticated read access to `symbol-data/{symbolId}`, `daily/{year}`, `weekly/{docId}`, `monthly/{docId}` (firestore.rules lines 60-82). No rules changes needed.
- **FE read pattern:** follows the existing pattern in `rel-str-db-v2.service.ts` — `collection()`, `query()`, `getDocs()` with Angular zone wrapper.

### Mark pass (unchanged)

- `optionsMarkPass` runs every 30 minutes during market hours, fetching live option quotes from RH (Robinhood) via a `BatchQuoteProvider`.
- It does NOT read from `symbol-data` — it marks open positions based on live option contract prices, not underlying bar data.
- Completely independent of the data sync pipeline.

### Logging and monitoring

- Every function in the pipeline must have extensive lifecycle logging: start, per-symbol progress, completion, errors. Use structured logging with consistent fields (`runId`, `marketDate`, `symbol`, `phase`, `runType`).
- A process monitoring guide doc (`docs/topics/159-data-pipeline/MONITORING.md`) is written with Logs Explorer queries that work for tracking each function's progress during and after completion. Queries cover: SDS run lifecycle, per-symbol sync progress, completion callback firing, downstream consumer triggering (selection, settlement, RH Agent), open pass ticks, fallback timer.

### Dead code cleanup

- `processSymbolsReady` and `processSymbolsReadyHttpTest` deleted from `partner-webhooks.ts`.
- `PARTNER_SYMBOLS_READY_TOPIC` removed from `webhooks-config.ts`.
- Commented-out export removed from `index.ts`.
- `USE_SYMBOL_DRIVEN_PIPELINE` flag removed from `webhooks-config.ts`.
- `rhAgentPdrTrigger` deleted entirely from `rh-agent-trigger.ts` (SDS completion replaces it). The 7:55 AM gate is removed along with it.
- `backfillSymbolDataForTradesDaily` scheduled function disabled (removed from `index.ts` exports). The `backfillSymbolDataForTrades` function and `backfillSymbolDataFromTradesAdmin` HTTP endpoint remain — the code may be reused later. The scheduled daily run is not needed since SDS covers `currentPrice` for tracked symbols.

### What stays unchanged

- `processDataReadyRunV2` — RS processing, still PDR-driven, still fetches from SA, still writes to `pairs-data`. Only change is removing the `currentPrice` side-effect write.
- `optionsMarkPass` — every 30 min, uses live RH quotes, does not read from `symbol-data`.
- `rhAgentOverviewSyncWeekly` — weekly company overview, unrelated to PDR.
- `autoDiagnoseAndFixDaily` — safety net.
- `cleanupRsBackfillRuns` — maintenance.
- `processSymbolAdded` — new symbol onboarding subscriber.
- Heatmap, RS chart, dashboard — untouched (separate future topic for their `getPairDailyBars` migration).

## Testing Decisions

- **Data sync triggering**: test that SDS correctly parses PDR message attributes (`runType`, `phase`, `includeSymbols`, `excludeSymbols`) and enqueues the right symbol set. Verify POST A syncs all minus `excludeSymbols`, POST B/C sync only `includeSymbols`, intraday syncs all tracked symbols.
- **Intraday field writes**: test that SDS writes intraday fields (`ip`, `ipc`, `io`, `it`, `ic`) to the latest bar in `symbol-data` on intraday runs, and that POST runs preserve (not clear) those fields.
- **Completion callbacks**: test that downstream consumers (selection, settlement, RH Agent) trigger after POST A completion, scoped retries trigger after POST B/C completion, and RH Agent intraday triggers after intraday completion. Verify the completion check uses a transaction to prevent double-firing.
- **Completion flexibility**: test that completion fires when all tasks have reported (success or failure), not just when all succeed. Verify downstream consumers receive the failed symbols list.
- **Watchdog**: test that the watchdog forces completion for stale runs (startedAt > 15 min ago, status processing). Verify it sets `forced_complete` status and fires the completion callback. Verify it retries enqueue for `completed_but_not_dispatched` runs.
- **Completion enqueue safety**: test that if Cloud Task enqueue fails, the run doc stays in `completed_but_not_dispatched` status and the watchdog retries on its next tick.
- **Intraday doc separation**: test that intraday runs write only the intraday doc (not year shards), and POST runs write year shards with `set({ merge: true })` and preserve the intraday doc. Verify no intraday fields appear on EOD year shard bars.
- **RS pipeline isolation**: verify that PDRv2 continues to fetch from SA and write to `pairs-data` independently of SDS. Verify that removing the `currentPrice` side-effect from PDRv2 does not affect RS pair computation.
- **Fallback timer**: test that the fallback fires only when no POST A has been received, and that it triggers a full sync.
- **Open pass**: test that the periodic timer correctly queries instances by `openTimePT` and only runs the open pass for matching instances. Verify instances with non-matching open times are not triggered.
- **Chart migration**: test that the option chart and spread chart stores return bars from the local bar store with correct data shape and sub-100ms read time.
- **Dead code removal**: verify no references to `processSymbolsReady`, `PARTNER_SYMBOLS_READY_TOPIC`, `USE_SYMBOL_DRIVEN_PIPELINE`, or `rhAgentPdrTrigger` remain after cleanup.
- Prior art: existing test patterns in `tests/functions/options-strategy-engine/` for pass orchestration and `tests/functions/` for scheduled function behavior.

## Out of Scope

- Migrating RS pipeline (`processDataReadyRunV2`) to read from the local bar store — separate future topic. SDS includes an extension point for this.
- Migrating heatmap chart, RS chart, or dashboard away from `getPairDailyBars` — separate future topic.
- Removing `getPairDailyBars` callable — still has active consumers.
- SA-side cleanup of `partner-symbols-ready` Pub/Sub publishing — SA team handling separately.
- Mark pass changes — stays on 30-min cron, uses live RH quotes, independent of data sync.
- `backfillSymbolDataForTradesDaily` — unrelated, serves unimplemented trade journal.
- Heatmap data pipeline, dashboard data access.
- `callPartnerIntradaySnapshotV2` — RH Agent workers continue to fetch intraday snapshots from SA directly.

## Technical Context

- **Parallel architecture**: SDS and PDRv2 both subscribe to `partner-data-ready` and both fetch from SA. This is an accepted tradeoff — the duplicate SA calls remain until RS migrates to read from the local bar store in a future topic. The benefit is that RS is completely isolated from any changes.
- **Data freshness**: PDR-triggered sync means data is fresher — sync runs at ~1:35 PM PT (POST A) instead of 6 PM. Straggler symbols are synced at ~6 PM (POST B) and ~4 AM (POST C) instead of waiting until the next day. Intraday runs sync at ~8 AM, ~10 AM, ~12 PM PT.
- **Intraday doc separation**: intraday fields (`ip`, `ipc`, `io`, `it`, `ic`) live in a separate doc (`symbol-data/{SYMBOL}/intraday/latest`), not on EOD year shard bars. This eliminates bloat on historical bars, halves the write volume on intraday runs (one small doc vs full year shard), and keeps EOD and intraday data as separate concerns. POST runs preserve the intraday doc (same as SA's behavior). Future RS migration reads year shard + intraday doc and merges in memory.
- **Single currentPrice writer**: SDS is the only function that writes `currentPrice` to `symbol-data`. PDRv2's side-effect write is removed. `syncTrackedSymbolsDaily` is deleted. Down from 3 writers to 1.
- **Completion mechanism**: per-interval completion fires when all tasks for that interval report (success or failure) OR when the watchdog forces it after 15 minutes. POST sequence completion fires when all 3 interval runs complete (fan-in via sequence doc). A run with 862/863 successful syncs still completes. Failed symbols are merged across intervals and passed to consumers. The watchdog also retries enqueue for runs/sequences where the completion callback failed to dispatch downstream tasks.
- **Fallback timer race prevention**: the fallback timer checks for any in-progress or completed POST A sequence for today's market date. This prevents concurrent PDR-triggered and fallback syncs from writing to the same docs simultaneously.
- **Fallback coverage**: if SA's Pub/Sub publish fails but data is ready, the 3 PM PT fallback catches it. If SA/AV is fully down, the fallback fails and the day is lost — this has never happened.
- **Open pass granularity**: 5-minute slots mean a strategy configured for "09:30" opens within the 09:30–09:35 tick. This is acceptable for research; production may need finer granularity.
- **Open pass independence**: the open pass reads from `symbol-data` which was populated by the previous day's SDS run. It does not depend on SDS completion — it runs on its own schedule during market hours.
- **Mark pass independence**: the mark pass fetches live option quotes from RH and does not read from `symbol-data`. It is completely independent of the data sync pipeline.
- **Chart read time**: local Firestore reads are sub-50ms vs 5-10 seconds for SA HTTP round trips. The migration eliminates the latency for option and spread charts only; heatmap, RS chart, and dashboard still have the SA round trip until a future topic.
- **Logging**: every function logs its lifecycle with structured fields (`runId`, `marketDate`, `symbol`, `phase`, `runType`). The monitoring guide doc provides working Logs Explorer queries for tracking each function's progress.

## System Context

```
                        SA (av-proxy-api)
                   AV → SA Firestore → PDR Publisher
                              |
                              v
                    partner-data-ready (Pub/Sub)
                     /         \
              ALL 12 PDRs    ALL 12 PDRs
                (3 intraday     (3 intraday
                 9 POST)        9 POST)
                    |                |
                    v                v
              symbolDataSync   processDataReadyRunV2
              (NEW subscriber)  (unchanged RS pipeline)
                    |                |
                    | fetches D/W/M  | fetches D/W/M
                    | + intraday      | per pair from SA
                    | all symbols     | (duplicate fetch
                    | from SA          | accepted for now)
                    v                |
                SA HTTP              v
                    |            pairs-data
                    v            (RS computations)
              symbol-data
              (local bar store)
              WRITES (POST DAILY msg):
                daily/{YYYY} year shard (EOD, merge:true)
                currentPrice on root doc
              WRITES (POST WEEKLY msg):
                weekly/all doc (merge:true)
              WRITES (POST MONTHLY msg):
                monthly/all doc (merge:true)
              WRITES (intraday PRE msg):
                bulk callPartnerIntradaySnapshotV2(allSymbols)
                → intraday/latest (ip/ipc/io/it/ic only)
                → currentPrice on root doc
                    |
                    |
              SDS completion callback
              (when all tasks report:
               success or failure)
                    |
          +---------+---------+---------+
          |         |         |         |
          v         v         v         v
       [RS ext    Selection  Settlement  RH Agent
        point]
     (not wired,  Pass       Pass       (intraday +
      future       (POST A   (POST A    nightly)
      topic)       only)     full,        |
                                       B/C scoped)
                                       |
                                       v
                                  RH Agent Workers
                                  /              \
                            reads D/W/M      fetches intraday
                            from symbol-data  snapshot from SA
                                              (in-memory only)

     3 PM PT Fallback Timer → SDS (if no POST A or in-progress sync)

     Watchdog (every 5 min)
       → checks for stale symbol-data-sync-runs (processing > 15 min)
       → forces per-interval completion
       → checks for stale symbol-data-sync-sequences (processing > 20 min)
       → forces sequence completion
       → retries enqueue for completed_but_not_dispatched runs/sequences

     Open Pass Timer (every 5 min during market hours)
       → queries instances by openTimePT
       → READS symbol-data for underlying price
       → places RH orders for matching strategies

     Mark Pass (every 30 min, unchanged)
       → fetches live option quotes from RH
       → writes P&L to position docs
       (does NOT read symbol-data)

     Option Chart → READS symbol-data (sub-100ms)
     Spread Chart → READS symbol-data (sub-100ms)
```

**Writers to symbol-data:** SDS only (DAILY shard + currentPrice on DAILY messages, WEEKLY shard on WEEKLY messages, MONTHLY shard on MONTHLY messages, intraday doc + currentPrice on intraday PRE messages)
**Readers of symbol-data:** Selection, Settlement, RH Agent (nightly + intraday workers), Open Pass, Option Chart, Spread Chart
**Independent of symbol-data:** PDRv2 (fetches from SA, writes to pairs-data), Mark Pass (RH live quotes)
**Removed:** rhAgentPdrTrigger, symbolDataSyncNightly, syncTrackedSymbolsDaily, backfillSymbolDataForTradesDaily (scheduled)
**New infrastructure:** Watchdog scheduled function (every 5 min), intraday doc (`symbol-data/{SYMBOL}/intraday/latest`), sequence docs (`symbol-data-sync-sequences/{sequenceRunId}`)
