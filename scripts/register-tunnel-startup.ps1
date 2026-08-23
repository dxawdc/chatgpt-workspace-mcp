[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [string]$TunnelClient,

  [string]$Profile = "secure-local-workspace-mcp",

  [string]$ProfileDir = (Join-Path $env:USERPROFILE ".secure-local-workspace-mcp\tunnel-profiles"),

  [string]$TaskName = "Secure Local Workspace MCP Tunnel",

  [switch]$StartNow,

  [switch]$Force
)

$ErrorActionPreference = "Stop"

$clientPath = if (Test-Path -LiteralPath $TunnelClient -PathType Leaf) {
  (Resolve-Path -LiteralPath $TunnelClient).Path
} else {
  (Get-Command $TunnelClient -ErrorAction SilentlyContinue).Source
}
if (-not $clientPath) {
  throw "tunnel-client was not found. Pass its executable path or command name."
}

$resolvedProfileDir = [IO.Path]::GetFullPath($ProfileDir)
$profilePath = Join-Path $resolvedProfileDir "$Profile.yaml"
if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) {
  throw "Tunnel profile does not exist: $profilePath. Run setup-tunnel.ps1 first."
}

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask -and -not $Force) {
  throw "Scheduled task already exists: $TaskName. Use -Force only when replacement is intentional."
}

$actionArguments = 'run --profile "{0}" --profile-dir "{1}"' -f $Profile, $resolvedProfileDir
$action = New-ScheduledTaskAction -Execute $clientPath -Argument $actionArguments
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

if ($PSCmdlet.ShouldProcess($TaskName, "Register user logon tunnel task")) {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Description "Starts Secure Local Workspace MCP for ChatGPT and Codex." `
    -Force:$Force | Out-Null

  if ($StartNow) {
    Start-ScheduledTask -TaskName $TaskName
  }
}

[pscustomobject]@{
  TaskName = $TaskName
  UserId = $userId
  TunnelClient = $clientPath
  Profile = $Profile
  ProfileDir = $resolvedProfileDir
  Started = [bool]$StartNow
}
