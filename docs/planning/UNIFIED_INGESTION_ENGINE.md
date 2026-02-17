# Unified RS Ingestion Engine

Last updated: 2026-01-16

---

## 1. Purpose

This document defines the **unified RS ingestion engine** that is responsible for:

- Ingesting Savant time-series data (DAILY / WEEKLY / MONTHLY) for the RS universe.
- Computing RS for all registered pairs.
- Writing canonical RS archives and latest mirrors.
- Updating per-pair ingestion state.

It is intentionally **run-driven**, not symbol-driven:

- Live ingestion is triggered by a **universe-ready `partner-data-ready` v1 message** from Savant (see below for exact contract).
- Backfill/repair reuses the same core engine over explicit date windows.

For partner contract details, see:

- `docs/partner/rs-partner-integration.md` – RS contract with the universe-ready `partner-data-ready` message and time-series HTTPS.
- `docs/partner/sa-time-series-job-pipeline-plan.md` – Time-series job pipeline and readiness.

For archive semantics and backfill:

- `docs/planning/RS_ARCHIVE_BACKFILL.md` – Archive model and backfill entrypoints (`recomputeRsBackfillAdmin` as primary, `recomputeRegisteredBackfill` as legacy).

---

## 2. High-Level Responsibilities

The unified ingestion engine is responsible for **one logical run context**:

- Inputs:
  - `marketDate: string` – `YYYY-MM-DD` (ET trading day).
  - `runId: string` – unique id for this ingestion run (linked to `partner-data-ready` / runs docs).
  - `intervals: Interval[]` – subset of `['DAILY', 'WEEKLY', 'MONTHLY']`.
  - `universeVersion?: string` – optional versioning for symbol universe.
  - `mode: 'LIVE' | 'BACKFILL'` – live ingestion vs explicit repair.
  - `window?: { from: string; to: string }` – optional override for backfill windows.
  - `pairsFilter?: string[]` – optional subset of `pair-registry` to process.

- Responsibilities per run:
  - Enumerate **registered pairs** from `pair-registry/*` (optionally filtered).
  - For each pair and requested interval(s):
    - Fetch normalized Savant time-series bars over the required lookback/window.
    - Build phase-aware RS series (PRE/POST) for each interval.
    - Write RS archives and latest mirrors via `writeUnifiedSeries`.
    - Optionally run the canonical RS engine and downstream signals/positions, depending on flags (currently gated).
  - Update per-pair ingestion state in `pair-registry`:
    - `ingestionStatus`, `lastIngestionAt`, `lastIngestionError`, per-interval readiness flags.
  - Emit summary logs/metrics and, for LIVE mode, link back to the `partner-data-ready` universe-ready run context.

The engine is **idempotent** for a given `{marketDate, intervals, window, pairsFilter}` when Savant data is stable.

---

## 3. Entry Points

### 3.1 Live Ingestion – Universe-Ready `partner-data-ready` Subscriber

Live ingestion is driven by a Pub/Sub subscriber for the **universe-ready `partner-data-ready` v1 message**.

- Trigger (Savant side): `partner-data-ready` message with:
- Attributes (minimum contract):

    ```text
    phase=post
    runType=ts-post-all-intervals    # or equivalent upstream enum
    runId=<opaque-run-id>            # used as Firestore doc id
    ```

- Payload (conceptual example):

    ```jsonc
    {
      "version": "v1",
      "runId": "2026-01-28-WED-POST-LIVE-A-1635", // opaque, not parsed
      "marketDate": "2026-01-28",
      "phase": "post",
      "intervals": ["DAILY", "WEEKLY", "MONTHLY"], // case-insensitive
      "trigger": "scheduled",                       // e.g. scheduled | manual | test
      "runType": "ts-post-all-intervals",           // optional; treated as opaque label
      "status": "end",                              // optional, used for observability
      "finalizedCountTotal": 1234,                   // optional
      "pendingCount": 0                              // optional
    }
    ```

- Subscriber responsibilities:
  - Validate payload (`marketDate`, `phase`, `intervals`).
  - Derive a **run context**:
    - `{ marketDate, runId, intervals, universeVersion, mode: 'LIVE' }`.
    - Optional repair flags based on `status` (e.g. `completed_with_errors`).
  - Call the unified engine:

    ```ts
    await runUnifiedIngestion({
      marketDate,
      runId,
      intervals,
      universeVersion,
      mode: 'LIVE',
    });
    ```

  - Record run-level status in `runs/{runId}` or similar operational docs.

