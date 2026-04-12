# RS-BE-FEAT-RTRUN-2603 Realtime Run Pipeline and Status Tracking

- **Status**: completed
- **Planning doc(s)**:
  - RS-BE-FEAT-FRBARR-2601-02 (job pipeline foundation)
  - RS-BE-FEAT-PDR-2601-01 (partner ingestion)
- **Area**: BE
- **Scope**: FEAT
- **Code**: RTRUN
- **Created**: 2026-03-09
- **Last updated**: 2026-03-09

## Intent

Document the realtime RS run pipeline that processes `partner-data-ready` Pub/Sub messages when `RS_REALTIME_TASKS_ENABLED=true`. This pipeline uses Cloud Tasks and Firestore run/job documents to process RS data updates asynchronously, with status tracking across two collections (`partner-events` and `rs-realtime-runs`) and automatic heatmap snapshot updates upon completion.

This doc addresses the architectural flow, status tracking lifecycle, and the relationship between `partner-events` (observability) and `rs-realtime-runs` (operational state).

## Architecture Overview

### High-Level Flow

```
partner-data-ready Pub/Sub message
  ↓
processDataReadyRunV2 (Cloud Function)
  ↓
Creates partner-events/{runId} (status: "processing")
Creates rs-realtime-runs/runs/{runId}-{interval} per interval
  ↓
Enqueues Cloud Tasks (one per pair × interval)
  ↓
processRsJobTask workers process jobs in parallel
  ↓
updateRealtimeRunForJobTerminal aggregates results
  ↓
Updates rs-realtime-runs (runStatus: COMPLETE/PARTIAL/FAILED)
Mirrors status to partner-events (status: "completed"/"completed_with_errors")
  ↓
Triggers heatmap snapshot updates for affected baselines
```

### Key Collections

1. **`partner-events/{runId}`** - Observability and dashboard-facing run summary
   - Created immediately when `processDataReadyRunV2` receives Pub/Sub message
   - Initial status: `"processing"`
   - Final status: `"completed"` or `"completed_with_errors"` (mirrored from `rs-realtime-runs`)
   - Contains: `runId`, `phase`, `intervals`, `pairCount`, `expectedJobs`, `successJobs`, `permanentFailureJobs`, `runStatus`, `runCompletedAt`, `errorSamples`

2. **`system/rs-realtime-runs/runs/{runId}-{interval}`** - Operational run state per interval
   - Created when `RS_REALTIME_TASKS_ENABLED=true`
   - Tracks aggregate job counts: `expectedJobs`, `successJobs`, `permanentFailureJobs`
   - Contains: `runStatus` (`IN_PROGRESS` → `COMPLETE`/`PARTIAL`/`FAILED`), `runFinishedAt`, `runCompletedAt`
   - One doc per interval (DAILY, WEEKLY, MONTHLY)

3. **`system/rs-realtime-runs/runs/{runId}-{interval}/jobs/{pairId}-{interval}-{phase}`** - Individual job state
   - Tracks per-pair, per-interval job execution
   - Status: `PENDING` → `IN_PROGRESS` → `SUCCESS`/`PERMANENT_FAILURE`
   - Contains: `attempts`, `lastError`, `lastAttemptAt`, `updatedAt`

## Status Tracking Lifecycle

### Phase 1: Initialization (processDataReadyRunV2)

When `RS_REALTIME_TASKS_ENABLED=true`:

1. **Create `partner-events/{runId}`**:
   ```typescript
   {
     status: "processing",
     runId: "2026-03-09-MON-A-DAILY-LIVE-POST-1635",
     phase: "post",
     intervals: ["DAILY", "WEEKLY", "MONTHLY"],
     pairCount: 414,
     expectedJobs: 1242, // 414 pairs × 3 intervals
     createdAt: serverTimestamp(),
     updatedAt: serverTimestamp()
   }
   ```

