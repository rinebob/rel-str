# RS Archive Maintenance (As-Built)

## 1. Purpose and Canonical Surfaces

- **Canonical RS data surface**: `pairs-data/{BASELINE}-{TARGET}`
  - Per-interval archives:
    - `archive-YYYY`
    - `archive-weekly-YYYY`
    - `archive-monthly-YYYY`
  - Latest mirrors:
    - `latestDaily`
    - `latestWeekly`
    - `latestMonthly`
- **Derived/non-canonical outputs** (current implementation persists; future may be dynamic only):
  - Signals
  - Signals Activity
  - Positions

The goal of this document is to describe how we:

- Perform a **one-time archive hydration** for the current `pair-registry` universe.
- Transition to **steady-state live maintenance**, where new days are kept up to date via the `partner-data-ready` run-driven pipeline.

## 2. Canonical Entry Points

### 2.1 Pair registry

- Collection: `pair-registry/{PAIR_ID}` where `PAIR_ID = "{BASELINE}-{TARGET}"`.
- Once a pair is **present and enabled** here, it becomes eligible for:
  - Historical archive backfill.
  - Ongoing live updates driven by `partner-data-ready`.
- Pair onboarding paths include:
  - User-driven list creation/edit via `validateAndRegisterPairs` (see `functions/src/webhooks/registry-actions.ts`).
  - Bulk universe import via admin HTTP (see `importPairRegistryFromBulkJsonAdmin`).

### 2.2 Archive backfill (historical hydration)

- HTTP admin endpoint: `recomputeRegisteredBackfill` in `functions/src/webhooks/admin-tasks.ts`.
- Protected by `ADMIN_BACKFILL_TOKEN` (typically `local-admin` in local/dev).
- Inputs (query or JSON body):
  - `from: string` (required, `YYYY-MM-DD`)
  - `to: string` (required, `YYYY-MM-DD`)
  - `phase: 'pre' | 'post' | 'both'` (default `post`)
  - `intervals?: string | string[]` (subset of `['DAILY','WEEKLY','MONTHLY']`, defaults to all)
  - `pair?: string` or `pairs?: string[]` (optional filter on registered pairs)
  - `concurrency?: number` (defaults from env or 3)
  - `dryRun?: boolean` (if true, no writes; just summary of planned work)
- Behavior:
  - Enumerates registered pairs (filtered if `pair/pairs` are provided).
  - For each requested phase and pair:
    - Fetches baseline/target daily bars from Savant over a padded `[from,to]` window.
    - Builds RS series per phase and interval.
    - Clamps RS points back to the requested `[from,to]` window.
    - For each requested interval (DAILY/WEEKLY/MONTHLY):
      - Writes/merges archive shards under the appropriate `archive-*` collections.
      - Updates the `latest{Interval}` mirrors.

### 2.3 Live maintenance (run-driven updates)

- Pub/Sub subscriber: `processDataReadyRunV2` in `functions/src/webhooks/partner-webhooks.ts`.
- Subscribes to `partner-data-ready` messages (see `docs/partner/rs-partner-integration.md`).
- Behavior:
  - Parses run-level metadata (run type, phase, intervals, marketDate, etc.).
  - Resolves the set of impacted pairs from `pair-registry` and universe selection.
  - Fetches current bars from Savant for the run.
  - Applies the same RS engine used in backfill to compute new points.
  - Writes/merges those points into `pairs-data/{PAIR}` archives and updates latest mirrors.

In other words:

> Once a pair is in `pair-registry` and a historical window has been hydrated (via `recomputeRegisteredBackfill` or `runFullBackfillForPairs`), all **new** days for that pair flow into archives automatically via `processDataReadyRunV2` reacting to `partner-data-ready`.

## 3. One-Time Archive Hydration for Existing Registry

### 3.1 Preconditions

- `pair-registry` in the `rel-str` project is fully populated with the desired pair universe.
- Archives under `pairs-data/{PAIR}` are partially or mostly empty for historical dates.
- `processDataReadyRunV2` is deployed and wired to the `partner-data-ready` topic, but historical coverage is not yet complete.

### 3.2 Recommended one-shot backfill procedure

1. **Choose the historical window**
   - Typical: `from = '2019-01-01'` (or whatever `BACKFILL_START_DATE` is set to in `webhooks-config`).
   - `to` = the most recent trading day you want fully hydrated (e.g. today or the last completed market date).

2. **Dry run against the target environment**
   - Emulator:
     - Call `recomputeRegisteredBackfill` on `http://localhost:5001/rel-str/us-central1/recomputeRegisteredBackfill`.
   - Prod:
     - Call `https://us-central1-rel-str.cloudfunctions.net/recomputeRegisteredBackfill`.
   - Example JSON body:
     ```json
     {
       "from": "2019-01-01",
       "to": "2025-12-31",
       "phase": "post",
       "intervals": ["DAILY", "WEEKLY", "MONTHLY"],
       "dryRun": true,
       "concurrency": 3
     }
     ```
   - Verify the response summary:
     - `totalPairs` matches expectations for the current `pair-registry`.
     - `phases`, `intervals`, and `from`/`to` are correct.

