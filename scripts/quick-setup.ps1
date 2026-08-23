[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string[]]$ProjectRoot = @(),

  [string[]]$DiscoveryRoot = @(),

  [switch]$ReadOnly,

  [switch]$DisableCommit,

  [switch]$AllowPush,

  [string[]]$AllowedRemote = @("origin"),

  [string[]]$AllowedBranch = @(),

  [string]$ConfigPath,

  [switch]$SkipInstall,

  [switch]$SkipTests,

  [switch]$RestartTunnel,

  [string]$TunnelClient,

  [ValidatePattern("^tunnel_[A-Za-z0-9]+$")]
  [string]$TunnelId,

  [ValidatePattern("^(env|file):.+$")]
  [string]$ControlPlaneApiKeyRef = "env:CONTROL_PLANE_API_KEY",

  [string]$ProfileDir = (Join-Path $env:USERPROFILE ".secure-local-workspace-mcp\tunnel-profiles"),

  [string]$HttpProxy,

  [switch]$RegisterStartup,

  [switch]$StartTunnel,

  [switch]$ForceTunnelProfile,

  [string]$RuntimeAlias = "secure-local-workspace-mcp",

  [string]$ScheduledTaskName = "Secure Local Workspace MCP Tunnel"
)

$ErrorActionPreference = "Stop"
$pluginRoot = Split-Path -Parent $PSScriptRoot

if ($ProjectRoot.Count -eq 0 -and $DiscoveryRoot.Count -eq 0) {
  throw "Provide at least one -ProjectRoot or -DiscoveryRoot."
}
if ($ReadOnly -and $AllowPush) {
  throw "-AllowPush cannot be combined with -ReadOnly."
}
if ($DisableCommit -and $AllowPush) {
  throw "-AllowPush cannot be combined with -DisableCommit."
}
if ($StartTunnel -and -not $RegisterStartup) {
  throw "-StartTunnel requires -RegisterStartup."
}