> Internally, RS may still treat these all-intervals POST runs as `TS_UNIVERSE`-style runs in its own TypeScript types or operational docs, but on the wire the only distinguishing fields are: an opaque `runId`, a `phase` of `post`, a `runType` label such as `ts-post-all-intervals`, and `intervals` including `DAILY`, `WEEKLY`, `MONTHLY`.

### 3.2 Backfill / Repair – Admin HTTP

Backfill and repair are routed through admin HTTP entry points that **wrap** the same engine or delegate to the RS job pipeline:

- Primary entrypoint: `recomputeRsBackfillAdmin` in `rs/time-series/rs-backfill-admin.ts` (RS-native backfill over `rs-backfill-runs` + Cloud Tasks jobs).
- Legacy entrypoint: `recomputeRegisteredBackfill` in `webhooks/admin-tasks.ts` (kept for compatibility; semantics documented in `RS_ARCHIVE_BACKFILL.md`).

- Inputs (for the backfill window; see `RS_ARCHIVE_BACKFILL.md` for full details):
  - `from`, `to`: `YYYY-MM-DD` (required window).
  - `intervals`: subset of `['DAILY', 'WEEKLY', 'MONTHLY']`.
  - `phase`: `'pre' | 'post' | 'both'`.
  - `pair` / `pairs`: optional filters.
  - `concurrency`, `days`, `limit`: tuning hints.

Conceptually, a backfill request maps into a call to the unified engine or equivalent RS job helpers, for example:

```ts
await runUnifiedIngestion({
  marketDate: to,           // logical anchor; engine uses explicit window
  runId: `backfill-${from}-${to}-${Date.now()}`,
  intervals,
  universeVersion: undefined,
  mode: 'BACKFILL',
  window: { from, to },
  pairsFilter,
});
```

Backfill is **archives-only** today; signals/activity/positions remain separately controlled via `RS_BACKFILL_SIGNALS.md` and the canonical engine flags.

---

## 4. Engine Contract (Draft Type Shape)

This is a **planning-level** type, not necessarily the exact implementation signature.

