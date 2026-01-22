> **Transition Note (Multi-Interval RS & Signals Activity):** This document was originally authored for a **daily-only RS model**. The current canonical model is multi-interval RS with **Signals Activity** mirrors and positions built from the canonical RS engine. See `docs/planning/MULTI_INTERVAL_RS_TRANSITION.md`, `RS_SIGNAL_HISTORY.md`, and `UNIFIED_INGESTION_ENGINE.md` for the up-to-date design. This file should be read as a **backfill/cleanup playbook** for canonical signals, Signals Activity, and positions.

# RS Backfill for Signals & Positions

## Purpose

This doc explains how to backfill:

- Canonical per-pair RS signals (`pairs-data/{PAIR}/signals`)
- Root positions and per-position timelines (`positions/*`)
- Per-pair and root **Signals Activity** mirrors (`pairs-data/{PAIR}/signals-activity/*`, `signals-activity/*`).

Backfill now uses the same RS engine and writer helper as live so that historical repair and daily pipeline share one code path for:

- RS state machine (`detectRsEvents`)
- Canonical OPEN/CLOSE signal writes
- Root positions timeline writes

> **Archive dependency:** Signals/positions backfill assumes that DAILY/WEEKLY/MONTHLY RS archives under `pairs-data/{PAIR}/archive-*` have already been populated by the **unified ingestion engine** (triggered by the universe-ready `partner-data-ready` v1 message; see `UNIFIED_INGESTION_ENGINE.md` and `rs-partner-integration.md`) and/or repaired via `recomputeRegisteredBackfill` as described in `RS_ARCHIVE_BACKFILL.md`. This doc focuses on rebuilding canonical signals, **Signals Activity**, and positions **on top of that archive history**.

## Cleaning Existing Data Before Backfill

Backfill assumes it is writing the **source of truth** for the ranges you target. If you already have partial or incorrect data in the target collections, you should clear it first.

There are two primary tasks:

1. Delete root `positions` (and, if present, any legacy mirrors) in the Firebase console when you want a full reset of positions + activity.
2. Delete per-pair `pairs-data` signals and per-pair `signals-activity` collections using the cleanup callables in `cleanup.callables.ts`.

### 1. Delete Root `positions` in Console

From the Firestore console (project `rel-str`), you can:

- Delete root collection **`positions`**
  - This removes all root position buckets and per-position timelines.

Only do this when you intend to fully rebuild positions and activity from archive. This is destructive and cannot be undone.

### 2. Use Cleanup Callables for Per-Pair Signals & Signals-Activity (Recommended)

Do **not** delete the `pairs-data` root collection. That would also remove the
archive year collections we rely on (e.g. `pairs-data/{PAIR}/archive-2025`).

Instead, use the existing admin cleanup callables in `functions/src/cleanup.callables.ts` to
clear only the per-pair signals and Signals Activity:
- `purgePairSignalsAll` — cleans canonical per-pair signals under
  `pairs-data/{PAIR}/signals` (year-sharded opens/closes + legacy docs).
- `purgePairSignalsAndActivityAll` — cleans per-pair canonical `signals` **and** per-pair `signals-activity` for a given year range.

Example: purge signals and per-pair Signals Activity for a date range across all
registered pairs (prod project `rel-str`) using direct HTTPS calls:

```bash
# Purge canonical signals for all registered pairs between 2019 and current year
curl -X POST \
  "https://us-central1-rel-str.cloudfunctions.net/purgePairSignalsAll" \
  -H "Content-Type: application/json" \
  -d '{"data":{"fromYear":2019,"toYear":2025,"removeContainers":true,"removeOpenBucket":true}}'

# Purge per-pair signals and Signals Activity for all registered pairs between 2019 and current year
curl -X POST \
  "https://us-central1-rel-str.cloudfunctions.net/purgePairSignalsAndActivityAll" \
  -H "Content-Type: application/json" \
  -d '{"data":{"fromYear":2019,"toYear":2025,"removeContainers":true,"removeOpenBucket":true}}'
```

You can also pass an explicit `pairs` array inside the `data` object to either
callable if you only want to clean a subset of pairs.

### 3. Deleting Per-Pair Signals & Signals-Activity via CLI (Fallback)

If you **really** want to bypass the callables and directly delete data for
specific pairs, you can still use the Firebase CLI. This should be limited to
small, targeted cleanups.

Set project and pair id (e.g. `QQQ-AAPL`):

```bash
PROJECT=rel-str
PAIR="QQQ-AAPL"   # BASELINE-SYMBOL

# Delete canonical signals for this pair
firebase firestore:delete "pairs-data/${PAIR}/signals" \
  --project "${PROJECT}" --recursive --force

# Delete per-pair Signals Activity shards for this pair
firebase firestore:delete "pairs-data/${PAIR}/signals-activity" \
  --project "${PROJECT}" --recursive --force
```