2. **Create `rs-realtime-runs/runs/{runId}-{interval}`** (one per interval):
   ```typescript
   {
     runId: "2026-03-09-MON-A-DAILY-LIVE-POST-1635",
     interval: "DAILY",
     runStatus: "IN_PROGRESS",
     expectedJobs: 414,
     successJobs: 0,
     permanentFailureJobs: 0,
     runStartedAt: serverTimestamp(),
     runDocUpdatedAt: serverTimestamp()
   }
   ```

3. **Enqueue Cloud Tasks** (one per pair × interval):
   - Queue: `processRsJobTask`
   - Payload: `{ jobType: "REALTIME", marketDate: "2026-03-09", pairId: "QQQ-AAPL", interval: "DAILY", phase: "post" }`

### Phase 2: Job Execution (processRsJobTask)

Each Cloud Task worker:

1. Updates job doc to `IN_PROGRESS`
2. Calls `runRsPairIntervalJob`:
   - Fetches bars from partner API
   - Computes RS series
   - Writes to `archive-{year}` collections with nested `post` field:
     ```typescript
     {
       day: "2026-03-09",
       dow: "MON",
       post: {
         base: { price: 607.76, change: 8.01, percentChange: 1.335556 },
         target: { price: 259.88, change: 2.42, percentChange: 0.939952 },
         rsNorm: 0.28125,
         rsRaw: 0.27647508444904706,
         source: "raw close"
       }
     }
     ```
3. Updates job doc to `SUCCESS` or `PERMANENT_FAILURE`
4. Calls `updateRealtimeRunForJobTerminal` to aggregate results

### Phase 3: Run Finalization (updateRealtimeRunForJobTerminal)

When all jobs for an interval complete (`successJobs + permanentFailureJobs >= expectedJobs`):

1. **Update `rs-realtime-runs/runs/{runId}-{interval}`**:
   ```typescript
   {
     runStatus: "COMPLETE" | "PARTIAL" | "FAILED",
     runFinishedAt: serverTimestamp(), // ← CRITICAL: Added in 2026-03-09 bug fix
     runCompletedAt: serverTimestamp(),
     runDocUpdatedAt: serverTimestamp()
   }
   ```

2. **Mirror status to `partner-events/{runId}`**:
   ```typescript
   {
     status: "completed" | "completed_with_errors", // ← CRITICAL: Added in 2026-03-09 bug fix
     runStatus: "COMPLETE" | "PARTIAL" | "FAILED",
     successJobs: 1239,
     permanentFailureJobs: 3,
     pairsProcessed: 1239,
     pairsFailed: 3,
     runCompletedAt: serverTimestamp(),
     updatedAt: serverTimestamp()
   }
   ```

3. **Trigger heatmap snapshot updates**:
   - Calls `triggerHeatmapUpdatesForBaselines(interval, baselines)`
   - Enqueues Cloud Tasks to `updateHeatmapSnapshotTask` queue
   - One task per baseline (e.g., QQQ, SPY, XLK, etc.)

## Archive Data Schema

### Daily Archives (`archive-{year}`)

All trading days stored with nested `post` field:

```typescript
// Document ID: YYMMDD (e.g., "260309")
{
  day: "2026-03-09",
  dow: "MON",
  post: {
    base: { price: number, change: number, percentChange: number },
    target: { price: number, change: number, percentChange: number },
    rsNorm: number,    // Normalized RS (0-1 scale)
    rsRaw: number,     // Raw RS ratio
    source: string     // "raw close" | "adjusted close"
  }
}
```

### Weekly Archives (`archive-weekly-{year}`)

One document per week (latest trading day of the week):

```typescript
// Document ID: YYMMDD of week-end day (e.g., "260307" for week ending Fri Mar 7)
{
  day: "2026-03-07",
  dow: "FRI",
  post: { /* same structure as daily */ }
}
```

### Monthly Archives (`archive-monthly-{year}`)

One document per month (latest trading day of the month):

```typescript
// Document ID: YYMMDD of month-end day (e.g., "260227" for Feb 27)
{
  day: "2026-02-27",
  dow: "FRI",
  post: { /* same structure as daily */ }
}
```

**Important**: WEEKLY and MONTHLY archives store **only the latest trading day** per period, not every day. This is by design to reduce storage costs and match bar semantics.

## Heatmap Update Trigger

