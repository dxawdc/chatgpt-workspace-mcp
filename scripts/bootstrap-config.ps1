[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")]
  [string]$ProjectId,

  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot,

  [string]$ProjectLabel,

  [switch]$Writable,

  [string]$ConfigPath = (Join-Path $env:USERPROFILE ".secure-local-workspace-mcp\config.json"),

  [string[]]$IgnoreNames = @("node_modules", ".git", "dist", "build", "coverage"),

  [switch]$Force
)

$ErrorActionPreference = "Stop"

$resolvedProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
if (-not (Test-Path -LiteralPath $resolvedProjectRoot -PathType Container)) {
  throw "ProjectRoot must be an existing directory."
}

$resolvedConfigPath = [IO.Path]::GetFullPath($ConfigPath)
if ((Test-Path -LiteralPath $resolvedConfigPath) -and -not $Force) {
  throw "Configuration already exists: $resolvedConfigPath. Use -Force only when replacement is intentional."
}

$label = if ($ProjectLabel) { $ProjectLabel } else { $ProjectId }
$config = [ordered]@{
  projects = @(
    [ordered]@{
      id = $ProjectId
      label = $label
      root = $resolvedProjectRoot
      writable = [bool]$Writable
      ignoreNames = $IgnoreNames
      tasks = [ordered]@{}
    }
  )
  limits = [ordered]@{
    maxReadBytes = 1048576
    maxReadLines = 1200
    maxSearchFileBytes = 1048576
    maxSearchFiles = 5000
    maxSearchResults = 200
    maxWriteBytes = 1048576
    maxCommandOutputBytes = 262144
  }
}

if ($PSCmdlet.ShouldProcess($resolvedConfigPath, "Write local workspace authorization configuration")) {
  $parent = Split-Path -Parent $resolvedConfigPath
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $json = $config | ConvertTo-Json -Depth 10
  [IO.File]::WriteAllText($resolvedConfigPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

[pscustomobject]@{
  ConfigPath = $resolvedConfigPath
  ProjectId = $ProjectId
  ProjectRoot = $resolvedProjectRoot
  Writable = [bool]$Writable
}
