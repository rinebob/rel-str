> **Transition Note (Multi-Interval RS & Signals Activity):** This document was originally authored for a **daily-only RS model**. The current canonical model is multi-interval RS with **Signals Activity** mirrors and positions driven by the canonical RS engine. See `docs/planning/MULTI_INTERVAL_RS_TRANSITION.md`, `RS_SIGNAL_HISTORY.md`, and `UNIFIED_INGESTION_ENGINE.md` for the up-to-date design. Emulator rebuilds should focus on archives, canonical signals, Signals Activity, and positions.

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

Use this when you want to completely rebuild per‑pair canonical signals, per‑pair **Signals Activity**, and root positions from archive.

### 2.1 Clean root collections (positions)

In the **Firestore emulator UI** (`http://127.0.0.1:4010/firestore`):

- Delete root collection `positions`.
  
These will be recreated by backfill as positions and Signals Activity.

### 2.2 Purge per‑pair Signals Activity for all pairs (when needed)

```powershell
$body = @{
  data = @{
    fromYear         = 2000
    toYear           = 2030
    removeContainers = $true   # delete year docs under signals-activity
  }
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5002/rel-str/us-central1/purgePairSignalsActivityAll" `
  -ContentType "application/json" `
  -Body $body
```

Effect per pair (`pair-registry` driven):

- Deletes per-pair `signals-activity/{YYYY}/days/*` docs for `fromYear..toYear`.
- Deletes `signals-activity/{YYYY}` container docs when `removeContainers = true`.

### 2.3 Purge per‑pair signals for all pairs

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

#### 2.3.1 (2025-12) Combined purge for canonical signals + signals-activity

As of the multi-interval RS refactor, there is a single callable that can purge both
canonical per-pair `signals` **and** per-pair `signals-activity` in one pass, driven
by `pair-registry`:

```powershell
$body = @{
  data = @{
    fromYear         = 2000
    toYear           = 2030
    removeContainers = $true   # delete year docs under signals + signals-activity
    removeOpenBucket = $true   # delete any signals/open bucket + items
    # pairs = @("QQQ-AAPL", "SPY-QQQ")  # optional: restrict to specific pairs
  }
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5002/rel-str/us-central1/purgePairSignalsAndActivityAll" `
  -ContentType "application/json" `
  -Body $body
```

Effect per pair (`pair-registry` driven):

- Deletes legacy flat `pairs-data/{PAIR}/signals/*` docs with non‑year ids.
- Deletes all items under `signals/{YYYY}/opens` and `signals/{YYYY}/closes` for `fromYear..toYear`.
- Deletes any `signals/open/items/*` and the `signals/open` doc when `removeOpenBucket = true`.
- Deletes all `pairs-data/{PAIR}/signals-activity/{YYYY}/days/*` docs for `fromYear..toYear`.
- Deletes `signals/{YYYY}` and `signals-activity/{YYYY}` container docs when `removeContainers = true`.

## 3. Rehydrate Archive Data from SavantAPI into Emulator

Use legacy `recomputeRegisteredBackfill` (HTTP admin function) against the **functions emulator** to fetch bars from SavantAPI and write/repair `pairs-data` roots + `archive-YYYY`.

> **Note (2026-01)**
> For **production** RS archive backfill, prefer the RS-native backfill endpoint `recomputeRsBackfillAdmin` (see `RS_ARCHIVE_BACKFILL.md §10`). `recomputeRegisteredBackfill` is retained as a legacy endpoint and is the recommended choice for emulator rebuilds and other local workflows.

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

## 4. Backfill Signals, Positions, and Activity in Emulator

Once archives are correct, use `backfillSignalsPipelineAdmin` (HTTP admin endpoint) to rebuild canonical per‑pair signals/positions **and** Signals Activity (per‑pair + root).

### 4.1 Recommended: full‑history backfill per pair (single contiguous window)

