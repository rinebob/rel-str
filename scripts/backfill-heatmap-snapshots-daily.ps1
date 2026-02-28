# [HMSNAP-T03] Backfill DAILY historical heatmap snapshots
# Generates all DAILY historical shards (2019-H1 through 2025-H2) for all baselines
# Run this script from the project root directory

param(
    [string]$Environment = "emulator",
    [string[]]$Baselines = @(),
    [int]$StartYear = 2019,
    [int]$EndYear = 2025
)

# Configuration
$allBaselines = @('SPY', 'QQQ', 'XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XME', 'XPH', 'XSD')
$baselinesToProcess = if ($Baselines.Count -gt 0) { $Baselines } else { $allBaselines }

$emulatorUrl = "http://127.0.0.1:5002/rel-str/us-central1/rebuildHeatmapSnapshotAdmin"
$productionUrl = "https://us-central1-rel-str.cloudfunctions.net/rebuildHeatmapSnapshotAdmin"
$url = if ($Environment -eq "production") { $productionUrl } else { $emulatorUrl }

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "DAILY Heatmap Snapshot Backfill" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Environment: $Environment" -ForegroundColor Yellow
Write-Host "URL: $url" -ForegroundColor Yellow
Write-Host "Baselines: $($baselinesToProcess -join ', ')" -ForegroundColor Yellow
Write-Host "Year Range: $StartYear-$EndYear" -ForegroundColor Yellow
Write-Host ""

$totalShards = $baselinesToProcess.Count * (($EndYear - $StartYear + 1) * 2)
$currentShard = 0
$successCount = 0
$failureCount = 0
$failures = @()

foreach ($baseline in $baselinesToProcess) {
    Write-Host "Processing baseline: $baseline" -ForegroundColor Green
    
    foreach ($year in $StartYear..$EndYear) {
        foreach ($half in 1..2) {
            $currentShard++
            $shardId = "$year-H$half"
            $progress = [math]::Round(($currentShard / $totalShards) * 100, 1)
            
            Write-Host "  [$currentShard/$totalShards - $progress%] Generating $baseline-DAILY-hist-$shardId..." -NoNewline
            
            try {
                $body = @{
                    data = @{
                        baseline = $baseline
                        timeframe = 'DAILY'
                        snapshotType = 'historical'
                        year = $year
                        half = $half
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
                    $failures += "$baseline-DAILY-hist-$shardId : $($result.message)"
                    Write-Host " Failed: $($result.message)" -ForegroundColor Red
                }
            } catch {
                $failureCount++
                $failures += "$baseline-DAILY-hist-$shardId : $($_.Exception.Message)"
                Write-Host " Error: $($_.Exception.Message)" -ForegroundColor Red
            }
            
            Start-Sleep -Milliseconds 500
        }
    }
    
    Write-Host ""
}

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
