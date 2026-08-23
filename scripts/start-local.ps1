$ErrorActionPreference = "Stop"
$pluginRoot = Split-Path -Parent $PSScriptRoot
$configPath = if ($env:LOCAL_PROJECT_WORKSPACE_CONFIG) {
  $env:LOCAL_PROJECT_WORKSPACE_CONFIG
} else {
  $preferred = Join-Path $env:USERPROFILE ".secure-local-workspace-mcp\config.json"
  $legacy = Join-Path $env:USERPROFILE ".local-project-workspace\config.json"
  if ((Test-Path -LiteralPath $preferred) -or -not (Test-Path -LiteralPath $legacy)) {
    $preferred
  } else {
    $legacy
  }
}

if (-not (Test-Path -LiteralPath $configPath)) {
  throw "Configuration not found: $configPath. Copy config.example.json and authorize at least one project."
}

if (-not (Test-Path -LiteralPath (Join-Path $pluginRoot "node_modules"))) {
  throw "Dependencies are not installed. Run npm install in $pluginRoot first."
}

node (Join-Path $pluginRoot "src\server.mjs")
