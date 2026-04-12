# RS-BE-FEAT-HMSNAP-2602 – Backend Heatmap Snapshots for Dashboard v3

> **⚠️ ARCHITECTURE UPDATE (Feb 2026)**
>
> The original "viewport" concept (60-period rolling window docs) has been **superseded** by a simpler **historical/current shard** approach. This eliminates the complexity of maintaining separate viewport and historical documents with daily boundary alignment.
>
> **Current approach**: Time-sharded historical documents extending to the current trading day. Frontend loads all shards in parallel for fast complete timeline rendering.
>
> **Production Data Set (Mar 2026)**: The current heatmap snapshot collection represents the live production data set, fully integrated with the realtime RS pipeline. No backfilling should be needed for either `archive-*` or `heatmap-snapshots` collections going forward.

---

## 1. Overview

- **Goal**
  - Provide **precomputed RS heatmap snapshots** per baseline and timeframe to support the `dashboard-v3` heatmap UI at production universe sizes (500+ pairs).
  - This document is the **backend counterpart** to the FE epic:
    - `RS-FE-FEAT-HMUI-2602 – Dashboard v3 Heatmap UI: Sort, Filter, and Render Treatments`.
- **Scope**
  - Cloud Functions + Firestore data model for heatmap snapshots.
  - Integration with existing RS calc / backfill pipeline.
  - Does **not** cover FE rendering or state management; those remain in the FE doc.

---

## 2. Architecture Overview

The heatmap snapshot system uses **time-sharded historical documents** that extend from 2019 to the current trading day. There are no separate "viewport" documents—instead, the most recent historical shard serves as the current data source and is updated daily/weekly/monthly.

**Key benefits**:
- ✅ No viewport/historical boundary alignment complexity
- ✅ Simpler FE logic (single doc type, continuous timeline)
- ✅ Simpler BE maintenance (just extend current shard daily)
- ✅ Parallel loading (all shards loaded simultaneously)
- ✅ Fast first load (~500-650ms for complete history)
- ✅ Instant cached loads (~0ms)

---

## 3. Document Schema

```ts
interface HeatmapSnapshotV2 {
  baseline: string;                   // e.g. 'SPY', 'QQQ', 'XME'
  timeframe: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  updatedAt: FirebaseFirestore.Timestamp;
  
  // Time range covered by this shard
  dateRange: {
    from: string;                     // Shard start date (ISO, e.g., '2025-07-01')
    to: string;                       // Shard end date (ISO, current trading day for rolling shards)
  };
  
  // Row order (pairs)
  pairs: string[];                    // canonical BASE-TARG ids, e.g. 'SPY-AAPL'
  
  // Column order (dates) – all dates from `from` to `to`
  dates: string[];                    // canonical Y-M-D keys in ascending order
  
  // RS metric values per pair
  rows: Array<{
    pair: string;                     // should match an entry in `pairs`
    values: number[];                 // aligned to `dates` by index
  }>;
  
  version: 2;
  shardType: 'historical' | 'current'; // 'current' = rolling shard updated daily/weekly/monthly
  shardId: string;                     // e.g. '2026-H1', '2025-2026', '2023-2026'
}
```

---

## 4. Sharding Strategy

#### DAILY Timeframe
- **Shard size**: **6 calendar months per doc** (safe margin under 1MB Firestore limit)
- **Naming convention**: `{baseline}-DAILY-{year}-H{1|2}`
  - `H1` = January–June
  - `H2` = July–December
- **Example shards (as of Mar 2026)**:
  - Immutable: `SPY-DAILY-2019-H1`, `SPY-DAILY-2019-H2`, ..., `SPY-DAILY-2025-H2`
  - Current: `SPY-DAILY-2026-H1` (Jan 1, 2026 → current trading day, updated nightly)
- **Size estimate**: ~500 KB per shard (500 pairs × 126 dates)
- **Total per baseline**: 15 shards (14 immutable + 1 current)

#### WEEKLY Timeframe
- **Shard size**: **2 calendar years per doc**
- **Naming convention**: `{baseline}-WEEKLY-{yearStart}-{yearEnd}`
- **Bucket logic**: Groups trading days by ISO week, uses **latest trading day** in each week as the bucket label (no calculated Fridays)
- **Example shards (as of Mar 2026)**:
  - Immutable: `SPY-WEEKLY-2019-2020`, `SPY-WEEKLY-2021-2022`, `SPY-WEEKLY-2023-2024`, `SPY-WEEKLY-2025-2026`
  - Current: None (2025-2026 covers current data through 2026)
- **Size estimate**: ~350 KB per shard (500 pairs × 104 weeks)
- **Total per baseline**: 4 shards (all historical, 2025-2026 extends to current week)

