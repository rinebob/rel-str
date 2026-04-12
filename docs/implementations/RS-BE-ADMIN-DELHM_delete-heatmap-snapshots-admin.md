# RS-BE-ADMIN-DELHM – Delete Heatmap Snapshots Admin

## Overview

The `deleteHeatmapSnapshotsAdmin` Cloud Function provides efficient server-side batch deletion of heatmap snapshot documents from the `heatmap-snapshots` Firestore collection. This admin-protected callable is designed for cleanup, troubleshooting, and migration scenarios.

---

## Function Details

**Function Name**: `deleteHeatmapSnapshotsAdmin`  
**Type**: Callable (HTTPS)  
**Region**: us-central1  
**Timeout**: 540 seconds (9 minutes)  
**Memory**: 512 MiB  
**Authentication**: Admin token required

---

## Request Schema

```typescript
interface DeleteHeatmapSnapshotsRequest {
  adminToken: string;      // Required: Admin token for authentication
  baselines?: string[];    // Optional: Filter by baseline symbols (e.g., ['QQQ', 'SPY'])
  timeframes?: string[];   // Optional: Filter by timeframes (e.g., ['DAILY', 'WEEKLY'])
  dryRun?: boolean;       // Optional: Preview deletions without executing (default: false)
}
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `adminToken` | string | Yes | - | Admin authentication token (`'local-admin'` for dev/prod) |
| `baselines` | string[] | No | - | Filter deletions to specific baselines (e.g., `['QQQ', 'SPY']`). If omitted, ALL baselines are targeted. |
| `timeframes` | string[] | No | - | Filter deletions to specific timeframes (e.g., `['DAILY', 'WEEKLY']`). If omitted, ALL timeframes are targeted. |
| `dryRun` | boolean | No | `false` | If `true`, returns what would be deleted without actually deleting. |

---

## Response Schema

```typescript
interface DeleteHeatmapSnapshotsResponse {
  ok: boolean;                // Success indicator
  scanned: number;            // Total documents examined
  deleted: number;            // Documents deleted (or would be deleted in dry run)
  skipped: number;            // Documents not matching filters
  dryRun: boolean;            // Whether this was a dry run
  durationMs: number;         // Execution time in milliseconds
  baselineFilters: string[];  // Applied baseline filters (['ALL'] if none)
  timeframeFilters: string[]; // Applied timeframe filters (['ALL'] if none)
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | `true` if operation completed successfully |
| `scanned` | number | Total number of documents examined in the collection |
| `deleted` | number | Number of documents deleted (or that would be deleted in dry run) |
| `skipped` | number | Number of documents that didn't match the filters |
| `dryRun` | boolean | Confirms whether this was a dry run |
| `durationMs` | number | Total execution time in milliseconds |
| `baselineFilters` | string[] | The baseline filters applied, or `['ALL']` if no filter |
| `timeframeFilters` | string[] | The timeframe filters applied, or `['ALL']` if no filter |

---

## Usage Examples

### Setup (PowerShell)

```powershell
# Set base URL and headers
$base = "https://us-central1-rel-str.cloudfunctions.net"
$headers = @{ "Content-Type" = "application/json" }
```

### Example 1: Dry Run for Specific Baseline

Preview what would be deleted for QQQ without actually deleting:

```powershell
Invoke-RestMethod -Method Post -Uri "$base/deleteHeatmapSnapshotsAdmin" -Headers $headers -Body (@{
    data = @{
        adminToken = 'local-admin'
        baselines = @('QQQ')
        dryRun = $true
    }
} | ConvertTo-Json -Depth 5)
```

**Example Response**:
```json
{
  "ok": true,
  "scanned": 335,
  "deleted": 21,
  "skipped": 314,
  "dryRun": true,
  "durationMs": 9883,
  "baselineFilters": ["QQQ"],
  "timeframeFilters": ["ALL"]
}
```

### Example 2: Live Deletion for Specific Baseline

Delete all QQQ heatmap snapshots:

```powershell
Invoke-RestMethod -Method Post -Uri "$base/deleteHeatmapSnapshotsAdmin" -Headers $headers -Body (@{
    data = @{
        adminToken = 'local-admin'
        baselines = @('QQQ')
        dryRun = $false
    }
} | ConvertTo-Json -Depth 5)
```

**Example Response**:
```json
{
  "ok": true,
  "scanned": 335,
  "deleted": 21,
  "skipped": 314,
  "dryRun": false,
  "durationMs": 8367,
  "baselineFilters": ["QQQ"],
  "timeframeFilters": ["ALL"]
}
```

### Example 3: Delete Multiple Baselines

Delete all snapshots for QQQ and SPY:

```powershell
Invoke-RestMethod -Method Post -Uri "$base/deleteHeatmapSnapshotsAdmin" -Headers $headers -Body (@{
    data = @{
        adminToken = 'local-admin'
        baselines = @('QQQ', 'SPY')
        dryRun = $false
    }
} | ConvertTo-Json -Depth 5)
```

**Example Response**:
```json
{
  "ok": true,
  "scanned": 335,
  "deleted": 42,
  "skipped": 293,
  "dryRun": false,
  "durationMs": 10250,
  "baselineFilters": ["QQQ", "SPY"],
  "timeframeFilters": ["ALL"]
}
```

### Example 4: Delete Specific Timeframes

Delete only DAILY snapshots for QQQ:

```powershell
Invoke-RestMethod -Method Post -Uri "$base/deleteHeatmapSnapshotsAdmin" -Headers $headers -Body (@{
    data = @{
        adminToken = 'local-admin'
        baselines = @('QQQ')
        timeframes = @('DAILY')
        dryRun = $false
    }
} | ConvertTo-Json -Depth 5)
```

**Example Response**:
```json
{
  "ok": true,
  "scanned": 335,
  "deleted": 15,
  "skipped": 320,
  "dryRun": false,
  "durationMs": 7890,
  "baselineFilters": ["QQQ"],
  "timeframeFilters": ["DAILY"]
}
```

### Example 5: Delete All Snapshots (Use with Extreme Caution)

Delete ALL heatmap snapshots across all baselines and timeframes:

```powershell
# WARNING: This deletes ALL heatmap snapshots!
Invoke-RestMethod -Method Post -Uri "$base/deleteHeatmapSnapshotsAdmin" -Headers $headers -Body (@{
    data = @{
        adminToken = 'local-admin'
        dryRun = $false
    }
} | ConvertTo-Json -Depth 5)
```

**Example Response**:
```json
{
  "ok": true,
  "scanned": 335,
  "deleted": 335,
  "skipped": 0,
  "dryRun": false,
  "durationMs": 12450,
  "baselineFilters": ["ALL"],
  "timeframeFilters": ["ALL"]
}
```

---

## Implementation Details

### Filtering Logic

The function filters documents by checking document IDs against baseline and timeframe filters:

```typescript
// Document ID format: {BASELINE}-{TIMEFRAME}-{SHARD_ID}
// Examples: 'QQQ-DAILY-2026-H1', 'SPY-WEEKLY-2025-2026'

// Apply baseline filters if specified
if (baselineFilters.length > 0) {
  const matchesBaseline = baselineFilters.some((b: string) => docId.startsWith(`${b}-`));
  if (!matchesBaseline) {
    totalSkipped++;
    continue;
  }
}

// Apply timeframe filters if specified
if (timeframeFilters.length > 0) {
  const matchesTimeframe = timeframeFilters.some((tf: string) => docId.includes(`-${tf}-`));
  if (!matchesTimeframe) {
    totalSkipped++;
    continue;
  }
}
```

**Filter Behavior**:
- **Baselines**: Document must start with one of the specified baselines (e.g., `QQQ-` or `SPY-`)
- **Timeframes**: Document must contain one of the specified timeframes (e.g., `-DAILY-` or `-WEEKLY-`)
- **Both filters**: Document must match BOTH baseline AND timeframe (logical AND)
- **No filters**: All documents are targeted

### Batch Deletion

Documents are deleted in batches of 100 to avoid Firestore's 10 MiB transaction size limit:

```typescript
const batchSize = 100; // Reduced to avoid 10 MiB transaction size limit

for (let i = 0; i < toDelete.length; i += batchSize) {
  const batch = db.batch();
  const chunk = toDelete.slice(i, i + batchSize);
  for (const docRef of chunk) {
    batch.delete(docRef);
  }
  await batch.commit();
}
```

### Performance Characteristics

- **Collection scan**: Loads entire `heatmap-snapshots` collection into memory
- **Memory usage**: ~512 MiB to handle full collection (300+ docs)
- **Batch size**: 100 documents per batch (to avoid 10 MiB transaction size limit)
- **Typical duration**: ~10-12 seconds per 300 documents (3 batches)
- **Large deletions**: ~30-35 seconds per 300 documents when processing many baselines

---

## Common Use Cases

### 1. Rebuild After Schema Changes

When the heatmap snapshot schema or bucket logic changes, delete and rebuild:

```powershell
# Step 1: Delete old QQQ snapshots
Invoke-RestMethod -Method Post -Uri "$base/deleteHeatmapSnapshotsAdmin" -Headers $headers -Body (@{
    data = @{ adminToken = 'local-admin'; baselines = @('QQQ'); dryRun = $false }
} | ConvertTo-Json -Depth 5)

# Step 2: Rebuild with new logic
# (Use rebuildHeatmapSnapshotAdmin for DAILY, WEEKLY, MONTHLY)
```

### 2. Fix Corrupted Data

Remove malformed or corrupted documents before regenerating:

```powershell
# Dry run to see what would be deleted
Invoke-RestMethod -Method Post -Uri "$base/deleteHeatmapSnapshotsAdmin" -Headers $headers -Body (@{
    data = @{ adminToken = 'local-admin'; baselines = @('SPY'); dryRun = $true }
} | ConvertTo-Json -Depth 5)

# If output looks correct, run live deletion
Invoke-RestMethod -Method Post -Uri "$base/deleteHeatmapSnapshotsAdmin" -Headers $headers -Body (@{
    data = @{ adminToken = 'local-admin'; baselines = @('SPY'); dryRun = $false }
} | ConvertTo-Json -Depth 5)
```

### 3. Baseline Removal

Clean up all snapshots when removing a baseline from the system:

```powershell
# Remove all XME snapshots (if XME baseline is being retired)
Invoke-RestMethod -Method Post -Uri "$base/deleteHeatmapSnapshotsAdmin" -Headers $headers -Body (@{
    data = @{ adminToken = 'local-admin'; baselines = @('XME'); dryRun = $false }
} | ConvertTo-Json -Depth 5)
```

### 4. Testing and Development

Clear test data between development iterations:

```powershell
# Clear all snapshots in dev environment
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:5002/rel-str/us-central1/deleteHeatmapSnapshotsAdmin" -Headers $headers -Body (@{
    data = @{ adminToken = 'local-admin'; dryRun = $false }
} | ConvertTo-Json -Depth 5)
```

---

## Error Handling

### Unauthorized Access

If the admin token is invalid:

```json
{
  "error": {
    "message": "Unauthorized: invalid admin token",
    "status": "PERMISSION_DENIED"
  }
}
```

### Function Timeout

If deletion takes longer than 540 seconds (rare for <1000 docs):

```json
{
  "error": {
    "message": "Function execution timeout",
    "status": "DEADLINE_EXCEEDED"
  }
}
```

### Firestore Errors

If Firestore operations fail:

```json
{
  "error": {
    "message": "Firestore batch write failed: [error details]",
    "status": "INTERNAL"
  }
}
```

---

## Monitoring and Logging

### Cloud Logs Query

View all deletion operations:

```
resource.type="cloud_function"
resource.labels.function_name="deleteHeatmapSnapshotsAdmin"
severity>=INFO
```

### Key Log Events

1. **Start**: `deleteHeatmapSnapshotsAdmin_start`
   - Fields: `baselineFilter`, `dryRun`

2. **Batch Progress**: `deleteHeatmapSnapshotsAdmin_batch`
   - Fields: `batchNumber`, `deletedInBatch`, `totalDeleted`

3. **Complete**: `deleteHeatmapSnapshotsAdmin_complete`
   - Fields: `totalScanned`, `totalDeleted`, `totalSkipped`, `durationMs`

4. **Error**: `deleteHeatmapSnapshotsAdmin_error`
   - Fields: `message`, `stack`, `durationMs`

---

## Best Practices

### 1. Always Dry Run First

Before any live deletion, run a dry run to verify the scope:

```powershell
# Dry run
$result = Invoke-RestMethod -Method Post -Uri "$base/deleteHeatmapSnapshotsAdmin" -Headers $headers -Body (@{
    data = @{ adminToken = 'local-admin'; baseline = 'QQQ'; dryRun = $true }
} | ConvertTo-Json -Depth 5)

# Review output
Write-Host "Would delete $($result.deleted) docs out of $($result.scanned) scanned"

# If correct, run live
if ($result.deleted -eq 21) {
    Invoke-RestMethod -Method Post -Uri "$base/deleteHeatmapSnapshotsAdmin" -Headers $headers -Body (@{
        data = @{ adminToken = 'local-admin'; baseline = 'QQQ'; dryRun = $false }
    } | ConvertTo-Json -Depth 5)
}
```

### 2. Use Baseline Filters

Always specify a baseline filter unless you truly need to delete all snapshots:

```powershell
# GOOD: Targeted deletion
baselines = @('QQQ')

# RISKY: Deletes everything
baselines = @()  # or omit the parameter
```

### 3. Verify Firestore State

After deletion, verify the expected documents are gone:

```
# In Firestore Console, filter by:
Collection: heatmap-snapshots
Document ID starts with: QQQ-
```

### 4. Coordinate with Rebuilds

Plan deletion and rebuild operations together:

```powershell
# 1. Delete QQQ DAILY shards
Invoke-RestMethod -Method Post -Uri "$base/deleteHeatmapSnapshotsAdmin" -Headers $headers -Body (@{
    data = @{ adminToken = 'local-admin'; baselines = @('QQQ'); timeframes = @('DAILY'); dryRun = $false }
} | ConvertTo-Json -Depth 5)

# 2. Immediately rebuild to avoid data gaps
Invoke-RestMethod -Method Post -Uri "$base/rebuildHeatmapSnapshotAdmin" -Headers $headers -Body (@{
    data = @{ baseline = 'QQQ'; timeframe = 'DAILY'; year = 2026; half = 1 }
} | ConvertTo-Json -Depth 5)
```

---

## Security Considerations

### Admin Token Protection

- The `adminToken` parameter must match the `ADMIN_BACKFILL_TOKEN` environment variable
- Default value: `'local-admin'` (for both dev and prod)
- Token is validated before any operations execute
- Invalid tokens result in immediate rejection with no side effects

### IP Logging

Unauthorized access attempts are logged with the requester's IP address:

```typescript
logger.warn('deleteHeatmapSnapshotsAdmin_unauthorized', { ip: req.rawRequest?.ip });
```

### Audit Trail

All deletion operations (including dry runs) are logged to Cloud Logging for audit purposes.

---

## Related Documentation

- **Main Implementation Doc**: `RS-BE-FEAT-HMSNAP-2602_backend-heatmap-snapshots-for-dashboard-v3.md`
- **Rebuild Function**: `rebuildHeatmapSnapshotAdmin` (for regenerating deleted snapshots)
- **Frontend Integration**: `RS-FE-FEAT-HMUI-2602_dashboardv3-heatmap-ui-sort-filter-render-treatments.md`

---

## Changelog

### 2026-03-07
- Initial implementation
- Added baseline filtering
- Added dry run mode
- Increased memory to 512 MiB for full collection scans
- Added batch deletion with progress logging
