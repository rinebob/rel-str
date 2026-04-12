# Partner Data-Ready Pipeline Troubleshooting Guide

This guide provides operational procedures for diagnosing and resolving issues with the `partner-data-ready` → RS realtime run pipeline.

## Quick Diagnostics

### Check Run Status

```bash
# Get partner-events status
firebase firestore:get partner-events/{runId}

# Get rs-realtime-runs status for a specific interval
firebase firestore:get system/rs-realtime-runs/runs/{runId}-DAILY

# List recent partner-events
firebase firestore:query partner-events --order-by createdAt --limit 10
```

### Verify Archive Data

```bash
# Check if archive data was written for a sample pair
firebase firestore:get pairs-data/QQQ-AAPL/archive-2026/{YYMMDD}

# List all archive docs for a pair
firebase firestore:query pairs-data/QQQ-AAPL/archive-2026 --order-by day --limit 20
```

### Check Heatmap Snapshots

```bash
# Get current shard for a baseline
firebase firestore:get heatmap-snapshots/QQQ-DAILY-2026-H1

# Check last update time
firebase firestore:get heatmap-snapshots/QQQ-DAILY-2026-H1 --field updatedAt
```

## Common Issues

### Issue 1: partner-events Stuck in "processing" Status

**Symptoms:**
- `partner-events/{runId}` has `status: "processing"` indefinitely
- `rs-realtime-runs` shows jobs completed but no terminal status
- Heatmap snapshots not updating

**Root Cause:**
Missing `status` field in `partner-events` mirror or missing `runFinishedAt` in `rs-realtime-runs`.

**Diagnosis:**

```bash
# Check partner-events status
firebase firestore:get partner-events/{runId}

# Check rs-realtime-runs completion
firebase firestore:get system/rs-realtime-runs/runs/{runId}-DAILY

# Look for these fields:
# - partner-events: status (should be "completed" or "completed_with_errors")
# - rs-realtime-runs: runFinishedAt (should be a timestamp)
```

**Resolution:**

1. **Verify fix is deployed**: Check that `rs-time-series-jobs.worker.ts` includes:
   - Line 706: `runFinishedAt: FieldValue.serverTimestamp()`
   - Line 730: `status: failure > 0 ? 'completed_with_errors' : 'completed'`

2. **Wait for next run**: The fix only affects future runs. Next successful run will:
   - Set proper terminal status
   - Trigger heatmap updates
   - Backfill missing dates automatically

3. **Manual fix (if urgent)**: Update `partner-events` doc manually:
   ```bash
   firebase firestore:set partner-events/{runId} \
     --merge \
     '{"status": "completed", "updatedAt": {"_seconds": 1234567890}}'
   ```

### Issue 2: Heatmap Snapshots Missing Recent Dates

**Symptoms:**
- Heatmap snapshot exists but `dates` array doesn't include today
- `updatedAt` timestamp is stale (more than 1 day old)
- Archive data exists for the missing dates

**Root Cause:**
Heatmap update trigger didn't fire due to status tracking bug or Cloud Tasks failure.

**Diagnosis:**

```bash
# Check heatmap snapshot dates
firebase firestore:get heatmap-snapshots/QQQ-DAILY-2026-H1

# Compare with archive data
firebase firestore:query pairs-data/QQQ-AAPL/archive-2026 \
  --order-by day desc --limit 5

# Check Cloud Logs for heatmap trigger
gcloud logging read \
  'resource.type="cloud_function"
   jsonPayload.message="triggerHeatmapUpdatesForBaselines_complete"
   timestamp>="2026-03-09T00:00:00Z"' \
  --limit 10 --format json
```

**Resolution:**

1. **Verify next run will backfill**: Heatmap rebuilds use dynamic date ranges, so the next successful run will include all missing dates.

2. **Manual trigger (if urgent)**: Call `rebuildHeatmapSnapshotAdmin`:
   ```bash
   curl -X POST https://us-central1-rel-str.cloudfunctions.net/rebuildHeatmapSnapshotAdmin \
     -H "Content-Type: application/json" \
     -d '{
       "adminToken": "local-admin",
       "baseline": "QQQ",
       "timeframe": "DAILY",
       "year": 2026,
       "half": 1
     }'
   ```

3. **Check Cloud Tasks queue**: Verify `updateHeatmapSnapshotTask` queue is processing:
   ```bash
   gcloud tasks queues describe updateHeatmapSnapshotTask --location=us-central1
   ```

### Issue 3: Archive Data Missing or Incomplete

**Symptoms:**
- Archive doc exists but only has `day`, `dow` fields
- Missing `post` field or `post` field is empty
- Job shows `SUCCESS` but no data written

**Root Cause:**
Job succeeded but `writeUnifiedSeries` failed or was skipped.

**Diagnosis:**

