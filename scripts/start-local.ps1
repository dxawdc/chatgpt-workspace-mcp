$ErrorActionPreference = "Stop"
$pluginRoot = Split-Path -Parent $PSScriptRoot
$configPath = if ($env:LOCAL_PROJECT_WORKSPACE_CONFIG) {
  $env:LOCAL_PROJECT_WORKSPACE_CONFIG
} else {
  $preferred = Join-Path $env:USERPROFILE ".chatgpt-workspace-mcp\config.json"
  $legacyPaths = @(
    (Join-Path $env:USERPROFILE ".secure-local-workspace-mcp\config.json"),
    (Join-Path $env:USERPROFILE ".local-project-workspace\config.json")
  )
  $existingLegacy = $legacyPaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ((Test-Path -LiteralPath $preferred) -or -not $existingLegacy) { $preferred } else { $existingLegacy }
}

if (-not (Test-Path -LiteralPath $configPath)) {
  throw "Configuration not found: $configPath. Run scripts\quick-setup.ps1 or npm run config to authorize a project."
}

if (-not (Test-Path -LiteralPath (Join-Path $pluginRoot "node_modules"))) {
  throw "Dependencies are not installed. Run npm install in $pluginRoot first."
}

node (Join-Path $pluginRoot "src\server.mjs")
