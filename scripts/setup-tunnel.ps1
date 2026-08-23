param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern("^tunnel_[A-Za-z0-9]+$")]
  [string]$TunnelId,

  [string]$Profile = "secure-local-workspace-mcp",

  [string]$TunnelClient = "tunnel-client",

  [ValidatePattern("^(env|file):.+$")]
  [string]$ControlPlaneApiKeyRef = "env:CONTROL_PLANE_API_KEY",

  [string]$ProfileDir,

  [ValidatePattern("^https?://")]
  [string]$HttpProxy,

  [switch]$Force
)

$ErrorActionPreference = "Stop"

if ($ControlPlaneApiKeyRef.StartsWith("env:")) {
  $variableName = $ControlPlaneApiKeyRef.Substring(4)
  if (-not [Environment]::GetEnvironmentVariable($variableName)) {
    throw "The environment variable referenced by ControlPlaneApiKeyRef is not set."
  }
} elseif ($ControlPlaneApiKeyRef.StartsWith("file:")) {
  $secretPath = $ControlPlaneApiKeyRef.Substring(5)
  if (-not (Test-Path -LiteralPath $secretPath -PathType Leaf)) {
    throw "The API key file referenced by ControlPlaneApiKeyRef does not exist."
  }
}

$clientPath = if (Test-Path -LiteralPath $TunnelClient -PathType Leaf) {
  (Resolve-Path -LiteralPath $TunnelClient).Path
} else {
  (Get-Command $TunnelClient -ErrorAction SilentlyContinue).Source
}
if (-not $clientPath) {
  throw "tunnel-client was not found. Download the current release from OpenAI Platform tunnel settings."
}

$pluginRoot = Split-Path -Parent $PSScriptRoot
$serverPath = Join-Path $pluginRoot "src\server.mjs"
$portableServerPath = $serverPath.Replace("\", "/")
$mcpCommand = 'node "' + $portableServerPath + '"'

$initArguments = @(
  "init",
  "--sample", "sample_mcp_stdio_local",
  "--profile", $Profile,
  "--tunnel-id", $TunnelId,
  "--control-plane-api-key-ref", $ControlPlaneApiKeyRef,
  "--mcp-command", $mcpCommand,
  "--health-listen-addr", "127.0.0.1:0"
)
if ($ProfileDir) { $initArguments += @("--profile-dir", $ProfileDir) }
if ($Force) { $initArguments += "--force" }

& $clientPath @initArguments
if ($LASTEXITCODE -ne 0) {
  throw "tunnel-client init failed with exit code $LASTEXITCODE."
}

$doctorArguments = @("doctor", "--profile", $Profile, "--explain")
if ($ProfileDir) { $doctorArguments += @("--profile-dir", $ProfileDir) }
if ($HttpProxy) {
  $profileBase = if ($ProfileDir) { $ProfileDir } else { Join-Path $env:USERPROFILE ".config\tunnel-client" }
  $profilePath = Join-Path $profileBase "$Profile.yaml"
  $profileConfig = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
  $profileConfig | Add-Member -NotePropertyName http_proxy -NotePropertyValue $HttpProxy -Force
  $profileJson = $profileConfig | ConvertTo-Json -Depth 20
  [IO.File]::WriteAllText($profilePath, $profileJson + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

& $clientPath @doctorArguments
if ($LASTEXITCODE -ne 0) {
  throw "tunnel-client doctor failed with exit code $LASTEXITCODE."
}

Write-Output "Tunnel profile is configured. Keep it online with:"
$profileDirArgument = if ($ProfileDir) { " --profile-dir `"$ProfileDir`"" } else { "" }
Write-Output "tunnel-client run --profile $Profile$profileDirArgument"
