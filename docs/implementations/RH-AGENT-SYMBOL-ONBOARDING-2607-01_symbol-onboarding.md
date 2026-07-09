# RH-AGENT-SYMBOL-ONBOARDING-2607-01 — Automated Symbol Onboarding and RH Agent Run Triggers

- **Status**: implemented / deployed
- **Area**: BE
- **Scope**: FEAT + REFACTOR
- **Code**: RH-AGENT
- **Created**: 2026-07-08
- **Related**: `RH-AGENT-TIMEZONE-2607-01`, `RH-AGENT-SIGNAL-LIFECYCLE-2607-01`, `RS-BARS-STORAGE-2607-01`

## Overview

This document describes how new symbols are onboarded into the RH Agent and how the agent is triggered for different run types. There are four ways an RH Agent run can start:

| Trigger | Source | Data available | Run type | Writes signal-history? |
|---|---|---|---|---|
| `nightly` | Cloud Scheduler at 6:00 PM PT Mon–Fri | Full EOD D/W/M bars | `daily-scan` | Yes |
| `pdr` | `partner-data-ready` Pub/Sub with `runType=intraday-snapshot` | Intraday snapshot + cached bars | `daily-scan` | No |
| `manual` | HTTP callable `rhAgentManualRun` | Intraday snapshot + cached bars | `daily-scan` | No |
| `symbol-added` | `partner-symbol-added` Pub/Sub | Full D/W/M historical bars | `symbol-added` | No |

All triggers create a run document in `rh-agent-runs/{runId}`, enqueue one `rhAgentProcessSymbol` Cloud Task per symbol, and rely on the worker to load bars, execute the configured strategy, and persist signals.

## Symbol onboarding flow (`symbol-added`)

When SavantAPI (SA) finishes fetching a new symbol's full D/W/M history, it publishes a `partner-symbol-added` message. The RS consumer `processSymbolAdded` performs three steps for each symbol in the payload:

1. **Backfill bars** — calls `syncSymbolToSymbolData(symbol, true)` to fetch full D/W/M history from SA and write it into `symbol-data/{symbol}` (daily year-shards, weekly/monthly flat docs).
2. **Enable the symbol** — upserts `{ symbol, enabled: true }` into `rh-agent-symbols/{symbol}` so the symbol is eligible for future agent runs.
3. **Trigger a single-symbol agent run** — creates a one-symbol run in `rh-agent-runs` and enqueues the worker task. This makes the symbol immediately reviewable without waiting for the next nightly or PDR run.

### Run ID for `symbol-added`

To avoid collisions while preserving readability, the run ID is the normal PT run ID with the symbol appended:

```text
YYYY-MM-DD_dow_HHMMSS_symbol-added_SYMBOL
```

Example: `2026-07-08_tue_143022_symbol-added_CIEN`

The `runDate` field in the run document matches the date portion of the run ID; the consumer passes it explicitly to `createDailyRun` so a midnight boundary cannot drift the run ID and run doc apart.

### Signal persistence for `symbol-added`

- The worker loads cached bars from `symbol-data/{symbol}`.
- No intraday snapshot is passed, so the run operates on the latest historical bar.
- Fired signals are written to `rh-agent-symbols/{symbol}/run-ids/{runId}`.
- Signals are **not** written to `signal-history/{barDate}` because `symbol-added` is not a nightly EOD run.
- The symbol doc's gate dates (`lastDailySignalDate`, etc.) are still updated.

## Shared orchestration modules

The trigger logic has been extracted from `rh-agent-cloud-function/` into focused `common/` modules so both `symbol-data-sync` and the RH Agent triggers can use it without creating a cross-module dependency.

### `functions/src/common/pt-date-utils.ts`

PT date/run-ID utilities.

- `getMarketDatePT()` — PT trading date.
- `getRunDatePT()` — PT calendar date on which the run occurs.
- `getRunIdPT(runDate, trigger)` — `YYYY-MM-DD_dow_HHMMSS_trigger`.
- `normalizeMarketDate(dateStr)` — convert partner date strings to PT calendar date.
- `formatTimestampPT(ts)` — UTC timestamp → PT display string.

### `functions/src/common/rh-agent-collections.ts`

Firestore collection constants and the `RhAgentSymbol` document shape.

### `functions/src/common/rh-agent-runs.ts`

Run/job/status enums and interfaces.

- `RhAgentRunStatus`, `RhAgentJobStatus`
- `RhAgentTriggeredBy` = `'manual' | 'pdr' | 'nightly' | 'symbol-added'`
- `RhAgentDailyRun` with `type: 'daily-scan' | 'symbol-added'`

### `functions/src/common/rh-agent-shared-types.ts`

Cross-cutting types: `IntradaySnapshot`, `SymbolJobPayload`.

### `functions/src/common/rh-agent-run-creation.ts`

Run document creation helpers.

- `getMarketDate()`
- `getDeadlineISO(minutesFromNow = 30)`
- `createDailyRun(marketDate, totalSymbols, deadlineAt, triggeredBy, runId?, runDate?, type?)`

### `functions/src/common/rh-agent-job-enqueueing.ts`

Cloud Task enqueueing.

- `createJobAndEnqueue(runId, symbol, marketDate, runStartedAt, triggeredBy, intraday?)`
- `enqueueSymbolJobs(runId, symbols, marketDate, runStartedAt, intradayBySymbol, triggeredBy)`

### `functions/src/common/rh-agent-symbol-source.ts`

Symbol loading and intraday snapshot fetching.

- `loadEnabledSymbols(requestedSymbols?)`
- `fetchIntradaySnapshots(symbols, marketDate)`

### `functions/src/common/rh-agent-orchestration.ts`

