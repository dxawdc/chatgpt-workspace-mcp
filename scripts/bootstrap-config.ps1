[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")]
  [string]$ProjectId,

  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot,

  [string]$ProjectLabel,

  [switch]$Writable,

  [switch]$AllowCommit,

  [switch]$AllowPush,

  [string]$ConfigPath = (Join-Path $env:USERPROFILE ".chatgpt-workspace-mcp\config.json"),

  [string[]]$IgnoreNames = @("node_modules", ".git", "dist", "build", "coverage"),

  [switch]$Force
)

$ErrorActionPreference = "Stop"

$pluginRoot = Split-Path -Parent $PSScriptRoot
$resolvedProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$resolvedConfigPath = [IO.Path]::GetFullPath($ConfigPath)
$arguments = @(
  (Join-Path $pluginRoot "scripts\configure.mjs"),
  "add-project",
  "--root", $resolvedProjectRoot,
  "--id", $ProjectId,
  "--label", $(if ($ProjectLabel) { $ProjectLabel } else { $ProjectId })
)
if ($Writable) { $arguments += "--writable" } else { $arguments += "--read-only" }
if ($AllowCommit) { $arguments += "--allow-commit" } else { $arguments += "--no-commit" }
if ($AllowPush) { $arguments += "--allow-push" } else { $arguments += "--no-push" }
foreach ($name in $IgnoreNames) { $arguments += @("--ignore", $name) }

if ($AllowCommit -and -not $Writable) { throw "-AllowCommit requires -Writable." }
if ($AllowPush -and -not $AllowCommit) { throw "-AllowPush requires -AllowCommit." }

if ($PSCmdlet.ShouldProcess($resolvedConfigPath, "Add or update one authorized project without replacing other projects")) {
  $previousConfig = [Environment]::GetEnvironmentVariable("LOCAL_PROJECT_WORKSPACE_CONFIG", "Process")
  try {
    $env:LOCAL_PROJECT_WORKSPACE_CONFIG = $resolvedConfigPath
    & node @arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Project configuration failed with exit code $LASTEXITCODE." }
  } finally {
    if ($null -eq $previousConfig) {
      Remove-Item Env:\LOCAL_PROJECT_WORKSPACE_CONFIG -ErrorAction SilentlyContinue -WhatIf:$false -Confirm:$false
    }
    else { $env:LOCAL_PROJECT_WORKSPACE_CONFIG = $previousConfig }
  }
}

[pscustomobject]@{
  ConfigPath = $resolvedConfigPath
  ProjectId = $ProjectId
  ProjectRoot = $resolvedProjectRoot
  Writable = [bool]$Writable
  AllowCommit = [bool]$AllowCommit
  AllowPush = [bool]$AllowPush
}
