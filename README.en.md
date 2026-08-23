# Secure Local Workspace MCP

[中文](README.md) | English

Connect ChatGPT or Codex to locally approved projects without exposing an arbitrary shell. Discover Git repositories and common non-Git projects under trusted parent folders, inspect and edit files, run allowlisted tasks, and use guarded commit or controlled push only when the selected project is a Git root.

## Fast setup on Windows

```powershell
git clone https://github.com/dxawdc/secure-local-workspace-mcp.git
Set-Location .\secure-local-workspace-mcp

.\scripts\quick-setup.ps1 `
  -ProjectRoot "D:\Projects\my-app" `
  -DiscoveryRoot "D:\Projects" `
  -RestartTunnel
```

The script installs locked dependencies, runs tests, authorizes the selected project, detects common npm tasks, approves a parent folder for project discovery, and restarts an existing Tunnel runtime. Push is disabled by default; commit and push are automatically disabled for non-Git projects.

For a first-time Secure MCP Tunnel setup:

```powershell
.\scripts\quick-setup.ps1 `
  -ProjectRoot "D:\Projects\my-app" `
  -DiscoveryRoot "D:\Projects" `
  -TunnelId "tunnel_REPLACEME" `
  -TunnelClient "C:\Tools\tunnel-client\tunnel-client.exe" `
  -ControlPlaneApiKeyRef "file:C:\Secrets\openai-tunnel-runtime-key.txt" `
  -RegisterStartup `
  -StartTunnel
```

Creating the Tunnel, generating its Runtime API Key, downloading the official client, and accepting the ChatGPT connection remain explicit user-controlled steps.

## Safety model

- Projects can be connected from ChatGPT only beneath locally approved discovery roots.
- Common non-Git projects are discoverable, and any explicit directory beneath an approved root can be connected with Git permissions forced off.
- Existing-file edits and deletes require the latest SHA-256 returned by `read_file`.
- Tasks are fixed command-and-argument allowlists.
- Commits require an unchanged reviewed status hash and explicit relative paths.
- Pre-existing staged changes are never mixed into a commit.
- Staged files are checked for sensitive paths, high-confidence secrets, and Git whitespace errors.
- Push is a separate, locally enabled action restricted to configured remotes and branches.
- There is no arbitrary shell, broad staging, force push, history rewrite, or deployment tool.

## ChatGPT workflow

```text
Discover the approved local projects and connect my-app if needed.
Inspect the requested behavior, make the smallest change, and run the allowlisted tests.
Show git_diff and git_status. Commit only the explicit files for this change using
the latest statusSha256. Do not push.
```

To enable controlled push for one project:

```powershell
.\scripts\quick-setup.ps1 `
  -ProjectRoot "D:\Projects\my-app" `
  -AllowPush `
  -AllowedRemote "origin" `
  -AllowedBranch "main" `
  -SkipInstall `
  -SkipTests `
  -RestartTunnel
```

See the [Chinese README](README.md) and [Windows automation guide](docs/automation.zh-CN.md) for the full workflow.

## Validation

```powershell
npm ci
npm test
npm run smoke:mcp
npm audit --omit=dev
```

Official OpenAI references: [MCP and Connectors](https://developers.openai.com/api/docs/guides/tools-connectors-mcp) and [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

## License

MIT