#### MONTHLY Timeframe
- **Shard size**: **4 calendar years per doc**
- **Naming convention**: `{baseline}-MONTHLY-{yearStart}-{yearEnd}`
- **Bucket logic**: Groups trading days by month (YYYY-MM), uses **latest trading day** in each month as the bucket label (no calculated month-end dates)
- **Example shards (as of Mar 2026)**:
  - Immutable: `SPY-MONTHLY-2019-2022`
  - Current: `SPY-MONTHLY-2023-2026` (Jan 2023 → current month, updated monthly)
- **Size estimate**: ~160 KB per shard (500 pairs × 48 months)
- **Total per baseline**: 2 shards (1 immutable + 1 current)

---

## 5. Shard Lifecycle

#### Immutable Historical Shards
- **Created**: One-time backfill for completed time periods (e.g., 2019-H1, 2020-H2)
- **Updated**: Never (frozen once time period ends)
- **Purpose**: Provide historical data for scroll-back

#### Current Rolling Shards
- **Created**: At start of new time period (e.g., Jan 1, 2026 for `2026-H1`)
- **Updated**: 
  - DAILY: Nightly (extends by 1 trading day)
  - WEEKLY: Weekly (extends by 1 week)
  - MONTHLY: Monthly (extends by 1 month)
- **Finalized**: At end of time period (e.g., June 30 for H1, Dec 31 for H2)
- **Purpose**: Provide current data extending to today

#### Finalization Process

When a time period ends (e.g., June 30, 2026 for H1):
1. Final update to current shard (e.g., `SPY-DAILY-hist-2026-H1` with dates through June 30)
2. Mark shard as immutable (set `shardType: 'historical'`)
3. Create new current shard for next period (e.g., `SPY-DAILY-hist-2026-H2` starting July 1)

---

## 6. Frontend Integration

#### Loading Strategy

The FE uses a **single-phase parallel loading** approach:

**All Shards Loaded in Parallel**
1. Fetch **all shard doc IDs** for the baseline and timeframe (current + historical)
2. Load all shards in parallel using `Promise.all`
3. Merge shards chronologically into continuous timeline (2019 → current day)
4. Cache merged result for instant subsequent loads
5. Render complete heatmap

**Performance**:
- **First load**: ~500-650ms (all shards in parallel)
- **Cached load**: ~0ms (instant from cache)
- **Cache invalidation**: Per baseline/timeframe on data updates

#### Example FE Flow (TypeScript)

```typescript
async function loadHeatmapData(baseline: string, timeframe: string) {
  // Check cache first
  const cached = cacheService.get(baseline, timeframe);
  if (cached) {
    renderHeatmap(cached);
    return cached;
  }
  
  // Get all shard doc IDs (current + historical)
  const shardIds = getAllShardDocIds(baseline, timeframe);
  const allDocIds = [shardIds.current, ...shardIds.historical];
  
  // Load all shards in parallel
  const shardPromises = allDocIds.map(docId => loadShard(docId));
  const shards = (await Promise.all(shardPromises)).filter(s => s !== null);
  
  // Merge shards chronologically
  const timeline = mergeShards(shards);
  
  // Cache for instant subsequent loads
  cacheService.set(baseline, timeframe, timeline);
  
  // Render complete heatmap
  renderHeatmap(timeline);
  return timeline;
}
```

---

## 7. Pipeline Integration

**Realtime Updates**: Heatmap snapshots are automatically updated after each realtime RS run completes. The integration flow:

1. **RS Job Worker** (`rs-time-series-jobs.worker.ts`) completes processing all pairs for a given interval
2. **Trigger Function** (`triggerHeatmapUpdatesForBaselines`) is called with the interval and affected baselines
3. **Cloud Tasks Enqueued**: One task per baseline is enqueued to `updateHeatmapSnapshotTask` queue
4. **Snapshot Generation**: Each task rebuilds the current shard for that baseline/timeframe
5. **Firestore Write**: Updated shard document is written to `heatmap-snapshots/{docId}`

**Data Source**: All heatmap snapshots read from `archive-{year}` subcollections under `pair-registry/{baseline}-{target}`. No separate data pipeline needed.

**Frequency**:
- **All timeframes (DAILY, WEEKLY, MONTHLY)**: Updated nightly after market close
- Each `partner-data-ready` POST phase message includes all intervals (DAILY, WEEKLY, MONTHLY)
- Heatmap updates are triggered for each interval after the RS job worker completes processing
- This ensures WEEKLY and MONTHLY shards always reflect the latest trading day, not just period-end

---

## 8. Backend Implementation

#### Request Schema (Extended)

