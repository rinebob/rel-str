# Partner Webhooks Pipeline (Consumer)

This document explains the end-to-end data flow and implementation details for our SavantAPI integration as a consumer. We subscribe to a Pub/Sub topic for data-ready events, fetch partner time-series data, compute Relative Strength (RS), and persist results for the application to consume.

## High-level Overview

- We are the consumer of SavantAPI.
- We subscribe to Pub/Sub topic `partner-data-ready` for data-ready notifications.
- For each event, we:
  1. Record the event in Firestore (status/metrics/error samples) for observability and idempotency.
  2. Load our baseline–target pairs from Firestore registry.
  3. Fetch time-series bars from the partner for each pair (DAILY, last 30 calendar days by default).
  4. Build phase-aware series and compute RS per aligned trading day.
  5. Write unified pair data to Firestore and mark the event as completed (or completed with errors).

## Components and Files

- `functions/src/webhooks/partner-webhooks.ts`
  - V2 Pub/Sub subscriber orchestrator: reads events, controls flow, processes pairs.
  - Helper: `forEachWithConcurrency()` throttles IO.
  - Helper: `processPairLive()` fetches bars and writes unified series for a single pair.
- `functions/src/webhooks/rs-series.ts`
  - Series computation utilities: rank window, minimal RS, and phase-aware series builder.
- `functions/src/webhooks/pairs-writer.ts`
  - Firestore writer for the unified `pairs-data/{BASELINE}-{TARGET}` schema (phase-aware upserts).
- `functions/src/webhooks/registry-actions.ts`
  - Callable HTTPS functions to manage the `pair-registry` and a one-off seeding helper.
- `functions/src/webhooks/webhooks-config.ts`
  - Centralized constants, enums, and shared types (topics, collections, fixed windows, types).

## Pub/Sub Event Flow

1. Event arrives on `PARTNER_DATA_READY_TOPIC`.
2. The subscriber derives a stable event document ID:
   - Using message ID, runId (if provided), run type, and publish time segment (for heartbeat runs).
3. The subscriber writes/merges an event doc in `EVENTS_COLLECTION`:
   - status: `processing`
   - run metadata and publish time
4. Idempotency check: if an event doc is already in a terminal state (`completed`, `completed_with_errors`, `failed`), the handler returns early.
5. The handler loads pairs from `REGISTRY_COLLECTION`.
6. For each pair, it fetches partner bars, computes series, and calls the unified writer.
7. The handler writes final status counters and sampled error details to the same event doc.

## Firestore Collections and Schemas

- `partner-events/{eventDocId}` (observability and idempotency)
  - Example fields:
    - `status`: `processing | completed | completed_with_errors | failed | heartbeat`
    - `runType`, `runId`, `messageId`, `publishTime`, `ptPublishTime`
    - `pairsProcessed`, `pairsFailed`, `intervalUsed`, `window`
    - `errorSamples`: Array<{ pair, message, status?, code? }>

- `pair-registry/{BASELINE}-{TARGET}` (inputs)
  - Example fields:
    - `baseline`, `target`, `members`, `refCount`, `createdAt`, `updatedAt`, `pendingDeleteAt?`

- `pairs-data/{BASELINE}-{TARGET}` (outputs)
  - Shape written by `writeUnifiedSeries()`:
    ```json
    {
      "meta": { "baseline": "SPY", "symbol": "AAPL", "interval": "DAILY", "window": 30 },
      "lastUpdatedAt": <Timestamp>,
      "latest": { "day": "YYYY-MM-DD", "pre"?: { ... }, "post"?: { ... } },
      "data": [
        { "day": "YYYY-MM-DD", "dow": "Mon", "pre"?: { ... }, "post"?: { ... } },
        ...
      ]
    }
    ```
  - `pre` entry (intraday): uses intraday price (`ip`) and intraday percent (`ipc`) when available, and computes change/percentChange versus the prior day post-close (adjusted close preferred, fallback to close).
  - `post` entry (end-of-day): uses adjusted close (`ac`) when available (fallback to `c`) and computes change/percentChange versus the prior day post-close.
  - Retention: limited to `meta.window` elements (default 30) from the tail.

## RS Calculations

### Definitions

- RS for a given aligned day: `RS = targetClose / baseClose`.
- Aligned day means both baseline and target have valid bars for that `YYYY-MM-DD` and we exclude weekends.
- Two modes (phases):
  - `pre` (intraday): uses `ip` (intraday price) and `ipc` (intraday percent change) when available.
  - `post` (EOD): uses `ac` (adjusted close) and `cp` (percent change EOD). Falls back to `c` if `ac` missing.

### Minimal RS Series (diagnostic)

When only time and one close are needed, `computeRsSeries(baseSeries, targetSeries)` accepts minimal arrays of `{ t, c }` and returns an aligned RS sequence `{ t, rs, baseClose, targetClose }` sorted by time.

### Phase-aware Series

`buildPhaseSeries(baselineBars, targetBars, phase)` produces an array of `PhaseSeriesPoint`:

- Inputs are `PartnerBar[]` from the partner, including fields `d (day)`, `t (ms)`, `ac`, `c`, `pc`, `cp`, `ip`, `ipc`, `it`.
- For each aligned trading day:
  - Select per-phase close values (intraday or EOD).
  - Compute per-phase percent changes (`baseCp`, `targetCp`).
  - Compute a 5-day rolling window rank of subject (target) vs baseline percent changes.
  - Output fields include `{ day, dow, t, rank, baseCp, targetCp, baseClose, targetClose, it? }`.

### Rank Calculation (5-day window)

- Consider a 5-length window for subject (target) changes and baseline changes.
- Evaluate all 32 binary combination masks (00000..11111) that choose subject vs baseline on each day.
- Sort the summed outcomes; find the index for `11111` (all subject changes).
- Rank = `(index + 1) / outcomes.length` in (0, 1]. Higher means stronger recent outperformance by target.

## Idempotency and Error Handling

- Each event writes to a deterministic doc ID; terminal events are skipped.
- Pair writes are idempotent at the day/phase level; we upsert the per-day entry and trim retention.
- We record up to 10 sampled errors per event to help diagnose systemic issues.

## Configuration

- All constants/enums and shared types live in `webhooks-config.ts`.
- Fixed parameters (subject to future expansion):
  - `FIXED_INTERVAL = DAILY`
  - `FIXED_LIMIT = 30` (partner fetch limit)
  - `FIXED_DAYS = 30` (days requested)

## Deployment & Identity

- We use Cloud Functions v2.
- The default region is `us-central1`.
- Runtime service account should be `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com` (configurable via init and env override).

## Operations Notes

- Concurrency controls are configurable via environment variables:
  - `PARTNER_PAIR_CONCURRENCY` (default 3) limits concurrent pair processing.
- If an event repeats, the idempotency check prevents duplicate writes.
- If a partner field is missing (e.g., `ac`), the writer falls back to a sensible default (`c`).

## Future Enhancements

- Expand intervals (INTRADAY variants, WEEKLY, MONTHLY).
- Expand window sizes and retention policies.
- Additional diagnostics: store more granular RS metadata if needed.
