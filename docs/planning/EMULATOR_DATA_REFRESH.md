> **Transition Note (Multi-Interval RS):** This document assumes a daily-only RS model with `signals-daily` and/or `pairs-data.data[]`. A multi-interval RS transition is now planned; see `docs/planning/MULTI_INTERVAL_RS_TRANSITION.md` for the up-to-date design. This file will be updated once implementation is complete.

# Emulator RS Data Refresh Playbook

This doc describes how to fully rebuild the Firestore **emulator** database for RS signals/positions using existing Cloud Functions. It is meant for local dev only and never for prod.

## 1. Preconditions

- Firebase emulators running for **functions + firestore**:

  ```bash
  npx firebase emulators:start --only functions,firestore
  ```

- Functions emulator (from the emulator table) is typically on:

  ```text
  Functions: http://127.0.0.1:5002/rel-str/us-central1
  Firestore: 127.0.0.1:8088
  UI:       http://127.0.0.1:4010
  ```

- Admin backfill token for this project:

  ```text
  ADMIN_BACKFILL_TOKEN=local-admin
  ```

## 2. One-time Hard Reset of Emulator RS Data

Use this when you want to completely rebuild per‑pair signals, per‑pair `signals-daily`, root positions, and root `signals-daily` from archive.

### 2.1 Clean root collections (positions + signals-daily)

In the **Firestore emulator UI** (`http://127.0.0.1:4010/firestore`):

- Delete root collection `positions`.
- Delete root collection `signals-daily`.

These will be recreated by backfill.

### 2.2 Remove legacy root `data` field from pairs-data

```powershell
$body = @{ data = @{} } | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5002/rel-str/us-central1/purgePairsDataRootDataField" `
  -ContentType "application/json" `
  -Body $body
```

Effect:

- Iterates all `pairs-data/{PAIR}` docs and deletes the legacy `data` array field.

### 2.3 Purge per‑pair signals-daily for all pairs

```powershell
$body = @{
  data = @{
    fromYear         = 2000
    toYear           = 2030
    removeContainers = $true   # delete year docs under signals-daily
  }
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5002/rel-str/us-central1/purgePairSignalsDailyAll" `
  -ContentType "application/json" `
  -Body $body
```

Effect per pair (`pair-registry` driven):

- Deletes legacy `pairs-data/{PAIR}/signals-daily/{YYYY-MM-DD}` docs.
- Deletes all `signals-daily/{YYYY}/days/*` docs for `fromYear..toYear`.
- Deletes `signals-daily/{YYYY}` container docs when `removeContainers = true`.

### 2.4 Purge per‑pair signals for all pairs

```powershell
$body = @{
  data = @{
    fromYear         = 2000
    toYear           = 2030
    removeContainers = $true   # delete year docs under signals
    removeOpenBucket = $true   # delete any signals/open bucket + items
  }
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5002/rel-str/us-central1/purgePairSignalsAll" `
  -ContentType "application/json" `
  -Body $body
```

Effect per pair (`pair-registry` driven):

- Deletes legacy flat `pairs-data/{PAIR}/signals/*` docs with non‑year ids.
- Deletes all items under `signals/{YYYY}/opens` and `signals/{YYYY}/closes` for `fromYear..toYear`.
- Deletes the `signals/{YYYY}` docs themselves.
- Deletes any `signals/open/items/*` and the `signals/open` doc.

### 2.5 Hard delete signals and signals-daily subcollections (per pair)

After the callables above, use the **Firestore CLI** against the emulator to ensure *all* `signals` and `signals-daily` subcollections are removed for the registered pairs.

```powershell
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8088"
$PROJECT = "rel-str"

# Keep in sync with pair-registry/* in the emulator
$pairs = @(
  "QQQ-AAPL",
  "QQQ-GOOGL",
  "QQQ-TSLA",
  "SPY-AAPL",
  "SPY-GOOGL",
  "SPY-PFE",
  "SPY-QQQ",
  "SPY-TSLA",
  "SPY-WMT",
  "SPY-XOM",
  "SPY-XPH",
  "XPH-PFE"
)

foreach ($pair in $pairs) {
  Write-Host "Purging $pair ..."
  firebase firestore:delete "pairs-data/$pair/signals" `
    --project $PROJECT --recursive --force
  firebase firestore:delete "pairs-data/$pair/signals-daily" `
    --project $PROJECT --recursive --force
}
```

After this, per pair you should see:

- `pairs-data/{PAIR}` with archives (`archive-YYYY`) and meta, but **no** `signals` or `signals-daily` subcollections.
- Root `positions` and `signals-daily` absent (to be rebuilt).

## 3. Rehydrate Archive Data from SavantAPI into Emulator

Use `recomputeRegisteredBackfill` (HTTP admin function) against the **functions emulator** to fetch bars from SavantAPI and write/repair `pairs-data` roots + `archive-YYYY`.

### 3.1 Focused archive repair for a specific range

Example: repair a recent window around a known gap (POST phase only).

> **Note (2025-12)**
>
> The `recomputeRegisteredBackfill` admin function now requires an explicit
> `from`/`to` **calendar window**. Legacy `yearsBack`/`days`/`limit` parameters
> are **deprecated** and ignored by the RS pipeline; all partner bar fetches
> are driven only by `from`/`to`.