```ts
interface RebuildHeatmapSnapshotRequest {
  baseline: string;                   // e.g. 'SPY', 'QQQ', 'XME'
  timeframe: string;                  // 'DAILY' | 'WEEKLY' | 'MONTHLY'
  snapshotType: 'historical' | 'current'; // Type of shard to generate
  
  // For DAILY shards
  year?: number;                      // e.g. 2026
  half?: 1 | 2;                       // H1 (Jan-Jun) or H2 (Jul-Dec)
  
  // For WEEKLY/MONTHLY shards
  yearStart?: number;                 // e.g. 2025
  yearEnd?: number;                   // e.g. 2026
}
```

#### Document ID Generation

```typescript
function getDocId(baseline: string, timeframe: string, params: any): string {
  if (timeframe === 'DAILY') {
    const { year, half } = params;
    return `${baseline}-DAILY-${year}-H${half}`;
  }
  
  const { yearStart, yearEnd } = params;
  return `${baseline}-${timeframe}-${yearStart}-${yearEnd}`;
}

// Examples:
// DAILY: 'SPY-DAILY-2026-H1'
// WEEKLY: 'SPY-WEEKLY-2025-2026'
// MONTHLY: 'SPY-MONTHLY-2023-2026'
```

---

## 8. One-Time Historical Backfill

Generate all immutable historical shards for all baselines covering 2019 through the end of the previous time period.

### Current Baseline Universe

As of Feb 2026, the system supports the following baselines:

**Index Baselines**:
- `SPY` - S&P 500 ETF
- `QQQ` - Nasdaq 100 ETF

**Sector Baselines**:
- `XLB` - Materials
- `XLC` - Communication Services
- `XLE` - Energy
- `XLF` - Financials
- `XLI` - Industrials
- `XLK` - Technology
- `XLP` - Consumer Staples
- `XLU` - Utilities
- `XLV` - Health Care
- `XLY` - Consumer Discretionary
- `XME` - Metals & Mining
- `XPH` - Pharmaceuticals
- `XSD` - Semiconductors

> **Source**: `src/app/features/services/baseline-registry.service.ts`

### DAILY Backfill (14 immutable shards per baseline)

Run in **PowerShell**:

```powershell
# Define all baselines (15 total)
$baselines = @('SPY', 'QQQ', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XME', 'XPH', 'XSD')

# Generate all DAILY historical shards (2019-H1 through 2025-H2)
foreach ($baseline in $baselines) {
  foreach ($year in 2019..2025) {
    foreach ($half in 1..2) {
      Invoke-RestMethod `
        -Method Post `
        -Uri "http://127.0.0.1:5002/rel-str/us-central1/rebuildHeatmapSnapshotAdmin" `
        -ContentType "application/json" `
        -Body (@{ 
          data = @{ 
            baseline = $baseline
            timeframe = 'DAILY'
            snapshotType = 'historical'
            year = $year
            half = $half
          } 
        } | ConvertTo-Json)
      
      Write-Host "Generated $baseline-DAILY-$year-H$half"
    }
  }
}
```

### WEEKLY Backfill (4 shards per baseline)

Run in **PowerShell**:

```powershell
# Define all baselines (15 total)
$baselines = @('SPY', 'QQQ', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XME', 'XPH', 'XSD')
$periods = @(
  @{ start = 2019; end = 2020 },
  @{ start = 2021; end = 2022 },
  @{ start = 2023; end = 2024 },
  @{ start = 2025; end = 2026 }
)

foreach ($baseline in $baselines) {
  foreach ($period in $periods) {
    Invoke-RestMethod `
      -Method Post `
      -Uri "http://127.0.0.1:5002/rel-str/us-central1/rebuildHeatmapSnapshotAdmin" `
      -ContentType "application/json" `
      -Body (@{ 
        data = @{ 
          baseline = $baseline
          timeframe = 'WEEKLY'
          yearStart = $period.start
          yearEnd = $period.end
        } 
      } | ConvertTo-Json)
    
    Write-Host "Generated $baseline-WEEKLY-$($period.start)-$($period.end)"
  }
}
```

### MONTHLY Backfill (1 immutable shard per baseline)

Run in **PowerShell**:

```powershell
# Define all baselines (15 total)
$baselines = @('SPY', 'QQQ', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XME', 'XPH', 'XSD')

foreach ($baseline in $baselines) {
  Invoke-RestMethod `
    -Method Post `
    -Uri "http://127.0.0.1:5002/rel-str/us-central1/rebuildHeatmapSnapshotAdmin" `
    -ContentType "application/json" `
    -Body (@{ 
      data = @{ 
        baseline = $baseline
        timeframe = 'MONTHLY'
        snapshotType = 'historical'
        yearStart = 2019
        yearEnd = 2022
      } 
    } | ConvertTo-Json)
  
  Write-Host "Generated $baseline-MONTHLY-2019-2022"
}
```

---

## 9. Daily Maintenance & Updates

### Integration with RS Pipeline

