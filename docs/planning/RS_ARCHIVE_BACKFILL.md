# RS Archive Backfill (DAILY / WEEKLY / MONTHLY)

## 1. Purpose & Scope

This document is the **authoritative guide** for backfilling RS archives only:

- **In scope** (RS series only):
  - `pairs-data/{PAIR}/archive-YYYY/{YYMMDD}` — DAILY RS archives.
  - `pairs-data/{PAIR}/archive-weekly-YYYY/{YYMMDD}` — WEEKLY RS archives.
  - `pairs-data/{PAIR}/archive-monthly-YYYY/{YYMMDD}` — MONTHLY RS archives.
  - `pairs-data/{PAIR}` latest mirrors for D/W/M (e.g. `latestDaily`, `latestWeekly`, `latestMonthly` or equivalent fields written by `writeUnifiedSeries`).
- **Out of scope (paused work)**:
  - Canonical signals under `pairs-data/{PAIR}/signals/*`.
  - `signals-activity/*` mirrors.
  - Positions under `positions/{open|YYYY-closed}/items/*`.

Signals / activity / positions backfill remains documented separately in `RS_BACKFILL_SIGNALS.md` and is not part of this archive-only plan.

> **Ingestion alignment:** In the target architecture, DAILY/WEEKLY/MONTHLY RS archives are populated **primarily by a unified ingestion engine** that runs once per trading day in response to the **universe-ready `partner-data-ready` v1 message** from Savant (attributes `runType = "ts-post-all-intervals"`, `phase = "post"`; see `docs/partner/rs-partner-integration.md`). Historically, `recomputeRegisteredBackfill` was the **admin backfill/repair entrypoint** over that same archive model; it is now considered a **legacy** endpoint in favor of the RS-native backfill function `recomputeRsBackfillAdmin` (see §10) but its semantics remain documented here for reference.

## Implementation Efforts (PDR – Partner Data Ready RS pipeline)

- **Code**: `PDR` – Partner Data Ready → RS archive ingestion and backfill path
- **Efforts**:
  - `RS-BE-FEAT-PDR-2601-01` – Partner data ingestion & initial prod RS archive backfill
    - Scope: implement bulk pair registry import, RS archive backfill entrypoints, and tie them to the `partner-data-ready` universe-ready pipeline for prod go-live (see `docs/tasks/PROTOTYPE.md` Next Phase Plan).

## Implementation Efforts (FRBARR – Full RS Backfill and Realtime Refresh)

- **Code**: `FRBARR` – Full RS Backfill and Realtime Refresh over archives
- **Efforts**:
  - `RS-BE-FEAT-FRBARR-2601-02` – RS queue-based pair backfill & realtime refresh (Cloud Tasks + Firestore)
    - Scope: introduce a Cloud Tasks + Firestore job pipeline for RS pair archive recompute and compact realtime refresh, mirroring Savant's time-series job model. Refactor `recomputeRegisteredBackfill` into a run/job enqueuer, add RS-specific job/run schemas and workers, and reuse shared helpers across both full-history backfill and realtime refresh paths.

See also `IMPLEMENTATION_EFFORTS_AND_JOURNALING.md` for the global Effort ID, implementation docs, and journaling workflow.

---

## 2. Archive Data Model (As Used by RS)

### 2.1 Paths

For each pair `{PAIR} = {BASELINE}-{SYMBOL}`:

- **Daily RS archives**
  - `pairs-data/{PAIR}/archive-YYYY/{YYMMDD}`
  - One document per trading day where RS is computed.
  - Each doc holds at least:
    - `day: string` — `YYYY-MM-DD`.
    - `pre?` — PRE snapshot (intraday/pre-close RS and price context).
    - `post?` — POST snapshot (canonical end-of-day RS and price context).

- **Weekly RS archives**
  - `pairs-data/{PAIR}/archive-weekly-YYYY/{YYMMDD}`
  - One document per **weekly bar** provided by Savant for that pair.
  - `day` is the bar

- **Monthly RS archives**
  - `pairs-data/{PAIR}/archive-monthly-YYYY/{YYMMDD}`
  - One document per **monthly bar** provided by Savant for that pair.

- **Latest mirrors (per pair)**
  - `pairs-data/{PAIR}` root doc includes latest mirrors per interval, written by `writeUnifiedSeries`:
    - `latestDaily`.
    - `latestWeekly`.
    - `latestMonthly`.

### 2.2 Shards and Years

- Each archive collection is **year-sharded**:
  - `archive-2019`, `archive-2020`, ..., `archive-YYYY`.
  - `archive-weekly-2019`, ..., `archive-monthly-YYYY`.
