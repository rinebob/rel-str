# RS-BE-FEAT-HMSNAP-2602 – Backend Heatmap Snapshots for Dashboard v3

> **⚠️ ARCHITECTURE UPDATE (Feb 2026)**
>
> The original "viewport" concept (60-period rolling window docs) has been **superseded** by a simpler **historical/current shard** approach. This eliminates the complexity of maintaining separate viewport and historical documents with daily boundary alignment.
>
> **Current approach**: Time-sharded historical documents extending to the current trading day, with progressive loading on the frontend (current shard first, then historical shards in background).

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
- ✅ Progressive loading (current shard first, historical in background)
- ✅ Fast first paint (~150ms for current data)

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
- **Naming convention**: `{baseline}-DAILY-hist-{year}-H{1|2}`
  - `H1` = January–June
  - `H2` = July–December
- **Example shards (as of Feb 2026)**:
  - Immutable: `SPY-DAILY-hist-2019-H1`, `SPY-DAILY-hist-2019-H2`, ..., `SPY-DAILY-hist-2025-H2`
  - Current: `SPY-DAILY-hist-2026-H1` (Jan 1, 2026 → current trading day, updated nightly)
- **Size estimate**: ~500 KB per shard (500 pairs × 126 dates)
- **Total per baseline**: 15 shards (14 immutable + 1 current)

#### WEEKLY Timeframe
- **Shard size**: **2 calendar years per doc**
- **Naming convention**: `{baseline}-WEEKLY-hist-{yearStart}-{yearEnd}`
- **Example shards (as of Feb 2026)**:
  - Immutable: `SPY-WEEKLY-hist-2019-2020`, `SPY-WEEKLY-hist-2021-2022`, `SPY-WEEKLY-hist-2023-2024`
  - Current: `SPY-WEEKLY-hist-2025-2026` (Jan 2025 → current week, updated weekly)
- **Size estimate**: ~350 KB per shard (500 pairs × 104 weeks)
- **Total per baseline**: 4 shards (3 immutable + 1 current)

#### MONTHLY Timeframe
- **Shard size**: **4 calendar years per doc**
- **Naming convention**: `{baseline}-MONTHLY-hist-{yearStart}-{yearEnd}`
- **Example shards (as of Feb 2026)**:
  - Immutable: `SPY-MONTHLY-hist-2019-2022`
  - Current: `SPY-MONTHLY-hist-2023-2026` (Jan 2023 → current month, updated monthly)
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

#### Progressive Loading Strategy

The FE uses a **two-phase loading** approach for optimal UX:

**Phase 1: Fast First Paint (~150ms)**
1. Fetch **current shard** (e.g., `SPY-DAILY-hist-2026-H1`)
2. If current shard has < 60 periods, also fetch **previous shard** (e.g., `SPY-DAILY-hist-2025-H2`)
3. Merge and render immediately (user sees current data)

**Phase 2: Background Historical Load (~500ms)**
4. Fetch all **historical shards** in parallel (e.g., `hist-2019-H1` through `hist-2025-H2`)
5. Merge into continuous timeline (2019 → current day)
6. Update UI (scrollbar extends, historical data available)

**Total time to full history**: ~650ms (fast first paint + background load)

#### Example FE Flow (TypeScript)

```typescript
async function loadHeatmapData(baseline: string, timeframe: string) {
  // Phase 1: Current data (blocking)
  const currentShardId = getCurrentShardId(baseline, timeframe, new Date());
  const currentShard = await fetchShard(currentShardId);
  
  let recentShards = [currentShard];
  if (currentShard.dates.length < 60) {
    const prevShardId = getPreviousShardId(currentShardId);
    const prevShard = await fetchShard(prevShardId);
    recentShards = [prevShard, currentShard];
  }
  
  // Render with current data (fast first paint)
  const recentTimeline = mergeShards(recentShards);
  renderHeatmap(recentTimeline);
  
  // Phase 2: Historical data (non-blocking)
  const historicalShardIds = getHistoricalShardIds(baseline, timeframe, currentShardId);
  const historicalShards = await Promise.all(historicalShardIds.map(fetchShard));
  
  // Merge and update (seamless transition)
  const fullTimeline = mergeShards([...historicalShards, ...recentShards]);
  updateHeatmap(fullTimeline);
}
```

---

## 7. Backend Implementation

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
    return `${baseline}-DAILY-hist-${year}-H${half}`;
  }
  
  const { yearStart, yearEnd } = params;
  return `${baseline}-${timeframe}-hist-${yearStart}-${yearEnd}`;
}

// Examples:
// DAILY: 'SPY-DAILY-hist-2026-H1'
// WEEKLY: 'SPY-WEEKLY-hist-2025-2026'
// MONTHLY: 'SPY-MONTHLY-hist-2023-2026'
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
      
      Write-Host "Generated $baseline-DAILY-hist-$year-H$half"
    }
  }
}
```

### WEEKLY Backfill (3 immutable shards per baseline)

Run in **PowerShell**:

```powershell
# Define all baselines (15 total)
$baselines = @('SPY', 'QQQ', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XME', 'XPH', 'XSD')
$periods = @(
  @{ start = 2019; end = 2020 },
  @{ start = 2021; end = 2022 },
  @{ start = 2023; end = 2024 }
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
          snapshotType = 'historical'
          yearStart = $period.start
          yearEnd = $period.end
        } 
      } | ConvertTo-Json)
    
    Write-Host "Generated $baseline-WEEKLY-hist-$($period.start)-$($period.end)"
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
  
  Write-Host "Generated $baseline-MONTHLY-hist-2019-2022"
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

## 10. Shard Finalization (Semi-Annual/Annual)

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

## 13. Migration from Viewport Docs (if applicable)

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
