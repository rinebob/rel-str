# Delete heatmap-snapshots collection documents
# Usage: .\delete-heatmap-snapshots.ps1 [-BaselineFilter "QQQ"] [-DryRun]
#
# Examples:
#   .\delete-heatmap-snapshots.ps1                    # Delete ALL docs in heatmap-snapshots
#   .\delete-heatmap-snapshots.ps1 -BaselineFilter "QQQ"  # Delete only QQQ-* docs
#   .\delete-heatmap-snapshots.ps1 -DryRun            # Preview what would be deleted

param(
    [string]$BaselineFilter = "",
    [switch]$DryRun = $false
)

$ErrorActionPreference = 'Stop'

# Configuration
$project = 'rel-str'
$collection = 'heatmap-snapshots'
$batchSize = 100

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Heatmap Snapshots Collection Deletion" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Project: $project"
Write-Host "Collection: $collection"
if ($BaselineFilter) {
    Write-Host "Filter: Only $BaselineFilter-* documents" -ForegroundColor Yellow
} else {
    Write-Host "Filter: ALL documents (entire collection)" -ForegroundColor Red
}
Write-Host "Mode: $(if ($DryRun) { 'DRY RUN (no deletions)' } else { 'LIVE DELETION' })" -ForegroundColor $(if ($DryRun) { 'Green' } else { 'Red' })
Write-Host ""

# Confirm if not dry run and no filter
if (-not $DryRun -and -not $BaselineFilter) {
    $confirm = Read-Host "You are about to DELETE THE ENTIRE COLLECTION. Type 'DELETE ALL' to confirm"
    if ($confirm -ne 'DELETE ALL') {
        Write-Host "Aborted." -ForegroundColor Yellow
        exit 0
    }
}

# Authenticate and get token
Write-Host "Authenticating with gcloud..." -ForegroundColor Cyan
try {
    $tokenOutput = gcloud auth print-access-token 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "gcloud auth failed. Run: gcloud auth login"
    }
    $token = ($tokenOutput | Out-String).Trim()
} catch {
    Write-Host "ERROR: Failed to get gcloud token. Please run: gcloud auth login" -ForegroundColor Red
    exit 1
}

# Build headers
$headers = @{
    'Authorization' = "Bearer $token"
}

# Build base URL
$baseUrl = "https://firestore.googleapis.com/v1/projects/$project/databases/(default)/documents/$collection"

Write-Host "Base URL: $baseUrl" -ForegroundColor Gray
Write-Host ""

# Counters
$totalScanned = 0
$totalDeleted = 0
$totalSkipped = 0
$totalFailed = 0
$pageCount = 0
$pageToken = $null

# Page through collection
do {
    $pageCount++
    
    # Build list URL
    if ($pageToken) {
        $encodedToken = [System.Uri]::EscapeDataString($pageToken)
        $listUrl = "$baseUrl`?pageSize=$batchSize&pageToken=$encodedToken"
    } else {
        $listUrl = "$baseUrl`?pageSize=$batchSize"
    }
    
    Write-Host "Fetching page $pageCount..." -ForegroundColor Cyan
    
    try {
        $response = Invoke-RestMethod -Uri $listUrl -Headers $headers -Method Get
    } catch {
        Write-Host "ERROR: Failed to list documents: $_" -ForegroundColor Red
        exit 1
    }
    
    if ($response.documents) {
        foreach ($doc in $response.documents) {
            $totalScanned++
            
            # Extract doc ID from full path
            # Format: projects/rel-str/databases/(default)/documents/heatmap-snapshots/QQQ-DAILY-2026-H1
            $docId = $doc.name.Split('/')[-1]
            
            # Apply baseline filter if specified
            $shouldDelete = $true
            if ($BaselineFilter) {
                if (-not $docId.StartsWith("$BaselineFilter-")) {
                    $shouldDelete = $false
                    $totalSkipped++
                }
            }
            
            if ($shouldDelete) {
                if ($DryRun) {
                    Write-Host "  [DRY RUN] Would delete: $docId" -ForegroundColor Yellow
                    $totalDeleted++
                } else {
                    $deleteUrl = "https://firestore.googleapis.com/v1/$($doc.name)"
                    try {
                        Invoke-RestMethod -Uri $deleteUrl -Headers $headers -Method Delete | Out-Null
                        $totalDeleted++
                        Write-Host "  Deleted: $docId" -ForegroundColor Green
                    } catch {
                        $totalFailed++
                        Write-Host "  FAILED: $docId - $_" -ForegroundColor Red
                    }
                }
            }
        }
    } else {
        Write-Host "  No documents in this page." -ForegroundColor Gray
    }
    
    $pageToken = $response.nextPageToken
    
    # Small delay to be polite to API
    if ($pageToken) {
        Start-Sleep -Milliseconds 100
    }
    
} while ($pageToken)

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Total scanned:  $totalScanned"
Write-Host "Total deleted:  $totalDeleted" -ForegroundColor $(if ($totalDeleted -gt 0) { 'Green' } else { 'Gray' })
Write-Host "Total skipped:  $totalSkipped" -ForegroundColor Gray
Write-Host "Total failed:   $totalFailed" -ForegroundColor $(if ($totalFailed -gt 0) { 'Red' } else { 'Gray' })
Write-Host "Pages fetched:  $pageCount"
Write-Host ""

if ($DryRun) {
    Write-Host "This was a DRY RUN. No documents were actually deleted." -ForegroundColor Yellow
    Write-Host "Run without -DryRun to perform actual deletion." -ForegroundColor Yellow
} else {
    Write-Host "Deletion complete." -ForegroundColor Green
}