- Backfill logic operates **per shard** when deciding whether to overwrite vs merge.

---

## 3. Core Invariants & In-Progress Bars

### 3.1 One in-progress bar per interval

Across both live runs and backfill:

- At any time, there is at most **one in-progress bar** per interval:
  - DAILY: today's partially-updated bar (PRE/POST) in `archive-YYYY`.
  - WEEKLY: the latest weekly bar for the current week.
  - MONTHLY: the latest monthly bar for the current month.
- The next bar after the in-progress bar is always the last completed interval's end bar.

We do **not** keep multiple in-progress bars for the same interval.

### 3.2 Live vs Backfill writes

For **both live pipeline and backfill**:

- We **write all bars** that we have from Savant for the requested interval(s).
- We rely on a simple shard strategy instead of flags like `isIntervalClose`:
  - Decide which shards are affected by the `[from, to]` window.
  - Either **overwrite entire shard(s)** (full backfill) or **merge** the window into shards (partial backfill).
- There is no separate storage for **in-progress-only** bars; bars always live in the archives.

---

## 4. Window & Shard Semantics (Overwrite vs Merge)

### 4.1 Definitions

- `fromDay`: inclusive lower bound, `YYYY-MM-DD`.
- `toDay`: inclusive upper bound, `YYYY-MM-DD`.
- `today`: current UTC trading day (or chosen cutoff for an archival backfill).

### 4.2 Full backfill (2019-01-01 - today)

**Use case:** rebuild RS archives from the beginning of history.

- Recommended window:
  - `from = '2019-01-01'`.
  - `to = today`.
- For each interval (DAILY/WEEKLY/MONTHLY) and each year shard touched by `[from, to]`:
  - The backfill recomputes RS series for all days in `[from, to]` and writes archive docs for those days via `writeUnifiedSeries`.
  - For WEEKLY and MONTHLY, `recomputeRegisteredBackfill` **purges any existing archive docs whose `day` falls in `[from, to]`** before writing the new series, so only the recomputed bars remain for that window.
  - For DAILY, `writeUnifiedSeries` upserts docs for every recomputed day; when `[from,to]` spans the full history you care about, this effectively overwrites all existing daily archive docs in that range.
- Effect:
  - Removes any stale or partially-computed bars going back to 2019 within `[from, to]`.
  - Guarantees a clean, consistent archive for all years in the window.

### 4.3 Partial backfill (arbitrary window, to in the past)

**Use case:** fix a local problem window without rewriting all history.

- Window:
  - `from` and `to` arbitrary, but `to ≤ today`, and typically **in the past**.
- Behavior per interval and year shard:
  - For dates **inside `[from, to]`**:
    - Recompute from Savant.
    - Rewrite those bars in `archive-*` (delete+insert or upsert).
    - For WEEKLY and MONTHLY, `recomputeRegisteredBackfill` explicitly deletes any existing weekly/monthly docs in `[from, to]` for that pair before writing the new series.
    - For DAILY, `writeUnifiedSeries` upserts per-day docs without a separate delete step; only days for which RS is recomputed are overwritten.
  - For dates **outside** `[from, to]` within the same shard:
    - Leave existing bars unchanged.
- Effect:
  - Merges the recomputed window into existing shards.
  - Preserves unaffected history on either side of the window.

### 4.4 Live pipeline (conceptually a rolling partial backfill)

Live POST runs behave like a very narrow backfill:

- The RS writer (`writeUnifiedSeries`) uses a fixed lookback window over Savant bars.
- For the **current year shard** for each interval:
  - It rewrites all bars that fall within its lookback.
  - This removes any older in-progress bar and replaces it with the latest computed bar.
- Past shards (older years) are typically untouched by normal live runs.

**Key point:** we do **not** special-case separate live vs backfill archive semantics; both obey the same conceptual overwrite/merge behavior based on the window. The current implementation achieves this by:

- DAILY: recomputing RS and upserting per-day docs for the computed window via `writeUnifiedSeries`.
- WEEKLY/MONTHLY: deleting any existing docs in `[from, to]` for the pair, then writing the recomputed weekly/monthly series for that window.

---

## 5. Weekly Cross-Year Edge Case

Weeks can span a **year boundary**. For RS archives we adopt this rule:

- The **final weekly bar** for a cross-year week should live **entirely in the new year's shard**.
- If an earlier year shard (e.g. `archive-weekly-2024`) contains a **stub/in-progress** weekly bar for a week that actually closes in early 2025:
  - When recomputing weekly archives across that boundary:
    - Remove the stub doc in the prior-year shard **if it is only in-progress**.
    - Keep or rewrite the **final** weekly bar into the new-year shard (`archive-weekly-2025`).

