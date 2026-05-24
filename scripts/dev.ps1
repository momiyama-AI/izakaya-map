$ErrorActionPreference = "Stop"

$env:PORT = if ($env:PORT) { $env:PORT } else { "5173" }
$env:ADMIN_TOKEN = if ($env:ADMIN_TOKEN) { $env:ADMIN_TOKEN } else { "dev-admin-token" }
$env:NODE_ENV = "development"

Write-Host "Starting development server on http://localhost:$env:PORT"
& "$PSScriptRoot\node.cmd" "$PSScriptRoot\..\src\server\server.js"
