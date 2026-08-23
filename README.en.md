# Secure Local Workspace MCP

[中文（默认）](README.md) | English

Secure Local Workspace MCP is a safety-scoped MCP gateway for connecting ChatGPT or Codex to explicitly authorized local project folders.

It provides bounded file discovery, reading, literal search, SHA-256-guarded patches, create-only text files, read-only Git inspection, and allowlisted project tasks. It deliberately exposes no arbitrary shell, delete, commit, push, or deployment tool.

## Quick start

```powershell
git clone https://github.com/dxawdc/secure-local-workspace-mcp.git
Set-Location .\secure-local-workspace-mcp
npm ci
npm test
npm run smoke:mcp

.\scripts\bootstrap-config.ps1 `
  -ProjectId "my-app" `
  -ProjectRoot "D:\Projects\my-app"

.\scripts\start-local.ps1
```

The generated project is read-only unless `-Writable` is explicitly supplied.

## ChatGPT tunnel

1. Create an OpenAI Secure MCP Tunnel and associate it with the intended ChatGPT workspace.
2. Create a separate Runtime API Key and keep it outside this repository.
3. Download and verify the official `tunnel-client` release.
4. Create a profile:

```powershell
.\scripts\setup-tunnel.ps1 `
  -TunnelId "tunnel_REPLACE_ME" `
  -TunnelClient "C:\Tools\tunnel-client\tunnel-client.exe" `
  -ControlPlaneApiKeyRef "file:C:\Secrets\openai-tunnel-runtime-key.txt" `
  -ProfileDir "$env:USERPROFILE\.secure-local-workspace-mcp\tunnel-profiles"
```

5. Keep `tunnel-client run` online, enable ChatGPT developer mode, create a private app from the Tunnel, select no additional authentication, and verify the discovered tools.

## Security

- No project is authorized by default.
- Real-path checks prevent traversal outside configured roots.
- Existing-file writes require the latest SHA-256 from `read_file`.
- New files use create-only semantics.
- Commands are limited to locally configured task names and fixed Git inspection commands.
- Secrets, real configuration, tunnel profiles, and logs must remain outside Git.

For the complete Chinese manual and troubleshooting guide, see [README.md](README.md). For Windows automation examples, see [docs/automation.zh-CN.md](docs/automation.zh-CN.md).

## License

MIT