In practice, a robust weekly backfill implementation should:

- For the year preceding `fromDay` (and any boundary year touched by the window):
  - Detect if the last weekly doc is for a week whose final bar date lies in the next year.
  - If so, and a proper final weekly bar will be written into the next year's shard from Savant data, delete the prior-year stub so only the correct final weekly bar remains.

This ensures we never end up with multiple conflicting bars for the same cross-year week.

---

## 6. `recomputeRegisteredBackfill` (Legacy Admin HTTP Backfill)

### 6.1 Overview

> **Deprecation note:** New RS archive backfill workflows (full-history or targeted) should use `recomputeRsBackfillAdmin` as described above. `recomputeRegisteredBackfill` remains available for legacy scripts and the emulator playbook but should be treated as a compatibility surface only.

`recomputeRegisteredBackfill` is the **legacy admin backfill entrypoint** for RS archives.

- Location: `functions/src/webhooks/admin-tasks.ts` (legacy path; new work should prefer `functions/src/rs/time-series/rs-backfill-admin.ts` → `recomputeRsBackfillAdmin`).
- Export:

  ```ts
  export const recomputeRegisteredBackfill = onRequest({ region: 'us-central1', timeoutSeconds: 540 }, async (req, res) => { /* ... */ });
  ```

- Responsibilities (archives-only):
  - Enumerate registered pairs from `pair-registry/*`.
  - For each pair and interval (configurable):
    - Fetch Savant time-series bars for the requested `[fromDay, toDay]`.
    - Recompute RS series per interval using the existing writer stack (`buildPhaseSeries` + `writeUnifiedSeries`).
  - Apply the **overwrite vs merge** shard strategy described above.
  - Return a JSON summary of pairs/intervals processed and any errors.

Signals, activity, and positions are **not** touched by this function in the current mode.

### 6.2 Auth & Endpoint

- Deployed as an HTTPS function in region `us-central1`.
- Protected by an admin token, similar to other admin HTTP functions.
- Prod URL pattern (example):

  ```text
  https://us-central1-rel-str.cloudfunctions.net/recomputeRegisteredBackfill
  ```

- Auth header (example convention):

  ```http
  Authorization: Bearer ${ADMIN_BACKFILL_TOKEN}
  ```

Check `admin-tasks.ts` and `EMULATOR_DATA_REFRESH.md` for the current project-specific token and deployment notes.

### 6.3 Request Parameters (Current Implementation)

`recomputeRegisteredBackfill` accepts both **query string** and **JSON body** fields. The effective body is:

- **Auth**
  - `Authorization: Bearer ${ADMIN_BACKFILL_TOKEN}` — required header.

- **Window**
  - `from: string` — `YYYY-MM-DD` (inclusive). **Required.**
  - `to: string` — `YYYY-MM-DD` (inclusive). **Required.**

- **Phase**
  - `phase?: 'pre' | 'post' | 'both'` (case-insensitive).
  - Defaults to `post` when omitted.

- **Intervals**
  - `intervals?: ('DAILY' | 'WEEKLY' | 'MONTHLY') | ('DAILY' | 'WEEKLY' | 'MONTHLY')[]`.
  - Accepts a single string or an array; case-insensitive.
  - Defaults to `[DAILY, WEEKLY, MONTHLY]` when omitted or when parsing yields an empty list.

- **Pairs (optional filters)**
  - `pair?: string` — a single pair id like `QQQ-AAPL` (baseline-target).
  - `pairs?: string[]` — an array of pair ids; when provided and non-empty, only those registry pairs are processed.
  - When neither is supplied, all registry pairs from `pair-registry/*` are included.

- **Concurrency / sizing**
  - `concurrency?: number` — max pairs processed in parallel; defaults to `process.env.PARTNER_PAIR_CONCURRENCY` or `3`.
  - `days?: number` — numeric hint (logged in summary), defaulting to `FIXED_DAYS`.
  - `limit?: number` — numeric hint (logged in summary), defaulting to `FIXED_LIMIT`.

> **Note:** There is **no** `dryRun` or `fullHistory` flag today. Every call that passes validation writes archives for the requested window. The "full" vs "partial" semantics described earlier are about how you choose `[from, to]` and which pairs/intervals you include, not about a separate mode switch in this function.

### 6.4 Example: Full 2019+ Backfill (Archives Only, Legacy Endpoint)

**Goal:** Rebuild DAILY/WEEKLY/MONTHLY RS archives for all registered pairs from 2019-01-01 through today.

