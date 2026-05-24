$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path "$PSScriptRoot\..").Path
$pidFile = Join-Path $projectRoot ".local\server.pid"

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
      Write-Host "Stopped local deploy listener $($listener.OwningProcess)."
    }
  }
}

if (-not (Test-Path $pidFile)) {
  Write-Host "No local deploy PID file found."
  Stop-ProjectListener -Port 8080 -ProjectRoot $projectRoot
  exit 0
}

$pidValue = Get-Content $pidFile
$process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue

if ($process) {
  Stop-Process -Id $pidValue -Force
  Write-Host "Stopped local deploy process $pidValue."
} else {
  Write-Host "Local deploy process was not running."
}

Remove-Item $pidFile -Force
Stop-ProjectListener -Port 8080 -ProjectRoot $projectRoot
