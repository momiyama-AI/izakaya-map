$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path "$PSScriptRoot\..").Path
$localDir = Join-Path $projectRoot ".local"
$pidFile = Join-Path $localDir "server.pid"
$logFile = Join-Path $localDir "server.log"
$nodePath = "C:\Users\Tatsu\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

function Stop-ProjectListener {
  param(
    [int]$Port,
    [string]$ProjectRoot
  )

  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if ($processInfo -and $processInfo.CommandLine -like "*$ProjectRoot*") {
      Stop-Process -Id $listener.OwningProcess -Force
    }
  }
}

if (-not (Test-Path $localDir)) {
  New-Item -ItemType Directory -Force -Path $localDir | Out-Null
}

if (Test-Path $pidFile) {
  $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($oldPid) {
    $oldProcess = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
    if ($oldProcess) {
      Stop-Process -Id $oldPid -Force
    }
  }
}

Stop-ProjectListener -Port 8080 -ProjectRoot $projectRoot

$serverPath = Join-Path $projectRoot "src\server\server.js"
$databasePath = if ($env:DATABASE_PATH) { $env:DATABASE_PATH.Replace("'", "''") } else { (Join-Path $projectRoot ".local\izakaya-map.sqlite").Replace("'", "''") }
$requireTurso = if ($env:REQUIRE_TURSO) { $env:REQUIRE_TURSO.Replace("'", "''") } else { "false" }
$tursoDatabaseUrl = if ($env:TURSO_DATABASE_URL) { $env:TURSO_DATABASE_URL.Replace("'", "''") } else { "" }
$tursoAuthToken = if ($env:TURSO_AUTH_TOKEN) { $env:TURSO_AUTH_TOKEN.Replace("'", "''") } else { "" }
$googleMapsApiKey = if ($env:GOOGLE_MAPS_API_KEY) { $env:GOOGLE_MAPS_API_KEY.Replace("'", "''") } else { "" }
$googleMapsMapId = if ($env:GOOGLE_MAPS_MAP_ID) { $env:GOOGLE_MAPS_MAP_ID.Replace("'", "''") } else { "" }
$command = "`$env:PORT='8080'; `$env:NODE_ENV='production'; `$env:ADMIN_TOKEN='dev-admin-token'; `$env:DATABASE_PATH='$databasePath'; `$env:REQUIRE_TURSO='$requireTurso'; `$env:TURSO_DATABASE_URL='$tursoDatabaseUrl'; `$env:TURSO_AUTH_TOKEN='$tursoAuthToken'; `$env:GOOGLE_MAPS_API_KEY='$googleMapsApiKey'; `$env:GOOGLE_MAPS_MAP_ID='$googleMapsMapId'; & `"$nodePath`" `"$serverPath`" *> `"$logFile`""

$process = Start-Process -FilePath "powershell" -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
$process.Id | Set-Content $pidFile

Start-Sleep -Milliseconds 800

try {
  Invoke-RestMethod -Uri "http://localhost:8080/api/v1/health" -TimeoutSec 5 | Out-Null
  Write-Host "Local deploy is running: http://localhost:8080"
  Write-Host "PID: $($process.Id)"
} catch {
  Write-Host "Server failed to respond. Log:"
  if (Test-Path $logFile) {
    Get-Content $logFile
  }
  throw
}
