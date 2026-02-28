# [HMSNAP-T03] Backfill MONTHLY historical heatmap snapshots
# Generates all MONTHLY historical shards (2019-2022) for all baselines
# Run this script from the project root directory

param(
    [string]$Environment = "emulator",  # "emulator" or "production"
    [string[]]$Baselines = @()          # Optional: specific baselines to backfill
)

# Configuration
$allBaselines = @('SPY', 'QQQ', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XME', 'XPH', 'XSD')
$baselinesToProcess = if ($Baselines.Count -gt 0) { $Baselines } else { $allBaselines }

$yearStart = 2019
$yearEnd = 2022

$emulatorUrl = "http://127.0.0.1:5002/rel-str/us-central1/rebuildHeatmapSnapshotAdmin"
$productionUrl = "https://us-central1-rel-str.cloudfunctions.net/rebuildHeatmapSnapshotAdmin"
$url = if ($Environment -eq "production") { $productionUrl } else { $emulatorUrl }

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "MONTHLY Heatmap Snapshot Backfill" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Environment: $Environment" -ForegroundColor Yellow
Write-Host "URL: $url" -ForegroundColor Yellow
Write-Host "Baselines: $($baselinesToProcess -join ', ')" -ForegroundColor Yellow
Write-Host "Period: $yearStart-$yearEnd" -ForegroundColor Yellow
Write-Host ""

$totalShards = $baselinesToProcess.Count
$currentShard = 0
$successCount = 0
$failureCount = 0
$failures = @()

foreach ($baseline in $baselinesToProcess) {
    $currentShard++
    $shardId = "$yearStart-$yearEnd"
    $progress = [math]::Round(($currentShard / $totalShards) * 100, 1)
    
    Write-Host "[$currentShard/$totalShards - $progress%] Generating $baseline-MONTHLY-hist-$shardId..." -NoNewline
    
    try {
        $body = @{
            data = @{
                baseline = $baseline
                timeframe = 'MONTHLY'
                snapshotType = 'historical'
                yearStart = $yearStart
                yearEnd = $yearEnd
            }
        } | ConvertTo-Json -Depth 10
        
        $response = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Body $body -ErrorAction Stop
        
        # Callable responses are wrapped in a result object
        $result = if ($response.result) { $response.result } else { $response }
        
        if ($result.ok) {
            $successCount++
            Write-Host " Success (pairs: $($result.pairs), dates: $($result.dates))" -ForegroundColor Green
        } else {
            $failureCount++
            $failures += "$baseline-MONTHLY-hist-$shardId : $($result.message)"
            Write-Host " Failed: $($result.message)" -ForegroundColor Red
        }
    } catch {
        $failureCount++
        $failures += "$baseline-MONTHLY-hist-$shardId : $($_.Exception.Message)"
        Write-Host " ✗ Error: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    # Small delay to avoid overwhelming the function
    Start-Sleep -Milliseconds 500
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Backfill Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Total Shards: $totalShards" -ForegroundColor Yellow
Write-Host "Successful: $successCount" -ForegroundColor Green
Write-Host "Failed: $failureCount" -ForegroundColor Red

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "Failures:" -ForegroundColor Red
    foreach ($failure in $failures) {
        Write-Host "  - $failure" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Done!" -ForegroundColor Cyan