```bash
# Check archive doc structure
firebase firestore:get pairs-data/QQQ-AAPL/archive-2026/260309

# Expected structure:
# {
#   day: "2026-03-09",
#   dow: "MON",
#   post: {
#     base: { price, change, percentChange },
#     target: { price, change, percentChange },
#     rsNorm: number,
#     rsRaw: number,
#     source: string
#   }
# }

# Check job logs for errors
gcloud logging read \
  'resource.type="cloud_function"
   resource.labels.function_name="processRsJobTask"
   jsonPayload.pairId="QQQ-AAPL"
   jsonPayload.message=~"writeUnifiedSeries"
   timestamp>="2026-03-09T00:00:00Z"' \
  --limit 20 --format json
```

**Resolution:**

1. **Check partner API availability**: Verify partner API is returning data:
   ```bash
   # Check logs for partner API errors
   gcloud logging read \
     'jsonPayload.message=~"fetchDailyBarsRange"
      severity>=ERROR
      timestamp>="2026-03-09T00:00:00Z"' \
     --limit 20
   ```

2. **Retry the job**: Use `recomputeRsBackfillAdmin` to reprocess specific pairs:
   ```bash
   curl -X POST https://us-central1-rel-str.cloudfunctions.net/recomputeRsBackfillAdmin \
     -H "Content-Type: application/json" \
     -d '{
       "adminToken": "local-admin",
       "from": "2026-03-09",
       "to": "2026-03-09",
       "phase": "post",
       "intervals": ["DAILY"],
       "pairs": ["QQQ-AAPL"]
     }'
   ```

### Issue 4: Jobs Not Enqueuing

**Symptoms:**
- `partner-events` created but no `rs-realtime-runs` docs
- No Cloud Tasks enqueued
- No job processing logs

**Root Cause:**
`RS_REALTIME_TASKS_ENABLED` is `false` or Cloud Tasks queue is paused.

**Diagnosis:**

```bash
# Check environment variable
firebase functions:config:get | grep RS_REALTIME_TASKS_ENABLED

# Check Cloud Tasks queue status
gcloud tasks queues describe processRsJobTask --location=us-central1

# Look for state: RUNNING (should not be PAUSED)
```

**Resolution:**

1. **Enable realtime tasks** (if disabled):
   ```bash
   firebase functions:config:set rs.realtime_tasks_enabled=true
   firebase deploy --only functions
   ```

2. **Resume paused queue**:
   ```bash
   gcloud tasks queues resume processRsJobTask --location=us-central1
   ```

3. **Check IAM permissions**: Verify Cloud Functions service account has `cloudtasks.tasks.create`:
   ```bash
   gcloud projects get-iam-policy rel-str \
     --flatten="bindings[].members" \
     --filter="bindings.members:serviceAccount:rel-str@appspot.gserviceaccount.com"
   ```

### Issue 5: MONTHLY Archive Only Has 3 Documents

**Symptoms:**
- `archive-monthly-2026` has only 3 docs (one per month)
- Expected all trading days but only seeing month-end dates

**Root Cause:**
This is **correct behavior**. MONTHLY archives store only the last trading day of each month.

**Verification:**

```bash
# Check monthly archive docs
firebase firestore:query pairs-data/QQQ-AAPL/archive-monthly-2026 \
  --order-by day

# Expected: One doc per month (e.g., 260130, 260227, 260309)
# Each doc represents the last trading day of that month
```

**Explanation:**
- DAILY archives: All trading days
- WEEKLY archives: One doc per week (last trading day of week)
- MONTHLY archives: One doc per month (last trading day of month)

This is by design to reduce storage costs and match bar semantics.

## Verification Queries

### Node.js Script for Quick Checks