Heatmap snapshots are automatically updated after each realtime run completes:

### Trigger Condition

The trigger fires in `updateRealtimeRunForJobTerminal` when:
1. All jobs for an interval complete: `(successJobs + permanentFailureJobs) >= expectedJobs`
2. Run transitions from `IN_PROGRESS` to terminal status (`COMPLETE`, `PARTIAL`, or `FAILED`)
3. `runFinishedAt` is set (critical for trigger logic)

### Trigger Flow

```typescript
// In updateRealtimeRunForJobTerminal (rs-time-series-jobs.worker.ts:754-787)
if (finalStatus !== 'IN_PROGRESS') {
  try {
    const baselines = await getAffectedBaselines(data.pairs);
    await triggerHeatmapUpdatesForBaselines(interval, baselines);
  } catch (e) {
    logger.warn('updateRealtimeRunForJobTerminal_heatmap_trigger_failed', {
      runId,
      interval,
      message: e?.message,
    });
  }
}
```

### Heatmap Rebuild Process

For each baseline (e.g., QQQ):
1. Cloud Task enqueued to `updateHeatmapSnapshotTask`
2. Task calls `generateShardSnapshot` with date range:
   - DAILY 2026-H1: `from: "2026-01-01"`, `to: today` (dynamic)
   - WEEKLY 2026-2027: `from: "2026-01-01"`, `to: today`
   - MONTHLY 2023-2026: `from: "2023-01-01"`, `to: today`
3. Queries `archive-{year}` collections for all pairs in baseline
4. Builds heatmap matrix with all dates in range (backfills missing dates automatically)
5. Writes to `heatmap-snapshots/{baseline}-{timeframe}-{shardId}`

**Key Insight**: Heatmap rebuilds use **dynamic date ranges** (`to: today`), so they automatically backfill any missing dates from previous runs. If a run fails to trigger heatmap updates, the next successful run will include all missing dates.

## Environment Flags

### `RS_REALTIME_TASKS_ENABLED`

Controls whether realtime runs use Cloud Tasks or legacy inline processing:

- **`true` (production)**: Uses Cloud Tasks pipeline described in this doc
  - Creates `rs-realtime-runs` docs
  - Enqueues jobs to `processRsJobTask` queue
  - Status mirrored to `partner-events` by `updateRealtimeRunForJobTerminal`
  
- **`false` (legacy/emulator)**: Inline processing in `processDataReadyRunV2`
  - No `rs-realtime-runs` docs created
  - All pair processing happens in HTTP handler
  - `partner-events` updated directly in `processDataReadyRunV2`

**Recommendation**: Always use `true` in production for scalability and observability.

## Known Issues and Fixes

### 2026-03-09: Status Tracking Bug

**Issue**: `partner-events` documents stuck in `"processing"` status indefinitely, heatmap snapshots not updating.

**Root Cause**: Two missing fields in `updateRealtimeRunForJobTerminal`:
1. `runFinishedAt` not set on `rs-realtime-runs` final update
2. `status` field not set on `partner-events` mirror

**Impact**:
- Dashboards showed runs as perpetually in-progress
- Heatmap update trigger never fired (depends on `runFinishedAt` being set)
- Archive data was written correctly, but not reflected in heatmaps

**Fix** (committed 2026-03-09):
```typescript
// rs-time-series-jobs.worker.ts:704-709
const finalUpdate: UpdateData<RsRealtimeRunDoc> = {
  runStatus: finalStatus,
  runFinishedAt: FieldValue.serverTimestamp(), // ← ADDED
  runCompletedAt: FieldValue.serverTimestamp(),
  runDocUpdatedAt: FieldValue.serverTimestamp(),
} as any;

// rs-time-series-jobs.worker.ts:729-738
const eventPatch: Record<string, any> = {
  status: failure > 0 ? 'completed_with_errors' : 'completed', // ← ADDED
  runStatus: backfillStyleStatus,
  successJobs: success,
  permanentFailureJobs: failure,
  pairsProcessed: success,
  pairsFailed: failure,
  runCompletedAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
};
```

