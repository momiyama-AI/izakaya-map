$ErrorActionPreference = "Stop"

$env:DATABASE_PATH = if ($env:DATABASE_PATH) {
  $env:DATABASE_PATH
} else {
  Join-Path (Resolve-Path "$PSScriptRoot\..").Path ".local\izakaya-map.sqlite"
}

& "$PSScriptRoot\node.cmd" "$PSScriptRoot\..\src\data\init-db.js"

