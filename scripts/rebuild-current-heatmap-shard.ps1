# Rebuild the current heatmap shard (2026-H1) for all baselines
# This updates the live snapshot with the latest data including 4-10

param(
    [string]$Environment = "production",
    [string[]]$Baselines = @()
)

$allBaselines = @('SPY', 'QQQ', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XME', 'XPH', 'XSD')
$baselinesToProcess = if ($Baselines.Count -gt 0) { $Baselines } else { $allBaselines }

$emulatorUrl = "http://127.0.0.1:5002/rel-str/us-central1/rebuildHeatmapSnapshotAdmin"
$productionUrl = "https://us-central1-rel-str.cloudfunctions.net/rebuildHeatmapSnapshotAdmin"
$url = if ($Environment -eq "production") { $productionUrl } else { $emulatorUrl }

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Rebuild Current Heatmap Shard (2026-H1)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Environment: $Environment" -ForegroundColor Yellow
Write-Host "URL: $url" -ForegroundColor Yellow
Write-Host "Baselines: $($baselinesToProcess -join ', ')" -ForegroundColor Yellow
Write-Host ""

$successCount = 0
$failureCount = 0
$failures = @()

foreach ($baseline in $baselinesToProcess) {
    Write-Host "Rebuilding $baseline-DAILY-2026-H1..." -NoNewline
    
    try {
        $body = @{
            data = @{
                baseline = $baseline
                timeframe = 'DAILY'
                snapshotType = 'current'
            }
        } | ConvertTo-Json -Depth 10
        
        $headers = @{
            'Authorization' = 'Bearer local-admin'
        }
        
        $response = Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json" -Headers $headers -Body $body -ErrorAction Stop
        
        $result = if ($response.result) { $response.result } else { $response }
        
        if ($result.ok) {
            $successCount++
            Write-Host " Success (pairs: $($result.pairs), dates: $($result.dates))" -ForegroundColor Green
        } else {
            $failureCount++
            $failures += "$baseline : $($result.message)"
            Write-Host " Failed: $($result.message)" -ForegroundColor Red
        }
    } catch {
        $failureCount++
        $failures += "$baseline : $($_.Exception.Message)"
        Write-Host " Error: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    Start-Sleep -Milliseconds 500
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Total: $($baselinesToProcess.Count)" -ForegroundColor White
Write-Host "Success: $successCount" -ForegroundColor Green
Write-Host "Failures: $failureCount" -ForegroundColor $(if ($failureCount -gt 0) { "Red" } else { "White" })

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "Failed shards:" -ForegroundColor Red
    foreach ($failure in $failures) {
        Write-Host "  - $failure" -ForegroundColor Red
    }
}