Heatmap snapshot updates are **integrated into the existing RS automatic update pipeline** rather than running as separate scheduled jobs. This ensures:

- ✅ Heatmap data is always in sync with RS data
- ✅ Updates only run after RS archives are written
- ✅ Single monitoring/logging pipeline
- ✅ No timing coordination issues
- ✅ Leverages existing Cloud Tasks infrastructure

### Update Flow

```
RS Backfill Trigger → RS Jobs Execute → RS Archives Written → Heatmap Snapshots Updated
```

**Implementation**: Heatmap snapshot generation is triggered as a post-processing step when RS jobs complete. The RS pipeline enqueues Cloud Tasks to update current shards for affected baselines.

### Daily Update Schedule

The RS pipeline runs **3 times daily**, and heatmap snapshots update after each run:

1. **Morning Update** (~6 AM ET): Pre-market RS update → Heatmap snapshots updated
2. **Midday Update** (~12 PM ET): Intraday RS update → Heatmap snapshots updated  
3. **Evening Update** (~11 PM ET): Post-market RS update → Heatmap snapshots updated

> **Note**: The exact timing depends on when upstream price data becomes available and RS jobs complete.

### Current Rolling Shards (Automated)

**DAILY shards** are updated automatically after each RS pipeline run (3× daily).

**Manual trigger** (for testing/emergency rebuilds) - Run in **PowerShell**:

```powershell
# Manual rebuild of current DAILY shard for all baselines
# Define all baselines (15 total)
$baselines = @('SPY', 'QQQ', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XME', 'XPH', 'XSD')
$today = Get-Date
$year = $today.Year
$half = if ($today.Month -le 6) { 1 } else { 2 }

foreach ($baseline in $baselines) {
  Invoke-RestMethod `
    -Method Post `
    -Uri "https://us-central1-rel-str.cloudfunctions.net/rebuildHeatmapSnapshotAdmin" `
    -ContentType "application/json" `
    -Body (@{ 
      data = @{ 
        baseline = $baseline
        timeframe = 'DAILY'
        snapshotType = 'current'
        year = $year
        half = $half
      } 
    } | ConvertTo-Json)
}
```

**WEEKLY shards** are updated automatically after RS pipeline runs that include weekly bucket updates.

**Manual trigger** (for testing/emergency rebuilds) - Run in **PowerShell**:

```powershell
# Manual rebuild of current WEEKLY shard for all baselines
# Define all baselines (15 total)
$baselines = @('SPY', 'QQQ', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XME', 'XPH', 'XSD')
$year = (Get-Date).Year
$nextYear = $year + 1

foreach ($baseline in $baselines) {
  Invoke-RestMethod `
    -Method Post `
    -Uri "https://us-central1-rel-str.cloudfunctions.net/rebuildHeatmapSnapshotAdmin" `
    -ContentType "application/json" `
    -Body (@{ 
      data = @{ 
        baseline = $baseline
        timeframe = 'WEEKLY'
        snapshotType = 'current'
        yearStart = $year
        yearEnd = $nextYear
      } 
    } | ConvertTo-Json)
}
```

**MONTHLY shards** are updated automatically after RS pipeline runs that include monthly bucket updates.

**Manual trigger** (for testing/emergency rebuilds) - Run in **PowerShell**:

```powershell
# Manual rebuild of current MONTHLY shard for all baselines
# Define all baselines (15 total)
$baselines = @('SPY', 'QQQ', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XME', 'XPH', 'XSD')

foreach ($baseline in $baselines) {
  Invoke-RestMethod `
    -Method Post `
    -Uri "https://us-central1-rel-str.cloudfunctions.net/rebuildHeatmapSnapshotAdmin" `
    -ContentType "application/json" `
    -Body (@{ 
      data = @{ 
        baseline = $baseline
        timeframe = 'MONTHLY'
        snapshotType = 'current'
        yearStart = 2023
        yearEnd = 2026
      } 
    } | ConvertTo-Json)
}
```

### Backend Integration Details

The RS pipeline triggers heatmap snapshot updates via Cloud Tasks:

```typescript
// Pseudo-code for RS pipeline integration
async function onRsJobComplete(jobId: string, affectedBaselines: string[]) {
  // After RS archives are written, enqueue heatmap snapshot tasks
  for (const baseline of affectedBaselines) {
    await enqueueTask({
      functionName: 'updateHeatmapSnapshotTask',
      payload: { 
        baseline, 
        timeframe: 'DAILY',  // Updated 3× daily
        snapshotType: 'current' 
      }
    });
    
    // WEEKLY and MONTHLY updated based on bucket changes
    if (shouldUpdateWeekly(jobId)) {
      await enqueueTask({
        functionName: 'updateHeatmapSnapshotTask',
        payload: { baseline, timeframe: 'WEEKLY', snapshotType: 'current' }
      });
    }
    
    if (shouldUpdateMonthly(jobId)) {
      await enqueueTask({
        functionName: 'updateHeatmapSnapshotTask',
        payload: { baseline, timeframe: 'MONTHLY', snapshotType: 'current' }
      });
    }
  }
}
```