```javascript
// Run from functions directory: cd functions; node check-run.js

const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

async function checkRun(runId) {
  // Check partner-events
  const eventDoc = await db.collection('partner-events').doc(runId).get();
  if (!eventDoc.exists) {
    console.log('❌ partner-events doc not found');
    return;
  }
  const event = eventDoc.data();
  console.log('partner-events:', {
    status: event.status,
    runStatus: event.runStatus,
    successJobs: event.successJobs,
    permanentFailureJobs: event.permanentFailureJobs,
    expectedJobs: event.expectedJobs,
  });

  // Check rs-realtime-runs for DAILY
  const runDoc = await db.doc(`system/rs-realtime-runs/runs/${runId}-DAILY`).get();
  if (!runDoc.exists) {
    console.log('❌ rs-realtime-runs doc not found');
    return;
  }
  const run = runDoc.data();
  console.log('rs-realtime-runs (DAILY):', {
    runStatus: run.runStatus,
    successJobs: run.successJobs,
    permanentFailureJobs: run.permanentFailureJobs,
    expectedJobs: run.expectedJobs,
    runFinishedAt: run.runFinishedAt ? 'SET' : 'NOT SET',
    runCompletedAt: run.runCompletedAt ? 'SET' : 'NOT SET',
  });

  // Check sample archive data
  const day = runId.split('-')[0] + runId.split('-')[1] + runId.split('-')[2]; // YYMMDD
  const archiveDoc = await db
    .collection('pairs-data')
    .doc('QQQ-AAPL')
    .collection('archive-2026')
    .doc(day.slice(2)) // Remove century
    .get();
  
  if (!archiveDoc.exists) {
    console.log('❌ Sample archive doc not found');
    return;
  }
  const archive = archiveDoc.data();
  console.log('Sample archive (QQQ-AAPL):', {
    day: archive.day,
    hasPost: !!archive.post,
    rsNorm: archive.post?.rsNorm,
    rsRaw: archive.post?.rsRaw,
  });

  // Check heatmap snapshot
  const hmDoc = await db.collection('heatmap-snapshots').doc('QQQ-DAILY-2026-H1').get();
  if (!hmDoc.exists) {
    console.log('❌ Heatmap snapshot not found');
    return;
  }
  const hm = hmDoc.data();
  const latestDate = hm.dates?.[hm.dates.length - 1];
  console.log('Heatmap snapshot (QQQ-DAILY-2026-H1):', {
    dateCount: hm.dates?.length,
    latestDate,
    updatedAt: hm.updatedAt?.toDate?.().toISOString(),
  });
}

// Usage: node check-run.js 2026-03-09-MON-A-DAILY-LIVE-POST-1635
const runId = process.argv[2];
if (!runId) {
  console.error('Usage: node check-run.js <runId>');
  process.exit(1);
}

checkRun(runId)
  .then(() => process.exit(0))
  .catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  });
```

### Cloud Logs Queries

```bash
# Monitor run completion
gcloud logging read \
  'resource.type="cloud_function"
   jsonPayload.message="updateRealtimeRunForJobTerminal_complete"
   timestamp>="2026-03-09T00:00:00Z"' \
  --limit 10 --format json

# Check for job failures
gcloud logging read \
  'resource.type="cloud_function"
   jsonPayload.message="processRsJobInternal_permanent_failure"
   timestamp>="2026-03-09T00:00:00Z"' \
  --limit 20 --format json

# Monitor heatmap triggers
gcloud logging read \
  'resource.type="cloud_function"
   jsonPayload.message=~"triggerHeatmapUpdatesForBaselines"
   timestamp>="2026-03-09T00:00:00Z"' \
  --limit 10 --format json

# Check partner API errors
gcloud logging read \
  'resource.type="cloud_function"
   jsonPayload.message=~"fetchDailyBarsRange"
   severity>=ERROR
   timestamp>="2026-03-09T00:00:00Z"' \
  --limit 20 --format json
```

## Escalation Procedures

### When to Escalate

Escalate to engineering if:
1. Multiple consecutive runs fail with `FAILED` status
2. Partner API returns consistent errors (5xx, timeouts)
3. Cloud Tasks queue is backing up (>1000 pending tasks)
4. Heatmap snapshots haven't updated in >48 hours
5. Archive data corruption detected (missing `post` fields across multiple pairs)

### Information to Gather

Before escalating, collect:
1. **Run ID** and **timestamp** of affected run(s)
2. **partner-events status** and **rs-realtime-runs status**
3. **Sample archive docs** showing missing/corrupt data
4. **Cloud Logs** for the affected time period (export to JSON)
5. **Cloud Tasks queue stats** (pending, running, failed counts)
6. **Environment config** (`RS_REALTIME_TASKS_ENABLED`, etc.)

### Emergency Procedures

**If production data pipeline is completely blocked:**

1. **Check partner API health**:
   ```bash
   # Test partner API directly
   curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
     https://partner-api-url/health
   ```

2. **Pause incoming messages** (if partner API is down):
   ```bash
   # Pause Pub/Sub subscription
   gcloud pubsub subscriptions update rsh-partner-data-ready --no-ack-deadline
   ```

3. **Drain Cloud Tasks queue** (if jobs are failing):
   ```bash
   # Pause queue to stop new tasks
   gcloud tasks queues pause processRsJobTask --location=us-central1
   
   # Purge failed tasks
   gcloud tasks queues purge processRsJobTask --location=us-central1
   ```

4. **Resume after fix**:
   ```bash
   # Resume queue
   gcloud tasks queues resume processRsJobTask --location=us-central1
   
   # Resume Pub/Sub subscription
   gcloud pubsub subscriptions update rsh-partner-data-ready --ack-deadline=60
   ```

## Related Documentation

- `RS-BE-FEAT-RTRUN-2603_realtime-run-pipeline-and-status-tracking.md` - Detailed pipeline architecture
- `RS-BE-FEAT-FRBARR-2601-02_full-rs-backfill-and-realtime-refresh.md` - Job pipeline implementation
- `RS-BE-FEAT-HMSNAP-2602_backend-heatmap-snapshots-for-dashboard-v3.md` - Heatmap snapshot system
- `partner-data-ready-pubsub-integration.md` - Pub/Sub integration guide