```ts
export interface UnifiedIngestionParams {
  /** Trading day used as logical anchor for the run (ET, YYYY-MM-DD). */
  marketDate: string;

  /** Unique identifier for this ingestion run (linked to universe-ready partner-data-ready / runs docs). */
  runId: string;

  /** Intervals to process: DAILY, WEEKLY, MONTHLY. */
  intervals: Array<'DAILY' | 'WEEKLY' | 'MONTHLY'>;

  /** Optional symbol-universe version from Savant. */
  universeVersion?: string;

  /** LIVE (universe-ready partner-data-ready) vs BACKFILL/repair. */
  mode: 'LIVE' | 'BACKFILL';

  /** Optional explicit window for BACKFILL mode. Inclusive [from, to] in YYYY-MM-DD. */
  window?: { from: string; to: string };

  /** Optional subset of pair ids (BASELINE-TARGET) to process. Defaults to full pair-registry. */
  pairsFilter?: string[];

  /** Max number of pairs to process concurrently. */
  concurrency?: number;

  /** Optional: run in dry-run/validation mode (no writes). */
  dryRun?: boolean;
}

export interface UnifiedIngestionResult {
  ok: boolean;
  marketDate: string;
  runId: string;
  intervals: Array<'DAILY' | 'WEEKLY' | 'MONTHLY'>;
  mode: 'LIVE' | 'BACKFILL';
  totalPairs: number;
  processedPairs: number;
  errors: Array<{ pairId: string; interval?: string; error: string }>;
}

## 4.1 Canonical RS Engine

The canonical RS engine is responsible for:

- Loading archive-derived RS samples for a pair (DAILY, WEEKLY, MONTHLY) using `RsSample { day, rsNorm, rsRaw }`.
- Scanning for threshold crossings using the minimal RS engine (`detectRsEvents`).
- Mapping logical events into concrete `RsWriteEvent` structures that drive signals/positions/activity writes.

Implementation details:

- **File**: `functions/src/webhooks/rs-canonical-engine.ts`
- **Core entrypoint**: `runCanonicalRsEngineForPair(pairId, baseline, symbol, logger, series, thresholds)`
  - `series: IntervalSeriesContext` provides decorated phase series for `daily`, `weekly`, and `monthly` intervals.
  - Loads archive samples via `loadDailyRsSamplesFromArchive` / `loadIntervalRsSamplesFromArchive` in the same file.
  - Uses `detectRsEvents` from `rs-signals-engine.ts` to derive logical OPEN/CLOSE/HOLD events.
  - Produces `RsWriteEvent[]` consumed by `applyRsEventsForPair` in `rs-events-consumer.ts` to write canonical signals and root positions.
  - Derives multi-interval `ActivityEvent[]` via `generateActivityFromWrites`.

The canonical engine is therefore the **single source of truth** for:

- How RS threshold crossings translate into OPEN/CLOSE/HOLD events.
- How those events become persistent Firestore writes (signals, positions, activity).
- Keeping backfill and live processing aligned via the same underlying logic.

> **Current gating (2026)**
>
> All canonical engine work (archive RS loads, `detectRsEvents`, `RsWriteEvent` generation,
> `applyRsEventsForPair`, and `generateActivityFromWrites`) is **gated by** the
> `DISABLE_SIGNALS_ACTIVITY_POSITIONS` flag in `webhooks-config.ts`. When this flag is `true`,
> `runCanonicalRsEngineForPair` returns immediately with empty `writes` and `activity`, and no
> downstream signals/positions/activity writes are executed. This allows the ingestion engine to
> keep archives and latest mirrors up to date while deferring canonical signals/positions work
> without further code changes.

---

## 5. Per-Pair Processing (Conceptual)

For each pair `pairId = {BASELINE}-{TARGET}` in scope:

1. **Resolve pair metadata** from `pair-registry/{pairId}`:
   - `baseline`, `target`, `source`, readiness flags, ingestion status.

2. **Determine effective window**:
   - LIVE mode:
     - Use a fixed lookback (e.g., N days/weeks/months) anchored on `marketDate`.
   - BACKFILL mode:
     - Use the explicit `[from, to]` window passed in `params.window`.

3. **Fetch Savant time series** for each interval:
   - DAILY: daily bars up to `marketDate`.
   - WEEKLY / MONTHLY: corresponding interval bars.
   - All via Savant HTTPS, not Alpha Vantage.

4. **Build RS series per interval and phase**:
   - Use existing helpers (e.g. `buildPhaseSeries`, `computeRsSeries`).
   - Phases:
     - LIVE: typically `phase = 'post'` only for canonical writes.
     - BACKFILL: `phase = 'pre' | 'post' | 'both'` as requested.

5. **Write archives and latest mirrors**:
   - Call `writeUnifiedSeries` for each interval to:
   - Upsert DAILY archives in `pairs-data/{PAIR}/archive-YYYY/{YYMMDD}`.
   - For WEEKLY and MONTHLY, delete any **stale in-progress bars** within the same logical week/month and write exactly one archive doc per period (the latest/in-progress bar) under `archive-weekly-YYYY/{YYMMDD}` and `archive-monthly-YYYY/{YYMMDD}`.
   - Update `latestDaily` / `latestWeekly` / `latestMonthly` on `pairs-data/{PAIR}`.

6. **Update ingestion state** on `pair-registry/{pairId}`:
   - On success:
     - `ingestionStatus = 'SUCCESS'`.
     - `lastIngestionAt = serverTimestamp()`.
     - Per-interval readiness flags to `true` for processed intervals.
     - `lastIngestionError = null`.
   - On error:
     - `ingestionStatus = 'ERROR'`.
     - `lastIngestionError` with truncated message.

7. **Optional canonical engine & signals** (controlled via env/flags):
   - If signals/activity/positions are enabled (`DISABLE_SIGNALS_ACTIVITY_POSITIONS === false`):
     - Run `runCanonicalRsEngineForPair` on the updated archives.
     - Apply writes via `applyRsEventsForPair` and `generateActivityFromWrites`.
   - When disabled, the engine stops at archives/latest writes.

---

## 6. Relationship to Existing Code

The unified ingestion engine is primarily a **refactor and consolidation** of existing pieces:

- **Time-series fetch**: `symbol-fetch.ts` (Savant wrappers).
- **RS series computation**: `rs-series.ts` (`buildPhaseSeries`, `computeRsSeries`).
- **Archive writes**: `pairs-writer.ts` (`writeUnifiedSeries`).
- **Canonical engine and signals**: `rs-canonical-engine.ts`, `rs-signals-engine.ts`, `rs-events-consumer.ts`.
- **Registry enumeration**: `registry.ts` / `registry-actions.ts`.
- **Backfill HTTP**: `admin-tasks.ts` (`recomputeRegisteredBackfill`).
- **Partner webhooks**: `partner-webhooks.ts` (legacy symbol-driven `processDataReadyRunV2`, future TS_UNIVERSE subscriber).

As TS_UNIVERSE live ingestion and unified backfill are implemented, new code should:

- Depend on this engine contract (or its finalized TypeScript equivalent).
- Avoid introducing new symbol-driven ingestion paths that bypass the engine.
- Keep planning docs (`rs-partner-integration.md`, `RS_ARCHIVE_BACKFILL.md`, `RS_BACKFILL_SIGNALS.md`) in sync with any contract changes.