Be careful not to delete any `archive-YYYY` subcollections under `pairs-data`.

## Code Path Overview

- **RS engine:** `functions/src/webhooks/rs-signals-engine.ts`
  - `detectRsEvents(samples, thresholds)` → `RsEvent[]`

- **Canonical writer:** `functions/src/webhooks/rs-events-consumer.ts`
  - `applyRsEventsForPair(events: RsWriteEvent[])`
  - Internals:
    - `writePairSignalOpen`
    - `finalizePairSignalClose`
    - `openRootPositionTimeline`
    - `closeRootPositionTimeline`

- **Live pipeline:** `functions/src/webhooks/partner-webhooks.ts`
  - `processPairLive(...)`:
    - Builds `RsSample[]` from live partner bars
    - Runs `detectRsEvents`
    - Builds `RsWriteEvent` for latest day’s OPEN/CLOSE
    - Calls `applyRsEventsForPair`

- **Backfill pipeline:** `functions/src/rs-signal-history.backfill.ts`
  - `backfillSignalsHistory`:
    - Resolves `[from, to]` (or auto mode)
    - Reads `pairs/{PAIR}/archive-{YEAR}` docs into `ArchiveDaySample[]`
    - Runs `detectRsEvents` over historical `RsSample[]`
    - Builds `RsWriteEvent` for each historical OPEN/CLOSE
    - Calls `applyRsEventsForPair` for those events
    - Updates analytics summary

## What Backfill Does Beyond Live

Backfill-specific responsibilities:

- Discover effective date range (`from`, `to`, `auto`, `autoLookbackDays`)
- Walk all registered pairs from `pair-registry`
- Reconstruct prices and RS from `archive-{YEAR}` documents
- Maintain long-running `PositionState` + `opened` across the full range
- Update `analytics/summary` with net PnL and aggregates
- Batch Firestore writes for canonical signals, Signals Activity (when enabled), and positions

Live pipeline does not do these bulk/historical tasks; it processes one run/day at a time using live partner data and Firestore state.

## Temporarily Disabling Signals / Activity / Positions

In some phases (e.g. when onboarding a large number of new pairs), we may want to continue ingesting and archiving RS data but **skip** all signals/activity/positions writes for both live and backfill flows.

This is controlled by a shared environment flag consumed by the canonical engine:

- `DISABLE_SIGNALS_ACTIVITY_POSITIONS` (boolean, default `false`)
  - Defined in `functions/src/webhooks/webhooks-config.ts` as:

    ```ts
    export const DISABLE_SIGNALS_ACTIVITY_POSITIONS =
      String(process.env.DISABLE_SIGNALS_ACTIVITY_POSITIONS || '').toLowerCase() === 'true';
    ```

### How the flag works

- `functions/src/webhooks/rs-canonical-engine.ts`
  - `runCanonicalRsEngineForPair(pairId, baseline, symbol, logger, series, thresholds)` starts with:

    ```ts
    if (DISABLE_SIGNALS_ACTIVITY_POSITIONS) {
      logger.info('runCanonicalRsEngineForPair_disabled', { pairId });
      return { writes: [], activity: [] };
    }
    ```

  - When the flag is **true**, the engine:
    - Skips loading archive RS samples and scanning threshold crossings.
    - Skips building `RsWriteEvent[]` and `ActivityEvent[]`.
    - Returns immediately with empty `writes` and `activity`.

- All callers that normally use the engine output then see `writes.length === 0` and `activity.length === 0`:
  - **Live pipeline** (`processPairLive` in `partner-webhooks.ts`):
    - Still runs `writeUnifiedSeries` and archive/latest RS writes.
    - Effectively performs **no** signals, activity, or positions writes for that run.
  - **Backfill pipelines** (e.g. `backfillSignalsPipelineAdmin`, `runSignalsBackfillForPairs`):
    - Still reconstruct RS series from archives.
    - Receive empty engine results and therefore do **no** canonical signals, signals-activity, or position/timeline writes.

### How to set the flag

- **Local / emulators**
  - Edit `functions/.env.rel-str` and add:

    ```text
    DISABLE_SIGNALS_ACTIVITY_POSITIONS=true
    ```

  - Restart emulators (`npm run emulators:start`) so the new env is loaded.

- **Prod / staging (`rel-str` project)**
  - Set an environment variable `DISABLE_SIGNALS_ACTIVITY_POSITIONS=true` for the Functions/Cloud Run services (same place other RS_* / SILENCE_* flags are configured).
  - Redeploy functions so `process.env.DISABLE_SIGNALS_ACTIVITY_POSITIONS` is populated.

