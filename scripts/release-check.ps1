param(
  [string]$BaseUrl = "http://localhost:8080",
  [string]$AdminToken = "",
  [string]$ExpectedDatabaseProvider = "sqlite"
)

$ErrorActionPreference = "Stop"

function Invoke-JsonCheck {
  param(
    [string]$Path,
    [hashtable]$Headers = @{}
  )

  $uri = "$BaseUrl$Path"
  Write-Host "Checking $uri"
  return Invoke-RestMethod -Uri $uri -Headers $Headers -TimeoutSec 15
}

function Invoke-PageCheck {
  param([string]$Path)

  $uri = "$BaseUrl$Path"
  Write-Host "Checking $uri"
  $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 15
  if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
    throw "Unexpected status $($response.StatusCode) for $uri"
  }
}

$health = Invoke-JsonCheck -Path "/api/v1/health"
if ($health.status -ne "ok") {
  throw "Health check did not return ok."
}

if ($health.database.provider -ne $ExpectedDatabaseProvider) {
  throw "Unexpected database provider: $($health.database.provider)"
}

$areas = Invoke-JsonCheck -Path "/api/v1/areas"
if (-not $areas.areas -or $areas.areas.Count -lt 2) {
  throw "Areas endpoint returned too few areas."
}

$stores = Invoke-JsonCheck -Path "/api/v1/stores?area_id=AREA-SHINJUKU&drink_category=highball"
if (-not $stores.stores -or $stores.stores.Count -lt 1) {
  throw "Stores endpoint returned no stores."
}

Invoke-PageCheck -Path "/"
Invoke-PageCheck -Path "/admin.html"

if ($AdminToken) {
  $headers = @{
    "x-admin-token" = $AdminToken
    "x-admin-user" = "release-check"
  }
  $events = Invoke-JsonCheck -Path "/api/v1/admin/events" -Headers $headers
  if ($null -eq $events.events) {
    throw "Admin events endpoint did not return events array."
  }
} else {
  Write-Host "Admin API check skipped. Pass -AdminToken to enable it."
}

Write-Host "Release check passed: $BaseUrl"