1. **Deploy updated functions**

   ```bash
   cd functions
   npm run build
   firebase deploy --only functions:recomputeRegisteredBackfill --project rel-str
   ```

2. **Run a small window first** (sanity check, e.g. 7 days):

   ```bash
   PROJECT=rel-str
   TOKEN=local-admin   # example; use real ADMIN_BACKFILL_TOKEN

   curl -X POST \
     "https://us-central1-${PROJECT}.cloudfunctions.net/recomputeRegisteredBackfill" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${TOKEN}" \
     -d '{
       "from": "2025-01-01",
       "to": "2025-01-07",
       "intervals": ["DAILY", "WEEKLY", "MONTHLY"]
     }'
   ```

3. **Run the full backfill** (2019-01-01 → today, archives only):

   ```bash
   TODAY=$(date -u +"%Y-%m-%d")
   PROJECT=rel-str
   TOKEN=local-admin   # example; use real ADMIN_BACKFILL_TOKEN

   curl -X POST \
     "https://us-central1-${PROJECT}.cloudfunctions.net/recomputeRegisteredBackfill" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${TOKEN}" \
     -d "{
       \"from\": \"2019-01-01\",
       \"to\": \"${TODAY}\",
       \"intervals\": [\"DAILY\", \"WEEKLY\", \"MONTHLY\"]
     }"
   ```

4. **Monitor logs and Firestore** for:
   - Pairs processed count.
   - Any per-pair errors.
   - Resulting archives under `pairs-data/{PAIR}/archive-*`.

### 6.5 Example: Partial Window Repair (Legacy Endpoint)

**Goal:** Repair a bad DAILY/WEEKLY window for a small set of pairs over a known range.

```bash
PROJECT=rel-str
TOKEN=local-admin

curl -X POST \
  "https://us-central1-${PROJECT}.cloudfunctions.net/recomputeRegisteredBackfill" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "from": "2024-10-01",
    "to": "2024-10-31",
    "intervals": ["DAILY", "WEEKLY"],
    "pairs": ["QQQ-AAPL", "SPY-MSFT"]
  }'
```

- Only the specified pairs are touched.
- For those pairs, bars in `[2024-10-01, 2024-10-31]` are recomputed and merged into existing shards.
- Bars outside that window remain intact.

---

## 7. Safety & Idempotency

- **Within `[fromDay, toDay]`**:
  - Bars are fully determined by SavantAPI and RS computation.
  - Re-running the same backfill with the same inputs is **idempotent**: the resulting archives will be the same.
- **Outside `[fromDay, toDay]`**:
  - Full-history mode overwrites entire shards intersecting the window by design.
  - Partial mode leaves out-of-window bars unchanged.
- **Signals / positions**:
  - This doc assumes signals/activity/positions are either disabled (`DISABLE_SIGNALS_ACTIVITY_POSITIONS=true`) or unaffected by `recomputeRegisteredBackfill`.
  - When the signals backfill path is re-enabled, see `RS_BACKFILL_SIGNALS.md` and `MULTI_INTERVAL_RS_TRANSITION.md` for the canonical engine behavior.

---

## 8. Bulk Pair Registry Import (2026-01-15)

### 8.1 Purpose

On **2026-01-15** we introduced an admin HTTP helper to populate and normalize the
`pair-registry` universe from curated ETF constituent JSON files. This is intended
to be the authoritative way to stand up the full RS universe aligned with
`SPY`/`QQQ`/sector/industry ETFs, and to give every pair an explicit provenance
marker.

- Function: `importPairRegistryFromBulkJsonAdmin` (see `functions/src/webhooks/registry-actions.ts`).
- Source JSON (deployed alongside functions bundle):
  - `functions/bulk-import.enriched_spy-qqq.json`.
  - `functions/bulk-import.enriched_XL-non-spy-qqq.json`.

Each JSON row is of the form:

```jsonc
{ "symbol": "AAPL", "etfs": ["SPY", "QQQ", "XLK"] }
```

The importer expands this into **one pair per ETF membership**:

- `SPY-AAPL`, `QQQ-AAPL`, `XLK-AAPL`, etc.

### 8.2 Behavior and Doc Shape

For every expanded pair `{BASELINE}-{TARGET}` it upserts a doc under:

- `pair-registry/{BASELINE}-{TARGET}`

Fields written/normalized on each run:

- `baseline: string` — uppercased baseline ETF.
- `target: string` — uppercased member symbol.
- `source: '2026-01-15-bulk-pairs-import'` — via `PairSource.BULK_IMPORT_2026_0115`.
- `dailyReady: true`.
- `weeklyReady: true`.
- `monthlyReady: true`.
- `ingestionStatus: 'SUCCESS'` — via `PairIngestionStatus.SUCCESS`.
- `lastIngestionError: null`.
- `updatedAt: serverTimestamp()`.