### Operational Notes

- With the flag enabled:
  - Archive RS data (`archive-YYYY`, `archive-weekly-YYYY`, `archive-monthly-YYYY` and `pairs-data/{PAIR}.latest`) continues to update as normal.
  - No new canonical signals, Signals Activity docs, or positions are created or updated.
  - Existing data in those collections is left intact and becomes effectively read-only until the flag is turned off.
- When you are ready to re-enable signals/activity/positions:
  - Clear or adjust the env var (`DISABLE_SIGNALS_ACTIVITY_POSITIONS=false` or unset).
  - Redeploy functions.
  - Optionally run targeted backfill (e.g. `backfillSignalsPipelineAdmin`) to reconstruct canonical signals and positions for selected ranges/pairs.

## How to Run Backfill

### 1. Build & Deploy

```bash
cd functions
npm run build
firebase deploy --only functions:backfillSignalsHistory --project rel-str
```

### 2. HTTP Endpoint

Prod URL:

```text
https://us-central1-rel-str.cloudfunctions.net/backfillSignalsHistory
```

**Auth header (required):**

The admin backfill token for this project is:

```text
ADMIN_BACKFILL_TOKEN=local-admin
```

Pass it explicitly in commands, for example:

```bash
PROJECT=rel-str
TOKEN=local-admin

curl -X POST \
  "https://us-central1-${PROJECT}.cloudfunctions.net/backfillSignalsHistory" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "from": "2025-01-01",
    "to":   "2025-01-07",
    "dryRun": true,
    "mirror": false
  }'
```

**Body/query params:**

- `from`: `YYYY-MM-DD`
- `to`: `YYYY-MM-DD`
- `dryRun`: `true|false`
- `mirror`: `true|false`
- `auto`: `true|false`
- `autoLookbackDays`: number (optional)
- Threshold overrides (optional): `openLong`, `closeLong`, `openShort`, `closeShort`

### Examples

**Dry run over explicit range:**

```bash
PROJECT=rel-str
TOKEN=local-admin

curl -X POST \
  "https://us-central1-${PROJECT}.cloudfunctions.net/backfillSignalsHistory" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "from": "2025-01-01",
    "to":   "2025-01-07",
    "dryRun": true,
    "mirror": false
  }'
```

**Auto mode with mirror, real writes:**

```bash
PROJECT=rel-str
TOKEN=local-admin

curl -X POST \
  "https://us-central1-${PROJECT}.cloudfunctions.net/backfillSignalsHistory" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "auto": true,
    "autoLookbackDays": 365,
    "dryRun": false,
    "mirror": true
  }'
```

## Auth & Cloud Run Invoker Notes

### Application-level auth

`backfillSignalsHistory` enforces an application token:

```ts
const auth = req.headers['authorization'] || req.headers['Authorization'];
const token = typeof auth === 'string' && auth.startsWith('Bearer ')
  ? auth.substring(7)
  : '';
const expected = process.env.ADMIN_BACKFILL_TOKEN || '';
if (!expected || token !== expected) {
  res.status(401).json({ ok: false, error: 'unauthorized' });
  return;
}
```

You must always include `Authorization: Bearer ${ADMIN_BACKFILL_TOKEN}`.

### Platform-level auth (Cloud Run)

Earlier, we saw calls fail with 403 **before** our function ran, even with the token present. Root cause:

- Cloud Run service behind the function did not allow unauthenticated invocation.

Fix that worked:

1. In Cloud Run, open the service for `backfillSignalsHistory`.
2. Under Permissions:
   - Add principal: `allUsers`
   - Role: **Cloud Run Invoker**

This makes the service publicly invokable at the platform level, but **access is still protected** by `ADMIN_BACKFILL_TOKEN` at the function level.

### Recommended pattern

- Platform: `allUsers` → `Cloud Run Invoker` (avoid 403s).
- Function: strict token check (`ADMIN_BACKFILL_TOKEN`) → 401 on failure.
- Never check in the token; use env or a secret manager.

## Validation Checklist After Backfill

For a sample pair and day:

- `pairs-data/{PAIR}/signals/{YEAR}/opens|closes`:
  - OPEN/CLOSE docs match expected RS + price context.
- `pairs-data/{PAIR}/signals-activity/{YEAR}/days/{DAY}` and `signals-activity/{YEAR}/days/{DAY}` (if enabled):
  - `newOpens`, `holds`, `newCloses` consistent with canonical signals and positions.
- `positions/*`:
  - Root position documents and timelines match the backfilled opens/closes.
- `analytics/summary`:
  - Net PnL and counts updated, avg PnL reasonable.
