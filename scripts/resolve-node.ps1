$ErrorActionPreference = "Stop"

$candidatePaths = @()

if ($env:CODEX_NODE) {
  $candidatePaths += $env:CODEX_NODE
}

$candidatePaths += "C:\Users\Tatsu\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
  $candidatePaths += $nodeCommand.Source
}

foreach ($candidate in $candidatePaths) {
  if (-not $candidate) {
    continue
  }

  if (Test-Path $candidate) {
    try {
      & $candidate --version *> $null
      & $candidate @args
      exit $LASTEXITCODE
    } catch {
      continue
    }
  }
}

Write-Error "Node.js was not found. Install Node.js LTS or set CODEX_NODE to the node.exe path."
exit 1
