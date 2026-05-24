param(
  [string]$BaseUrl = "http://localhost:5173"
)

$ErrorActionPreference = "Stop"

Write-Host "Smoke testing $BaseUrl"

$health = Invoke-RestMethod -Uri "$BaseUrl/api/v1/health" -TimeoutSec 5
if ($health.status -ne "ok") {
  throw "Health check failed"
}

$areas = Invoke-RestMethod -Uri "$BaseUrl/api/v1/areas" -TimeoutSec 5
if ($areas.areas.Count -lt 2) {
  throw "Expected at least 2 areas"
}

$stores = Invoke-RestMethod -Uri "$BaseUrl/api/v1/stores?area_id=AREA-SHINJUKU&drink_category=highball&sort=price_asc" -TimeoutSec 5
if ($stores.stores.Count -lt 1) {
  throw "Expected stores for Shinjuku"
}

$storeId = $stores.stores[0].id
$detail = Invoke-RestMethod -Uri "$BaseUrl/api/v1/stores/$storeId" -TimeoutSec 5
if (-not $detail.store.id) {
  throw "Expected store detail"
}

$eventBody = @{
  type = "search_executed"
  areaId = "AREA-SHINJUKU"
  drinkCategory = "highball"
  metadata = @{
    sessionId = "SES-SMOKE"
    searchMethod = "area"
    occurredAt = (Get-Date).ToString("o")
  }
} | ConvertTo-Json -Depth 4

$event = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/events" -ContentType "application/json" -Body $eventBody -TimeoutSec 5
if (-not $event.event.id) {
  throw "Expected event id"
}

Write-Host "Smoke test passed."
