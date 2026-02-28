# [HMSNAP-T03] Backfill ALL heatmap snapshots (DAILY, WEEKLY, MONTHLY)
# Master script that runs all three backfill scripts in sequence
# Run this script from the project root directory

param(
    [string]$Environment = "emulator",  # "emulator" or "production"
    [string[]]$Baselines = @()          # Optional: specific baselines to backfill
)

$scriptDir = $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "COMPLETE Heatmap Snapshot Backfill" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Environment: $Environment" -ForegroundColor Yellow
Write-Host ""

$startTime = Get-Date

# Run DAILY backfill
Write-Host "Step 1/3: Running DAILY backfill..." -ForegroundColor Magenta
Write-Host ""
if ($Baselines.Count -gt 0) {
    & "$scriptDir\backfill-heatmap-snapshots-daily.ps1" -Environment $Environment -Baselines $Baselines
} else {
    & "$scriptDir\backfill-heatmap-snapshots-daily.ps1" -Environment $Environment
}
Write-Host ""

# Run WEEKLY backfill
Write-Host "Step 2/3: Running WEEKLY backfill..." -ForegroundColor Magenta
Write-Host ""
if ($Baselines.Count -gt 0) {
    & "$scriptDir\backfill-heatmap-snapshots-weekly.ps1" -Environment $Environment -Baselines $Baselines
} else {
    & "$scriptDir\backfill-heatmap-snapshots-weekly.ps1" -Environment $Environment
}
Write-Host ""

# Run MONTHLY backfill
Write-Host "Step 3/3: Running MONTHLY backfill..." -ForegroundColor Magenta
Write-Host ""
if ($Baselines.Count -gt 0) {
    & "$scriptDir\backfill-heatmap-snapshots-monthly.ps1" -Environment $Environment -Baselines $Baselines
} else {
    & "$scriptDir\backfill-heatmap-snapshots-monthly.ps1" -Environment $Environment
}
Write-Host ""

$endTime = Get-Date
$duration = $endTime - $startTime

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "ALL BACKFILLS COMPLETE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Total Duration: $($duration.ToString('hh\:mm\:ss'))" -ForegroundColor Yellow
Write-Host ""
Write-Host "Summary:" -ForegroundColor Yellow
Write-Host "  - DAILY: 14 shards per baseline (2019-H1 through 2025-H2)" -ForegroundColor White
Write-Host "  - WEEKLY: 3 shards per baseline (2019-2020, 2021-2022, 2023-2024)" -ForegroundColor White
Write-Host "  - MONTHLY: 1 shard per baseline (2019-2022)" -ForegroundColor White
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Verify shards in Firestore console" -ForegroundColor White
Write-Host "  2. Check document sizes are under 1MB" -ForegroundColor White
Write-Host "  3. Generate current shards for 2026 data" -ForegroundColor White
Write-Host ""
Write-Host "Done!" -ForegroundColor Cyan
