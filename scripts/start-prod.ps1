$ErrorActionPreference = "Stop"

$env:PORT = if ($env:PORT) { $env:PORT } else { "8080" }
$env:ADMIN_TOKEN = if ($env:ADMIN_TOKEN) { $env:ADMIN_TOKEN } else { "dev-admin-token" }
$env:NODE_ENV = "production"

Write-Host "Starting production-like server on http://localhost:$env:PORT"
& "$PSScriptRoot\node.cmd" "$PSScriptRoot\..\src\server\server.js"