> **Note**: The `rebuildHeatmapSnapshotAdmin` callable remains available for manual/emergency rebuilds but is **not** used for automated daily updates.

---

## 10. Monitoring & Logging

### Cloud Functions

Heatmap snapshot logs are emitted from the following Cloud Functions:

1. **`updateHeatmapSnapshotTask`** (Cloud Tasks worker)
   - Processes individual heatmap snapshot update tasks
   - Triggered by RS pipeline after realtime runs complete
   - Logs generation and write performance metrics

2. **`rebuildHeatmapSnapshotAdmin`** (Callable)
   - Manual/admin-triggered snapshot rebuilds
   - Used for backfills and emergency rebuilds
   - Not used for automated daily updates

3. **RS Pipeline Functions** (in `rs-time-series-jobs.worker.ts`)
   - `processRsJobTask` - Logs when heatmap updates are triggered
   - `updateRealtimeRunForJobTerminal` - Triggers heatmap updates after RS run completion

### Log Queries for Cloud Logs Explorer

#### 1. View All Heatmap Snapshot Updates (Last 24 Hours)

```
resource.type="cloud_function"
(resource.labels.function_name="updateHeatmapSnapshotTask" OR 
 resource.labels.function_name="rebuildHeatmapSnapshotAdmin")
severity>=INFO
timestamp>="2026-02-27T00:00:00Z"
```

#### 2. Monitor Heatmap Update Performance

```
resource.type="cloud_function"
resource.labels.function_name="updateHeatmapSnapshotTask"
jsonPayload.message="updateHeatmapSnapshotTask_success"
```

**Key metrics in logs:**
- `totalDurationMs` - End-to-end task duration
- `generateDurationMs` - Snapshot generation time
- `writeDurationMs` - Firestore write time
- `pairs` - Number of pairs in snapshot
- `dates` - Number of dates in snapshot

#### 3. Track RS Pipeline Heatmap Triggers

```
resource.type="cloud_function"
resource.labels.function_name="processRsJobTask"
jsonPayload.message=~"updateRealtimeRunForJobTerminal_heatmap"
```

**Shows:**
- `updateRealtimeRunForJobTerminal_heatmap_triggered` - When heatmap updates are enqueued
- `updateRealtimeRunForJobTerminal_heatmap_trigger_failed` - Enqueue failures

#### 4. Monitor Specific Baseline Updates

```
resource.type="cloud_function"
resource.labels.function_name="updateHeatmapSnapshotTask"
jsonPayload.baseline="SPY"
severity>=INFO
```

#### 5. Track Failed Heatmap Updates

```
resource.type="cloud_function"
resource.labels.function_name="updateHeatmapSnapshotTask"
(jsonPayload.message="updateHeatmapSnapshotTask_failed" OR severity>=ERROR)
```

**Error details include:**
- `message` - Error message
- `stack` - Stack trace
- `attemptNumber` - Retry attempt number
- `willRetry` - Whether Cloud Tasks will retry

#### 6. Monitor Document Size Warnings

```
resource.type="cloud_function"
jsonPayload.message="historical_shard_size_warning"
```

**Shows shards approaching 1MB Firestore limit**

#### 7. View Complete Heatmap Generation Flow

```
resource.type="cloud_function"
resource.labels.function_name="updateHeatmapSnapshotTask"
jsonPayload.baseline="SPY"
jsonPayload.timeframe="DAILY"
(jsonPayload.message=~"updateHeatmapSnapshotTask_start" OR
 jsonPayload.message=~"generateHistoricalShard" OR
 jsonPayload.message=~"updateHeatmapSnapshotTask_success")
```

**Trace complete flow:**
1. `updateHeatmapSnapshotTask_start` - Task begins
2. `generateHistoricalShard_start` - Generation starts
3. `generateHistoricalShard_registry_loaded` - Pairs loaded
4. `generateHistoricalShard_data_loaded` - RS data loaded
5. `generateHistoricalShard_complete` - Snapshot generated
6. `updateHeatmapSnapshotTask_success` - Written to Firestore

#### 8. Monitor Daily Update Batches

```
resource.type="cloud_function"
jsonPayload.message="triggerHeatmapUpdatesForBaselines_complete"
timestamp>="2026-02-27T00:00:00Z"
```

**Shows batch update summaries:**
- `totalBaselines` - Number of baselines updated
- `enqueuedCount` - Successfully enqueued tasks
- `failedCount` - Failed enqueues
- `durationMs` - Batch enqueue duration

