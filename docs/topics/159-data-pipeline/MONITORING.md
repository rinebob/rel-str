**Topic:** Refactor data pipeline to PDR-driven triggers, consolidate local bar store writers, and migrate charts to local reads  
**Issue:** #174  
**Topic Parent:** #159  
**Domain:** DATA-PIPELINE  
**Type:** Runbook  
**Status:** Complete  
**Created:** 2026-08-24  
**Last Updated:** 2026-08-24  

---

# MONITORING: Data Pipeline PDR Migration

Logs Explorer queries for monitoring the SDS pipeline, fallback timer, open pass timer, and PDRv2 ingestion.

## SDS Pipeline

### PDR message received
```
resource.type="cloud_function"
resource.labels.function_name="symbolDataSync"
jsonPayload.message=~"sds_pdr_received"
```
**Fields:** `runId`, `phase`, `interval`, `sequence`

### Run completed (per-interval)
```
resource.type="cloud_function"
resource.labels.function_name="symbolDataSyncWorker"
jsonPayload.message=~"sds_worker_done"
```
**Fields:** `symbol`, `interval`, `barCount`, `runId`

### Sequence completion dispatched
```
resource.type="cloud_function"
resource.labels.function_name="sdsConsumerDispatch"
jsonPayload.message=~"sds_consumer_enqueued"
```
**Fields:** `consumer`, `marketDate`, `sequenceRunId`

### Watchdog stale run/sequence
```
resource.type="cloud_function"
resource.labels.function_name="sdsWatchdog"
jsonPayload.message=~"sds_watchdog_stale"
```
**Fields:** `runId` or `sequenceRunId`, `ageMinutes`

### Completed but not dispatched (alert)
```
resource.type="cloud_function"
jsonPayload.message=~"sds_seq_completed_but_not_dispatched"
```
**Action:** Watchdog will retry on next tick. If persists, check Cloud Tasks queue.

## Fallback Timer

### Fallback triggered
```
resource.type="cloud_function"
resource.labels.function_name="sdsFallback"
jsonPayload.message=~"sds_fallback"
```
**Fields:** `marketDate`, `interval`, `runId`

### Fallback error (alert)
```
resource.type="cloud_function"
resource.labels.function_name="sdsFallback"
jsonPayload.severity=ERROR
```

## Open Pass Timer

### Timer tick
```
resource.type="cloud_function"
resource.labels.function_name="openPassTimer"
jsonPayload.message=~"open_pass_timer_tick"
```
**Fields:** `slot`, `marketDate`

### No matching instances (normal)
```
resource.type="cloud_function"
resource.labels.function_name="openPassTimer"
jsonPayload.message=~"open_pass_timer_no_instances"
```

### Open pass error (alert)
```
resource.type="cloud_function"
resource.labels.function_name="openPassTimer"
jsonPayload.severity=ERROR
```

## PDRv2 (still active)

### Data-ready run started
```
resource.type="cloud_function"
resource.labels.function_name="processDataReadyRunV2"
jsonPayload.message=~"processDataReadyRunV2"
```

### Pair processing errors
```
resource.type="cloud_function"
resource.labels.function_name="processDataReadyRunV2"
jsonPayload.severity=ERROR
```

## Deleted Functions (should NOT appear)

These functions have been removed. If logs appear, a stale deployment is running:

- `processSymbolsReady` — deleted (symbol-driven pipeline removed)
- `rhAgentPdrTrigger` — deleted (replaced by SDS consumer dispatch)
- `symbolDataSyncNightly` — deleted (replaced by SDS Pub/Sub subscriber)
- `syncTrackedSymbolsDaily` — deleted (replaced by SDS)
- `optionsOpenPass` — deleted (replaced by openPassTimer)
- `backfillSymbolDataForTradesDaily` — disabled (removed from exports)

### Query to detect stale deployments
```
resource.type="cloud_function"
resource.labels.function_name=~"processSymbolsReady|rhAgentPdrTrigger|symbolDataSyncNightly|syncTrackedSymbolsDaily|optionsOpenPass|backfillSymbolDataForTradesDaily"
```
**Expected:** No results. If results appear, redeploy functions.
