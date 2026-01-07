$TOKEN = "local-admin"

# 1) Refresh archives for recent days
# NOTE (2025-12): recomputeRegisteredBackfill now requires explicit
# `from`/`to` dates. The legacy `days`/`limit`/`yearsBack` fields are
# deprecated for RS/backfill and must not be used to drive the fetch
# window.

$today = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
$from  = (Get-Date).ToUniversalTime().AddDays(-20).ToString('yyyy-MM-dd')

$bodyArchive = @{
  phase       = "post"
  from        = $from
  to          = $today
  missingOnly = $false
  concurrency = 3
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5002/rel-str/us-central1/recomputeRegisteredBackfill" `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body $bodyArchive

# 2) Backfill signals/positions/activity for same window

$bodyBackfill = @{
  from   = $from
  to     = $today
  phase  = "post"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:5002/rel-str/us-central1/backfillSignalsPipelineAdmin" `
  -Headers @{ Authorization = "Bearer $TOKEN" } `
  -ContentType "application/json" `
  -Body $bodyBackfill