#### 9. Track Retry Attempts

```
resource.type="cloud_function"
resource.labels.function_name="updateHeatmapSnapshotTask"
jsonPayload.attemptNumber>0
```

**Shows tasks that required retries**

#### 10. Performance Analysis Query

```
resource.type="cloud_function"
resource.labels.function_name="updateHeatmapSnapshotTask"
jsonPayload.message="updateHeatmapSnapshotTask_success"
jsonPayload.totalDurationMs>30000
```

**Identifies slow updates (>30 seconds)**

### Monitoring Best Practices

1. **Set up Log-Based Metrics** in Cloud Monitoring:
   - Counter for successful updates per baseline
   - Distribution for `totalDurationMs`
   - Counter for failed updates

2. **Create Alerts**:
   - Alert if `failedCount > 0` in `triggerHeatmapUpdatesForBaselines_complete`
   - Alert if any shard size warning appears
   - Alert if update duration exceeds threshold (e.g., 60 seconds)

3. **Dashboard Widgets**:
   - Heatmap updates per hour (by baseline)
   - Average generation time by timeframe
   - Error rate over time
   - Document size trends

### Expected Log Volume

- **Daily updates**: ~45 task executions per day (15 baselines × 3 daily RS runs)
- **Weekly updates**: ~15 task executions per week
- **Monthly updates**: ~15 task executions per month
- **Total**: ~50-60 heatmap snapshot updates per day

---

## 11. Shard Finalization (Semi-Annual/Annual)

At the end of each time period, finalize the current shard and create a new one:

#### DAILY Finalization (June 30 and December 31)

Run in **PowerShell**:

```powershell
# Run on June 30, 2026 to finalize H1
# Define all baselines (15 total)
$baselines = @('SPY', 'QQQ', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XME', 'XPH', 'XSD')

foreach ($baseline in $baselines) {
  # Final update to H1 (through June 30)
  Invoke-RestMethod `
    -Method Post `
    -Uri "https://us-central1-rel-str.cloudfunctions.net/rebuildHeatmapSnapshotAdmin" `
    -ContentType "application/json" `
    -Body (@{ 
      data = @{ 
        baseline = $baseline
        timeframe = 'DAILY'
        snapshotType = 'historical'  # Mark as immutable
        year = 2026
        half = 1
      } 
    } | ConvertTo-Json)
  
  # Create new H2 shard (starting July 1)
  Invoke-RestMethod `
    -Method Post `
    -Uri "https://us-central1-rel-str.cloudfunctions.net/rebuildHeatmapSnapshotAdmin" `
    -ContentType "application/json" `
    -Body (@{ 
      data = @{ 
        baseline = $baseline
        timeframe = 'DAILY'
        snapshotType = 'current'
        year = 2026
        half = 2
      } 
    } | ConvertTo-Json)
}
```

#### WEEKLY Finalization (End of even years, e.g., Dec 31, 2026)

Run in **PowerShell**:

```powershell
# Define all baselines (15 total)
$baselines = @('SPY', 'QQQ', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XME', 'XPH', 'XSD')

foreach ($baseline in $baselines) {
  # Finalize 2025-2026 shard
  Invoke-RestMethod `
    -Method Post `
    -Uri "https://us-central1-rel-str.cloudfunctions.net/rebuildHeatmapSnapshotAdmin" `
    -ContentType "application/json" `
    -Body (@{ 
      data = @{ 
        baseline = $baseline
        timeframe = 'WEEKLY'
        snapshotType = 'historical'
        yearStart = 2025
        yearEnd = 2026
      } 
    } | ConvertTo-Json)
  
  # Create new 2027-2028 shard
  Invoke-RestMethod `
    -Method Post `
    -Uri "https://us-central1-rel-str.cloudfunctions.net/rebuildHeatmapSnapshotAdmin" `
    -ContentType "application/json" `
    -Body (@{ 
      data = @{ 
        baseline = $baseline
        timeframe = 'WEEKLY'
        snapshotType = 'current'
        yearStart = 2027
        yearEnd = 2028
      } 
    } | ConvertTo-Json)
}
```

---

## 11. Storage & Performance Metrics

#### Document Counts (per baseline, as of Feb 2026)
- DAILY: 15 shards (14 immutable + 1 current)
- WEEKLY: 4 shards (3 immutable + 1 current)
- MONTHLY: 2 shards (1 immutable + 1 current)
- **Total per baseline: 21 docs**

#### Storage Estimates (15 baselines)
- DAILY: 15 shards × 500 KB × 15 baselines = **112.5 MB**
- WEEKLY: 4 shards × 350 KB × 15 baselines = **21 MB**
- MONTHLY: 2 shards × 160 KB × 15 baselines = **4.8 MB**
- **Total: ~138 MB** (negligible Firestore cost)