```powershell
$TOKEN = "local-admin"

$body = @{
  phase       = "post"           # or "both" for PRE+POST
  from        = "2025-11-10"     # explicit window is now required
  to          = "2025-11-25"     # include several trading days before/after
  missingOnly = $false
  concurrency = 3
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5002/rel-str/us-central1/recomputeRegisteredBackfill" `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body $body
```

Expected result (example):

- `ok: true`
- `successPairs: 12`, `failedPairs: 0` in the `results` array.
- `pairs-data/{PAIR}/archive-2025/*` now has `day` docs for the requested window.

**Important:**

- `buildPhaseSeries` uses a **5‑day rolling window** for RS rank. You must provide at least 5 aligned trading days in the window for the latest days to be computed; otherwise `diagnosePairDays` will report `compute_skipped`.

## 4. Backfill Signals, Positions, and Root Mirrors in Emulator

Once archives are correct, use `backfillSignalsHistory` (HTTP admin endpoint) to rebuild per‑pair signals, per‑pair `signals-daily`, root positions, and root `signals-daily` for a date range.

Example: backfill a wide window for emulator testing:

```powershell
$TOKEN = "local-admin"

$body = @{
  from   = "2024-01-01"
  to     = "2025-12-31"
  dryRun = $false
  mirror = $true      # rebuild root signals-daily mirror per touched day
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5002/rel-str/us-central1/backfillSignalsHistory" `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body $body
```

For a smaller patch window (e.g. after repairing recent archive days):

```powershell
$TOKEN = "local-admin"

$body = @{
  from   = "2025-11-10"
  to     = "2025-11-25"
  dryRun = $false
  mirror = $true
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5002/rel-str/us-central1/backfillSignalsHistory" `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body $body
```

Backfill responsibilities (per docs):

- Reads `pairs-data/{PAIR}/archive-YYYY/*` and reconstructs RS series.
- Writes canonical per‑pair signals:
  - `pairs-data/{PAIR}/signals/{YYYY}/opens/{signalId}`
  - `pairs-data/{PAIR}/signals/{YYYY}/closes/{signalId}`
- Writes per‑pair `signals-daily`:
  - `pairs-data/{PAIR}/signals-daily/{YYYY}/days/{YYYY-MM-DD}`
- Writes/updates root positions:
  - `positions/open/items/{positionId}`
  - `positions/{YYYY}-closed/items/{positionId}`
- Optionally (when `mirror: true`) rebuilds root `signals-daily/{YYYY}/days/{YYYY-MM-DD}` via `rebuildSignalsDailyMirrorImpl` for all touched days.

## 5. Diagnosing Missing Days (compute_skipped)

If a day appears to have bars in Savant but no RS/positions in the emulator, use the existing diagnostic callable against the emulator.

Example: check `SPY` pairs for a small window:

```powershell
$body = @{
  data = @{
    baseline = "SPY"
    symbols  = @("AAPL","GOOGL","TSLA","PFE","QQQ","WMT","XOM","XPH")
    phase    = "POST"
    from     = "2025-11-19"
    to       = "2025-11-21"
    autoFix  = $false
  }
} | ConvertTo-Json

$resDiag = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5002/rel-str/us-central1/diagnosePairDays" `
  -ContentType "application/json" `
  -Body $body

$resDiag.result.results |
  Select-Object pair, @{n='problems';e={$_.counts.problems}} |
  Format-Table

$resDiag.result.results[0].problems | Format-List *
```

Key reasons:

- `missing_base_bar` / `missing_target_bar` → bars absent from Savant for that day.
- `compute_skipped` → both bars exist, but `buildPhaseSeries` did not emit a point (e.g. fewer than 5 aligned days in window, or non‑finite derived `cp`/prices).

## 6. Optional: Local Daily Refresh Script for Emulator

Since emulators do not support Cloud Scheduler, use a local PowerShell script + Windows Task Scheduler to keep emulator data fresh.

Example script `scripts/refresh-emulator-rs.ps1`:

```powershell
$TOKEN = "local-admin"

# 1) Refresh archives for recent days
 # NOTE (2025-12): recomputeRegisteredBackfill now requires explicit
 # `from`/`to` dates. The legacy `days`/`limit`/`yearsBack` fields are
 # deprecated for RS/backfill and must not be used to drive the fetch
 # window.

$today = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
$from  = (Get-Date).ToUniversalTime().AddDays(-20).ToString('yyyy-MM-dd')

$bodyArchive = @{
  phase       = "post"
  from        = $from
  to          = $today
  missingOnly = $false
  concurrency = 3
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5002/rel-str/us-central1/recomputeRegisteredBackfill" `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body $bodyArchive

# 2) Backfill signals/positions for same window

$bodyBackfill = @{
  from   = $from
  to     = $today
  dryRun = $false
  mirror = $true
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5002/rel-str/us-central1/backfillSignalsHistory" `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body $bodyBackfill
```

Schedule this via Windows Task Scheduler to run once per day while emulators are running. This keeps the emulator’s archives + signals/positions approximately current using the existing production backfill paths.