For **new** docs only it also sets:

- `createdAt: serverTimestamp()`.
- `lastIngestionAt: serverTimestamp()`.
- `members: []`.
- `refCount: 0`.

All writes use `set(..., { merge: true })`, so any existing `members` and
`refCount` fields are preserved and only normalized to an empty array / zero
when the doc is first created.

### 8.3 Dry Run vs Write Mode

`importPairRegistryFromBulkJsonAdmin` supports a **dry-run** mode which is
strongly recommended before any destructive or large-scale import:

- When `dryRun=true` (query or JSON body), it returns:

  ```jsonc
  { "ok": true, "dryRun": true, "totalPairs": 1238, "pairs": ["QQQ-AAPL", "SPY-AAPL", ...] }
  ```

  and performs **no Firestore writes**.

- When `dryRun` is omitted or `false`, it writes the docs as described above
  and returns a summary:

  ```jsonc
  { "ok": true, "dryRun": false, "totalPairs": 1238, "created": N, "updated": M }
  ```

This function does **not** touch `pairs-data/*`; it only shapes `pair-registry`.

### 8.4 Example Usage

Dry run:

```bash
PROJECT=rel-str
TOKEN=${ADMIN_BACKFILL_TOKEN}

curl -X POST \
  "https://us-central1-${PROJECT}.cloudfunctions.net/importPairRegistryFromBulkJsonAdmin?dryRun=true" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}"
```

Real import (after reviewing the dry run pairs):

```bash
PROJECT=rel-str
TOKEN=${ADMIN_BACKFILL_TOKEN}

curl -X POST \
  "https://us-central1-${PROJECT}.cloudfunctions.net/importPairRegistryFromBulkJsonAdmin" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## 9. Validation Checklist (Archives Only)

After any backfill run (especially the full 2019+ run), validate:

1. **Daily archives**
   - Pick a sample pair (e.g. `QQQ-AAPL`).
   - For a few days in `[fromDay, toDay]`:
     - Confirm `archive-YYYY/{YYMMDD}` exists with both `pre` and `post` (when expected).
     - Spot-check RS/price fields against SavantAPI for that symbol.

2. **Weekly archives**
   - For the same pair, list `archive-weekly-YYYY` docs around several weeks.
   - Confirm:
     - Bar dates match the weekly bars provided by Savant.
     - There is no duplicate bar for the same week in adjacent year shards.

3. **Monthly archives**
   - For the same pair, inspect `archive-monthly-YYYY`.
   - Ensure each monthly bar aligns with Savant's monthly series.

4. **Latest mirrors**
   - For a sample of pairs, confirm `pairs-data/{PAIR}.latestDaily` / `latestWeekly` / `latestMonthly` are consistent with the most recent archive docs within `[fromDay, toDay]`.

5. **Logs / metrics**
   - Check Cloud Logging for `recomputeRegisteredBackfill` for:
     - Total pairs processed.
     - Any errors or warnings.
   - If a monitoring dashboard exists, confirm no obvious gaps in RS coverage after the run.

This checklist is intentionally archives-only; when signals/activity/positions backfill is re-enabled, their own validation steps should be run in addition to the above.

---

## 10. Added Work (2026-01-26)

- **RS-native backfill admin entrypoint**
  - `recomputeRsBackfillAdmin` under `functions/src/rs/time-series/rs-backfill-admin.ts` is now the preferred admin HTTP entrypoint for RS archive backfill.
  - It mirrors the shard/window semantics documented for `recomputeRegisteredBackfill` but delegates work to the RS job/run + Cloud Tasks pipeline by creating `rs-backfill-runs` docs and per-`{pair, interval, phase}` jobs.
  - When called without `pairs`, it enumerates the full `pair-registry` universe, enabling full-universe 2019+ backfills over DAILY/WEEKLY/MONTHLY intervals.

- **Backfill run/job metadata cleanup**
  - A scheduled v2 function `cleanupRsBackfillRuns` has been added under `functions/src/scheduled/cleanup-rs-backfill-runs.ts`.
  - It runs periodically (every 30 days by default) and deletes `system/rs-backfill-runs/runs/{runId}` docs older than `RS_BACKFILL_MAX_AGE_DAYS` (default 30 days), along with their `jobs` subcollections.
  - This keeps historical backfill metadata bounded while leaving RS archive data under `pairs-data/*` untouched.