#### Load Performance (per baseline)
- **Initial load** (current shard): ~50 KB, ~100ms
- **Full history** (all shards): ~7 MB (DAILY), ~500ms
- **Time to first paint**: ~150ms
- **Time to full history**: ~650ms

---

## 12. Adding New Baselines

When adding a new baseline (e.g., `XLE`):

1. **Run one-time historical backfill** for all immutable shards (2019 through previous period)
2. **Generate current shard** for current period
3. **Add to nightly/weekly/monthly scheduler** for ongoing updates

```powershell
# Example: Add XLE baseline
$baseline = 'XLE'

# 1. Historical backfill (DAILY: 2019-H1 through 2025-H2)
foreach ($year in 2019..2025) {
  foreach ($half in 1..2) {
    Invoke-RestMethod -Method Post `
      -Uri "http://127.0.0.1:5002/rel-str/us-central1/rebuildHeatmapSnapshotAdmin" `
      -ContentType "application/json" `
      -Body (@{ data = @{ baseline = $baseline; timeframe = 'DAILY'; snapshotType = 'historical'; year = $year; half = $half } } | ConvertTo-Json)
  }
}

# 2. Current shard (2026-H1)
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:5002/rel-str/us-central1/rebuildHeatmapSnapshotAdmin" `
  -ContentType "application/json" `
  -Body (@{ data = @{ baseline = $baseline; timeframe = 'DAILY'; snapshotType = 'current'; year = 2026; half = 1 } } | ConvertTo-Json)

# 3. Add to scheduler (manual configuration update)
```

---

## 13. Bulk Deletion of Heatmap Snapshots

For cleanup, troubleshooting, or migration scenarios, the `deleteHeatmapSnapshotsAdmin` callable provides efficient server-side batch deletion of heatmap snapshot documents.

### Function Overview

**Cloud Function**: `deleteHeatmapSnapshotsAdmin`  
**Type**: Callable (admin-protected)  
**Region**: us-central1  
**Timeout**: 540 seconds  
**Memory**: 512 MiB

### Parameters

```typescript
interface DeleteHeatmapSnapshotsRequest {
  adminToken: string;      // Required: 'local-admin' for dev/prod
  baseline?: string;       // Optional: Filter by baseline (e.g., 'QQQ', 'SPY')
  dryRun?: boolean;       // Optional: Preview deletions without executing (default: false)
}
```

### Usage Examples

**Delete all QQQ snapshots (dry run)**:
```powershell
Invoke-RestMethod -Method Post -Uri "$base/deleteHeatmapSnapshotsAdmin" -Headers $headers -Body (@{
    data = @{
        adminToken = 'local-admin'
        baseline = 'QQQ'
        dryRun = $true
    }
} | ConvertTo-Json -Depth 5)
```

**Delete all QQQ snapshots (live)**:
```powershell
Invoke-RestMethod -Method Post -Uri "$base/deleteHeatmapSnapshotsAdmin" -Headers $headers -Body (@{
    data = @{
        adminToken = 'local-admin'
        baseline = 'QQQ'
        dryRun = $false
    }
} | ConvertTo-Json -Depth 5)
```

**Delete ALL heatmap snapshots (use with extreme caution)**:
```powershell
Invoke-RestMethod -Method Post -Uri "$base/deleteHeatmapSnapshotsAdmin" -Headers $headers -Body (@{
    data = @{
        adminToken = 'local-admin'
        dryRun = $false
    }
} | ConvertTo-Json -Depth 5)
```

### Response Format

```typescript
{
  ok: true,
  scanned: 335,           // Total docs examined
  deleted: 21,            // Docs deleted (or would be deleted in dry run)
  skipped: 314,           // Docs not matching filter
  dryRun: false,          // Whether this was a dry run
  durationMs: 8367,       // Execution time
  baselineFilter: 'QQQ'   // Applied filter (or 'ALL')
}
```

### Performance

- **Batch size**: 500 docs per Firestore batch write
- **Typical performance**: ~8-10 seconds for 300+ docs
- **Memory**: 512 MiB to handle full collection scan

### Common Use Cases

1. **Rebuild after schema changes**: Delete all docs for a baseline, then rebuild with updated logic
2. **Fix corrupted data**: Remove malformed docs before regenerating
3. **Baseline removal**: Clean up all snapshots when removing a baseline from the system
4. **Testing**: Clear test data between development iterations

> **See also**: Detailed usage documentation in `RS-BE-ADMIN-DELHM_delete-heatmap-snapshots-admin.md`

---

## 14. Migration from Viewport Docs (if applicable)

If viewport docs exist from the deprecated architecture:

1. **Generate all historical/current shards** using backfill scripts above
2. **Update FE** to use new progressive loading strategy
3. **Verify** new shards are loading correctly in production
4. **Stop** nightly viewport regeneration jobs
5. **Delete** old viewport docs (e.g., `SPY-DAILY-viewport`)

No data migration needed—historical/current shards are generated fresh from RS archives.

---

## 14. Implementation Tasks

Use the following task IDs in commit messages (format: `[HMSNAP-T##]`).

### Phase 1: Core Infrastructure

- [ ] **HMSNAP-T01: Extend rebuildHeatmapSnapshotAdmin for historical shards**
  - Add `snapshotType`, `year`, `half`, `yearStart`, `yearEnd` parameters to request schema
  - Implement document ID generation logic for historical shards
  - Add date range calculation for historical periods
  - Update function to handle both `historical` and `current` shard types
  - Add `shardType` and `shardId` fields to document schema (v2)

- [ ] **HMSNAP-T02: Implement historical shard generation logic**
  - Extend snapshot computation to support arbitrary date ranges (not just viewport)
  - Add logic to fetch RS archives for specified time periods
  - Implement 6-month (DAILY), 2-year (WEEKLY), 4-year (MONTHLY) shard boundaries
  - Add validation to prevent shard size from exceeding Firestore limits
  - Test with sample baseline to verify doc sizes stay under 1MB

- [ ] **HMSNAP-T03: Create one-time historical backfill scripts**
  - Create PowerShell script for DAILY backfill (2019-H1 through 2025-H2)
  - Create PowerShell script for WEEKLY backfill (2019-2020, 2021-2022, 2023-2024)
  - Create PowerShell script for MONTHLY backfill (2019-2022)
  - Add progress logging and error handling
  - Document execution instructions and estimated runtime

### Phase 2: RS Pipeline Integration

- [ ] **HMSNAP-T04: Integrate heatmap updates into RS pipeline**
  - Add heatmap snapshot task enqueuing to RS job completion handler
  - Implement `updateHeatmapSnapshotTask` Cloud Task worker
  - Add logic to determine affected baselines from RS job
  - Add conditional logic for WEEKLY/MONTHLY updates based on bucket changes
  - Wire up Cloud Tasks infrastructure for heatmap snapshot updates

- [ ] **HMSNAP-T05: Add monitoring and logging**
  - Add structured logging for heatmap snapshot generation (baseline, timeframe, duration, doc size)
  - Add error tracking and alerting for failed snapshot updates
  - Create Firestore metadata docs for tracking last successful update per baseline/timeframe
  - Add metrics to track snapshot generation performance
  - Document monitoring dashboard queries

### Phase 3: Finalization & Operations

- [ ] **HMSNAP-T06: Implement shard finalization workflow**
  - Create semi-annual finalization script for DAILY shards (June 30, Dec 31)
  - Create annual finalization script for WEEKLY shards (Dec 31 of even years)
  - Add logic to mark shards as immutable (`shardType: 'historical'`)
  - Add logic to create new current shard for next period
  - Document finalization schedule and procedures

- [ ] **HMSNAP-T07: Execute historical backfill for all baselines**
  - Run DAILY backfill for all 15 baselines (210 shards total)
  - Run WEEKLY backfill for all 15 baselines (45 shards total)
  - Run MONTHLY backfill for all 15 baselines (15 shards total)
  - Verify all shards are created correctly in Firestore
  - Validate doc sizes and data integrity

- [ ] **HMSNAP-T08: Update frontend to use progressive loading**
  - Implement current shard fetch logic in FE
  - Implement background historical shard fetch logic
  - Add shard merging logic for continuous timeline
  - Update heatmap rendering to use merged timeline
  - Add loading indicators for historical data fetch
  - Test rapid scroll-back performance

### Phase 4: Cleanup & Documentation

- [ ] **HMSNAP-T09: Clean up deprecated viewport docs (if applicable)**
  - Stop any existing viewport regeneration jobs
  - Verify new shard-based system is working in production
  - Delete old viewport docs from Firestore
  - Update any remaining references to viewport docs in code/docs

- [ ] **HMSNAP-T10: Production validation and handoff**
  - Verify all 15 baselines have complete shard coverage (2019–present)
  - Validate RS pipeline integration is triggering updates correctly
  - Confirm 3× daily updates are working
  - Document operational procedures for adding new baselines
  - Create runbook for common troubleshooting scenarios

---

## Task Dependencies

```
Phase 1 (Core Infrastructure):
  T01 → T02 → T03

Phase 2 (RS Pipeline Integration):
  T01, T02 → T04 → T05

Phase 3 (Finalization & Operations):
  T03 → T06
  T01, T02, T03 → T07
  T07 → T08

Phase 4 (Cleanup):
  T08 → T09 → T10
```

**Estimated Timeline**: 2-3 weeks for full implementation and backfill