3. **Execute the real backfill**
   - Re-run the same request with `"dryRun": false` (or omit `dryRun`).
   - Monitor Cloud Functions logs for `recomputeRegisteredBackfill_start` / `_completed` entries and error samples.

4. **Spot-check Firestore**
   - For a sample of pairs:
     - Confirm `pairs-data/{PAIR}/archive-YYYY` and per-interval archives exist and contain expected days.
     - Confirm `latestDaily` / `latestWeekly` / `latestMonthly` are present and match the last day in the backfilled range.

After this procedure, the archive dataset should be **production-ready** for all currently registered pairs.

## 4. Steady-State Live Archive Maintenance

Once the one-time backfill is complete:

- New trading days are handled exclusively by the run-driven pipeline:
  - Partner publishes `partner-data-ready` messages.
  - `processDataReadyRunV2` ingests bars and updates archives/latest mirrors.
- No further bulk backfills should be needed unless:
  - You onboard a new pair(s).
  - You change RS computation logic in a way that requires recomputing historical archives.

### 4.1 New pair onboarding after initial backfill

- **User lists / UI-driven onboarding**
  - `validateAndRegisterPairs` callable:
    - Validates baseline and targets.
    - Registers/updates `pair-registry` membership with `members` and `refCount`.
    - For newly registered pairs, triggers a fire-and-forget full backfill via `runFullBackfillForPairs` using:
      - `from = BACKFILL_START_DATE` (e.g. `2019-01-01`).
      - `to = today`.

- **Bulk admin onboarding**
  - Admin HTTP functions (e.g. `importPairRegistryFromBulkJsonAdmin`) can import or normalize the `pair-registry` universe and set readiness flags.
  - After bulk onboarding, use `recomputeRegisteredBackfill` to hydrate archives for the new pairs only (via `pair`/`pairs` filters).

#### 4.1.1 `runFullBackfillForPairs` vs `recomputeRegisteredBackfill`

- `recomputeRegisteredBackfill` is the **operator-facing HTTP endpoint** used for bulk or targeted archive hydration over a configurable `[from,to]` window and set of registered pairs.
- `runFullBackfillForPairs` is an **internal helper** (in `hydrate-new-pair`) used by `validateAndRegisterPairs` to do the same kind of work programmatically for a specific set of pairs:
  - It is not exposed as an HTTP endpoint.
  - It is invoked automatically from `validateAndRegisterPairs` with `from = BACKFILL_START_DATE` and `to = today` whenever new pairs are registered via the UI.
  - Conceptually, it is equivalent to calling `recomputeRegisteredBackfill` for those pairs only, but wired directly into the registry onboarding flow.

These two entrypoints share the same underlying RS engine (bar fetch, series build, archive writes), but serve different **callers** and concerns:

- `recomputeRegisteredBackfill` focuses on external/operational needs:
  - HTTP auth, explicit `from`/`to`/`intervals`/`dryRun` contract, and structured summaries.
  - Intended for one-off bulk runs and targeted re-runs driven by scripts or operators.
- `runFullBackfillForPairs` focuses on internal orchestration:
  - Simple function signature (pairs + `from`/`to`), no HTTP parsing/response surface.
  - Fire-and-forget usage from other functions where the caller does not need `dryRun` or a detailed HTTP response.

Refactoring one to literally wrap the other (for example, having the internal helper call the HTTP endpoint) would add indirection and HTTP overhead inside the callable path without much practical benefit. Instead, the shared behavior lives in common helpers such as `fetchDailyBarsRange`, `buildPhaseSeries`, and `writeUnifiedSeries`, while `recomputeRegisteredBackfill` and `runFullBackfillForPairs` remain tailored to their respective boundaries (operator-facing HTTP vs internal orchestration).

### 4.2 When to re-run `recomputeRegisteredBackfill`

Typical scenarios:

- **Code-level RS changes**
  - RS computation logic changes in a way that invalidates prior archives.
  - Recommended: run a targeted `recomputeRegisteredBackfill` for the affected window and pairs.

- **Partner data corrections**
  - Upstream corrections to historical bars.
  - Recommended: limit to the impacted `from`/`to` range and specific baselines/pairs.

## 5. Relationship to Signals, Activity, and Positions

- The RS archives and latest mirrors under `pairs-data/{PAIR}` are the **canonical** RS data surface.
- Signals, Signals Activity, and Positions are **derived views** built from these archives:
  - Current implementation may persist them in Firestore for convenience.
  - Longer term, RS thresholds may be dynamic and computed over a small window, making persisted snapshots less useful.
- Archive maintenance (backfill + live updates) should be considered the **source of truth** for any current or future RS-derived views.