High-level `startRhAgentRun(marketDate, triggeredBy, intradaySnapshots)` used by:

- `symbolDataSyncNightly` after all symbols finish syncing (`'nightly'`).
- `rhAgentPdrTrigger` when a PDR snapshot completes (`'pdr'`).
- `rhAgentTriggerDaily` manual HTTP trigger (`'manual'`).

## Nightly run flow (`nightly`)

1. Cloud Scheduler invokes `symbolDataSyncNightly`.
2. `symbolDataSyncNightly` loads tracked symbols, creates a `symbol-data-sync-runs/{syncRunId}` doc, and enqueues one `symbolDataSyncSymbol` task per symbol.
3. Each task calls `syncSymbolToSymbolData(symbol, true)` to backfill/merge bars.
4. `checkSyncRunCompletion` increments `processedCount`. When all symbols complete, it calls `startRhAgentRun(marketDate, 'nightly')`.
5. `startRhAgentRun` loads enabled symbols, fetches an intraday snapshot, creates a `daily-scan` run, and enqueues worker tasks.
6. Workers persist signals. Because `triggeredBy === 'nightly'`, confirmed (`barStatus = 1`) signals are also written to `signal-history/{barDate}`.

## PDR run flow (`pdr`)

1. SA publishes `partner-data-ready` with `runType=intraday-snapshot` and `status=end`.
2. `rhAgentPdrTrigger` validates the message and time-gates it to the intraday window.
3. It normalizes `payload.marketDate`, loads enabled symbols, fetches an intraday snapshot, and calls `startRhAgentRun(marketDate, 'pdr', intradaySnapshots)`.
4. The worker receives the intraday snapshot in its payload and injects it as the latest bar before running the strategy.
5. Signals are written only to `run-ids/{runId}` because the run is not a nightly EOD run.

## Manual run flow (`manual`)

Same as the PDR flow, but triggered via the `rhAgentManualRun` HTTP callable. The caller can optionally override `marketDate` and provide a specific symbol list.

## Signal persistence summary

| Storage path | Nightly | PDR / Manual / Symbol-added |
|---|---|---|
| `rh-agent-runs/{runId}` | Run metadata | Run metadata |
| `rh-agent-runs/{runId}/jobs/{symbol}` | Job status | Job status |
| `rh-agent-symbols/{symbol}/run-ids/{runId}` | Yes (all fired signals) | Yes (all fired signals) |
| `rh-agent-symbols/{symbol}/signal-history/{barDate}` | Only `barStatus = 1` signals | No |
| `rh-agent-symbols/{symbol}` gate dates | Updated | Updated |

## Files involved

### Onboarding
- `functions/src/symbol-data-sync/symbol-data-symbol-added.ts` — Pub/Sub consumer.
- `functions/src/symbol-data-sync/symbol-data-backfill.ts` — `syncSymbolToSymbolData` backfill logic.
- `functions/src/webhooks/webhooks-config.ts` — `PARTNER_SYMBOL_ADDED_TOPIC` constant.
- `functions/src/index.ts` — exports `processSymbolAdded`.

### Orchestration
- `functions/src/common/rh-agent-orchestration.ts`
- `functions/src/common/rh-agent-run-creation.ts`
- `functions/src/common/rh-agent-job-enqueueing.ts`
- `functions/src/common/rh-agent-symbol-source.ts`
- `functions/src/common/pt-date-utils.ts`
- `functions/src/common/rh-agent-runs.ts`
- `functions/src/common/rh-agent-collections.ts`
- `functions/src/common/rh-agent-shared-types.ts`

### Triggers
- `functions/src/symbol-data-sync/symbol-data-sync.ts` — nightly sync, calls `startRhAgentRun`.
- `functions/src/rh-agent-cloud-function/rh-agent-trigger.ts` — PDR and manual triggers.
- `functions/src/rh-agent-cloud-function/rh-agent-callables.ts` — manual callable.

### Worker
- `functions/src/rh-agent-cloud-function/rh-agent-worker.ts` — executes strategy and persists signals.
- `functions/src/rh-agent-cloud-function/rh-agent-signal-persister.ts` — builds signal entries.
- `functions/src/rh-agent-cloud-function/rh-agent-signal-date-writer.ts` — writes `run-ids` / `signal-history` / gate dates.

## Operations

### Deploy

```bash
firebase deploy --only functions --project rel-str
```

### Trigger a test symbol-added event manually

```bash
gcloud pubsub topics publish projects/<sa-project>/topics/partner-symbol-added \
  --message '{"version":"v1","symbols":["CIEN"],"addedAtUTC":"2026-07-08T21:00:00Z","status":"ready","availableIntervals":["DAILY","WEEKLY","MONTHLY"]}' \
  --project <sa-project>
```

### Verify

Check logs for:
- `symbol_data_symbol_added_received`
- `symbol_data_symbol_added_processed`
- `symbol_data_symbol_added_agent_run_enqueued`
- `rh_agent_run_created` with `triggeredBy: 'symbol-added'`

Check Firestore for:
- `symbol-data/{symbol}` with daily/year and weekly/monthly/all docs.
- `rh-agent-symbols/{symbol}` with `enabled: true`.
- `rh-agent-runs/{runId}` with `type: 'symbol-added'`.
- `rh-agent-symbols/{symbol}/run-ids/{runId}` with signals.

## Open questions / next steps

1. Should `symbol-added` runs eventually write to `signal-history`? Currently no, matching PDR/manual behavior.
2. Should `rh-agent-opportunities` be reintroduced as a top-level collection, or is `run-ids` the permanent review surface?
3. Add TTL or cleanup policy for old `run-ids` docs (see `RH-AGENT-RUNIDS-2607-01`).