To keep DAILY/WEEKLY/MONTHLY open/close state consistent across year boundaries, always run backfill over a **single contiguous `[from,to]` window per environment**, rather than year‑sharded or disjoint windows.

Typical full‑history run for all registered pairs:

```powershell
$TOKEN = "local-admin"

$from = "2019-01-01"                        # earliest archive date to include
$to   = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')

$body = @{
  from      = $from
  to        = $to
  phase     = "post"                         # canonical engine phase (POST is default)
  intervals = @("DAILY","WEEKLY","MONTHLY")  # explicit for clarity; defaults to all three
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5002/rel-str/us-central1/backfillSignalsPipelineAdmin" `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body $body
```

**Important:**

- The canonical RS engine tracks open/close state in‑memory per run. Running multiple backfills on disjoint windows (e.g. `2019–2020`, then `2021–2025`) can leave positions that opened in an earlier window and should close in a later window permanently open.
- For subsequent backfills (e.g. after repairing archive gaps), either:
  - reuse the same `$from` date (e.g. `2019-01-01`) and rerun the full window, or
  - choose a `$from` that predates any potential open positions you care about closing.

### 4.2 Smaller patch window (rare)

Only use a narrow `[from,to]` window when you are certain that **all** opens and closes affected by the change fall inside that window (for example, after a very recent archive repair).

```powershell
$TOKEN = "local-admin"

$body = @{
  from   = "2025-11-10"
  to     = "2025-11-25"
  phase  = "post"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5002/rel-str/us-central1/backfillSignalsPipelineAdmin" `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body $body
```

Backfill responsibilities (current pipeline):

- Reads `pairs-data/{PAIR}/archive-YYYY/*` and reconstructs RS series for DAILY/WEEKLY/MONTHLY via the canonical RS engine.
- Writes canonical per‑pair signals:
  - `pairs-data/{PAIR}/signals/{YYYY}/opens/{signalId}`
  - `pairs-data/{PAIR}/signals/{YYYY}/closes/{signalId}`
- Writes/updates root positions:
  - `positions/open/items/{positionId}`
  - `positions/{YYYY}-closed/items/{positionId}`
- Writes Signals Activity per pair:
  - `pairs-data/{PAIR}/signals-activity/{YYYY}/days/{YYYY-MM-DD}`
- Writes root Signals Activity mirror:
  - `signals-activity/{YYYY}/days/{YYYY-MM-DD}`

Legacy daily-only mirror collections are deprecated and are **not** rebuilt by this pipeline.

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

## 6. Optional: Local Daily Refresh Script for Emulator

Since emulators do not support Cloud Scheduler, use a local PowerShell script + Windows Task Scheduler to keep emulator data fresh.

### 6.1 Running the refresh script

- Location: `scripts/refresh-emulator-rs.ps1` in the repo root.
- Preconditions:
  - Firebase emulators are running for **functions + firestore** (see section 1).
  - Functions emulator is listening on `http://127.0.0.1:5002/rel-str/us-central1`.
  - Admin backfill token is `local-admin` (script uses `$TOKEN = "local-admin"`).

From the project root (`C:\aa\projects\rel-str`):

```powershell
PS C:\aa\projects\rel-str> .\scripts\refresh-emulator-rs.ps1
```

This will:
- Refresh archives for the last ~20 days via `recomputeRegisteredBackfill`.
- Backfill signals/positions/signals-activity for the same `[from,to]` window via `backfillSignalsPipelineAdmin`.

You can optionally schedule this script via Windows Task Scheduler to run once per day while emulators are running. This keeps the emulator’s archives + signals/positions approximately current using the existing production backfill paths.

### 6.2 Script Example

```powershell
$TOKEN = "local-admin"

# 1) Refresh archives for recent days
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

# 2) Backfill signals/positions/activity for same window

$bodyBackfill = @{
  from   = $from
  to     = $today
  phase  = "post"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5002/rel-str/us-central1/backfillSignalsPipelineAdmin" `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body $bodyBackfill