**Verification**:
- After deploying fix, next run should set both fields
- `partner-events` should show terminal `status`
- Heatmap snapshots should update with all dates (including backfilled dates from failed runs)

## Implementation References

### Key Files

- **`functions/src/webhooks/partner-webhooks.ts`**
  - `processDataReadyRunV2` - Pub/Sub subscriber and run initialization
  - Creates `partner-events` and `rs-realtime-runs` docs
  - Enqueues Cloud Tasks when `RS_REALTIME_TASKS_ENABLED=true`

- **`functions/src/rs/time-series/rs-time-series-jobs.worker.ts`**
  - `processRsJobTask` - Cloud Tasks worker entrypoint
  - `processRsJobInternal` - Job execution and status updates
  - `updateRealtimeRunForJobTerminal` - Run finalization and heatmap trigger
  - `runRsPairIntervalJob` - Core RS computation and archive writing

- **`functions/src/rs/heatmap/heatmap-snapshots.ts`**
  - `triggerHeatmapUpdatesForBaselines` - Enqueues heatmap update tasks
  - `updateHeatmapSnapshotTask` - Cloud Tasks worker for heatmap rebuilds
  - `generateShardSnapshot` - Builds heatmap matrix from archive data

- **`functions/src/webhooks/pairs-writer.ts`**
  - `writeUnifiedSeries` - Writes RS data to archive collections
  - Implements WEEKLY/MONTHLY month-end snapshot logic

### Related Documentation

- `RS-BE-FEAT-FRBARR-2601-02_full-rs-backfill-and-realtime-refresh.md` - Job pipeline foundation
- `RS-BE-FEAT-HMSNAP-2602_backend-heatmap-snapshots-for-dashboard-v3.md` - Heatmap snapshot implementation
- `partner-data-ready-pubsub-integration.md` - Pub/Sub integration guide
- `partner-data-ready-troubleshooting.md` - Operational troubleshooting guide

## Testing and Validation

### Emulator Testing

1. Start emulators: `npm run emulators:start`
2. Create Pub/Sub topic: `npm run pubsub:topic`
3. Seed pair registry: `curl -X POST http://127.0.0.1:5002/rel-str/us-central1/seedPairRegistryManual`
4. Publish data-ready message: `npm run pubsub:run`
5. Verify in Firestore emulator UI:
   - `partner-events/{runId}` transitions from `"processing"` to `"completed"`
   - `system/rs-realtime-runs/runs/{runId}-DAILY` shows `runStatus: "COMPLETE"`
   - `pairs-data/{pairId}/archive-2026/{YYMMDD}` contains `post` field with RS data
   - `heatmap-snapshots/{baseline}-DAILY-2026-H1` updated with latest dates

### Production Verification

```bash
# Check partner-events status
firebase firestore:get partner-events/2026-03-09-MON-A-DAILY-LIVE-POST-1635

# Check rs-realtime-runs status
firebase firestore:get system/rs-realtime-runs/runs/2026-03-09-MON-A-DAILY-LIVE-POST-1635-DAILY

# Verify archive data for a sample pair
firebase firestore:get pairs-data/QQQ-AAPL/archive-2026/260309

# Check heatmap snapshot dates
firebase firestore:get heatmap-snapshots/QQQ-DAILY-2026-H1
```

### Cloud Logs Queries

```
# Monitor run completion
resource.type="cloud_function"
jsonPayload.message="updateRealtimeRunForJobTerminal_complete"
timestamp>="2026-03-09T00:00:00Z"

# Check heatmap trigger
resource.type="cloud_function"
jsonPayload.message="updateRealtimeRunForJobTerminal_heatmap_triggered"

# Monitor job failures
resource.type="cloud_function"
jsonPayload.message="processRsJobInternal_permanent_failure"
```

## Future Enhancements

- [ ] Add retry logic for transient partner API failures
- [ ] Implement partial run recovery (resume from last successful job)
- [ ] Add metrics/monitoring for job queue depth and processing latency
- [ ] Consider splitting large runs into smaller batches for better parallelism
- [ ] Add admin function to manually trigger heatmap updates for specific dates/baselines