$previousConfig = [Environment]::GetEnvironmentVariable("LOCAL_PROJECT_WORKSPACE_CONFIG", "Process")
try {
  if ($ConfigPath) {
    $env:LOCAL_PROJECT_WORKSPACE_CONFIG = [IO.Path]::GetFullPath($ConfigPath)
  }

  if (-not $SkipInstall -and $PSCmdlet.ShouldProcess($pluginRoot, "Install locked Node.js dependencies")) {
    & npm.cmd ci --ignore-scripts --prefix $pluginRoot
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }
  }

  if (-not $SkipTests -and $PSCmdlet.ShouldProcess($pluginRoot, "Run project tests and MCP smoke test")) {
    & npm.cmd test --prefix $pluginRoot
    if ($LASTEXITCODE -ne 0) { throw "npm test failed with exit code $LASTEXITCODE." }
    & npm.cmd run smoke:mcp --prefix $pluginRoot
    if ($LASTEXITCODE -ne 0) { throw "MCP smoke test failed with exit code $LASTEXITCODE." }
  }

  foreach ($root in $DiscoveryRoot) {
    $resolved = (Resolve-Path -LiteralPath $root).Path
    if ($PSCmdlet.ShouldProcess($resolved, "Approve as a ChatGPT project discovery root")) {
      & node (Join-Path $pluginRoot "scripts\configure.mjs") add-discovery-root --root $resolved
      if ($LASTEXITCODE -ne 0) { throw "Failed to add discovery root: $resolved" }
    }
  }

  foreach ($root in $ProjectRoot) {
    $resolved = (Resolve-Path -LiteralPath $root).Path
    $gitTopLevel = (& git -C $resolved rev-parse --show-toplevel 2>$null)
    $gitExitCode = $LASTEXITCODE
    $resolvedComparable = [IO.Path]::GetFullPath($resolved).TrimEnd(
      [IO.Path]::DirectorySeparatorChar,
      [IO.Path]::AltDirectorySeparatorChar
    )
    $gitComparable = if ($gitExitCode -eq 0 -and $gitTopLevel) {
      [IO.Path]::GetFullPath($gitTopLevel.Trim()).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
      )
    } else {
      $null
    }
    $isGitProject = $gitComparable -and [StringComparer]::OrdinalIgnoreCase.Equals($resolvedComparable, $gitComparable)
    if (-not $isGitProject -and $AllowPush) {
      throw "-AllowPush cannot be used for non-Git project: $resolved"
    }
    $effectiveAllowCommit = -not $ReadOnly -and -not $DisableCommit -and $isGitProject
    if (-not $isGitProject -and -not $ReadOnly -and -not $DisableCommit) {
      Write-Warning "Non-Git project detected; file editing stays enabled, while commit and push are disabled: $resolved"
    }
    if ($effectiveAllowCommit) {
      $gitName = (& git -C $resolved config user.name 2>$null)
      $gitEmail = (& git -C $resolved config user.email 2>$null)
      if (-not $gitName -or -not $gitEmail) {
        throw "Git commit identity is missing for $resolved. Configure git user.name and user.email, then rerun quick-setup."
      }
    }
    $arguments = @((Join-Path $pluginRoot "scripts\configure.mjs"), "add-project", "--root", $resolved)
    if ($ReadOnly) {
      $arguments += @("--read-only", "--no-commit", "--no-push")
    } else {
      $arguments += "--writable"
      if ($effectiveAllowCommit) { $arguments += "--allow-commit" } else { $arguments += "--no-commit" }
      if ($AllowPush -and $isGitProject) { $arguments += "--allow-push" } else { $arguments += "--no-push" }
    }
    foreach ($remote in $AllowedRemote) { $arguments += @("--remote", $remote) }
    foreach ($branch in $AllowedBranch) { $arguments += @("--branch", $branch) }
    if ($PSCmdlet.ShouldProcess($resolved, "Authorize project for ChatGPT")) {
      & node @arguments
      if ($LASTEXITCODE -ne 0) { throw "Failed to authorize project: $resolved" }
    }
  }

  if ($TunnelId -or $RegisterStartup -or $RestartTunnel) {
    if (-not $TunnelClient) {
      $candidateRoots = @(
        (Join-Path $env:USERPROFILE ".secure-local-workspace-mcp"),
        (Join-Path $env:USERPROFILE ".local-project-workspace")
      )
      $TunnelClient = $candidateRoots |
        Where-Object { Test-Path -LiteralPath $_ -PathType Container } |
        ForEach-Object { Get-ChildItem -LiteralPath $_ -Recurse -Filter tunnel-client.exe -File -ErrorAction SilentlyContinue } |
        Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $TunnelClient -or -not (Test-Path -LiteralPath $TunnelClient -PathType Leaf)) {
      throw "tunnel-client was not found. Pass -TunnelClient or run setup-tunnel.ps1 first."
    }
  }

  if ($TunnelId -and $PSCmdlet.ShouldProcess($TunnelId, "Create and validate the Secure MCP Tunnel profile")) {
    $setupArguments = @{
      TunnelId = $TunnelId
      TunnelClient = $TunnelClient
      ControlPlaneApiKeyRef = $ControlPlaneApiKeyRef
      ProfileDir = $ProfileDir
      Profile = $RuntimeAlias
      Force = $ForceTunnelProfile
    }
    if ($HttpProxy) { $setupArguments.HttpProxy = $HttpProxy }
    & (Join-Path $PSScriptRoot "setup-tunnel.ps1") @setupArguments
  }

  if ($RegisterStartup -and $PSCmdlet.ShouldProcess($ScheduledTaskName, "Register the tunnel login task")) {
    & (Join-Path $PSScriptRoot "register-tunnel-startup.ps1") `
      -TunnelClient $TunnelClient `
      -Profile $RuntimeAlias `
      -ProfileDir $ProfileDir `
      -TaskName $ScheduledTaskName `
      -StartNow:$StartTunnel
  }

  if ($RestartTunnel) {
    $task = Get-ScheduledTask -TaskName $ScheduledTaskName -ErrorAction SilentlyContinue
    if (-not $task) {
      throw "Scheduled task not found: $ScheduledTaskName. Register it first or restart tunnel-client manually."
    }
    if ($PSCmdlet.ShouldProcess($RuntimeAlias, "Restart the ChatGPT tunnel runtime")) {
      & $TunnelClient runtimes stop $RuntimeAlias --json | Out-Null
      Start-ScheduledTask -TaskName $ScheduledTaskName
    }
  }

  & node (Join-Path $pluginRoot "scripts\configure.mjs") list
} finally {
  if ($null -eq $previousConfig) {
    Remove-Item Env:\LOCAL_PROJECT_WORKSPACE_CONFIG -ErrorAction SilentlyContinue -WhatIf:$false -Confirm:$false
  } else {
    $env:LOCAL_PROJECT_WORKSPACE_CONFIG = $previousConfig
  }
}
