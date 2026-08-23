param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern("^tunnel_[A-Za-z0-9]+$")]
  [string]$TunnelId,

  [string]$Profile = "local-project-workspace",

  [string]$TunnelClient = "tunnel-client"
)

$ErrorActionPreference = "Stop"

if (-not $env:CONTROL_PLANE_API_KEY) {
  throw "Set CONTROL_PLANE_API_KEY in this PowerShell session. Do not save it in the plugin or config file."
}

$client = Get-Command $TunnelClient -ErrorAction SilentlyContinue
if (-not $client) {
  throw "tunnel-client was not found. Download the current release from OpenAI Platform tunnel settings."
}

$pluginRoot = Split-Path -Parent $PSScriptRoot
$serverPath = Join-Path $pluginRoot "src\server.mjs"
$portableServerPath = $serverPath.Replace("\", "/")
$mcpCommand = 'node "' + $portableServerPath + '"'

& $client.Source init `
  --sample sample_mcp_stdio_local `
  --profile $Profile `
  --tunnel-id $TunnelId `
  --mcp-command $mcpCommand
if ($LASTEXITCODE -ne 0) {
  throw "tunnel-client init failed with exit code $LASTEXITCODE."
}

& $client.Source doctor --profile $Profile --explain
if ($LASTEXITCODE -ne 0) {
  throw "tunnel-client doctor failed with exit code $LASTEXITCODE."
}

Write-Output "Tunnel profile is configured. Keep it online with:"
Write-Output "tunnel-client run --profile $Profile"
