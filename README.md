# Local Project Workspace

A safety-scoped MCP server for using ChatGPT or Codex with explicitly authorized local project folders. It exposes a small set of bounded file, Git inspection, and allowlisted task tools instead of an arbitrary shell.

## Security model

- No project is authorized by default.
- Every path is resolved beneath a configured project root, including real-path checks against link traversal.
- Existing-file edits require the latest SHA-256 returned by `read_file`.
- New files use create-only semantics and cannot overwrite an existing path.
- Commands are limited to named tasks in the local configuration.
- There are no arbitrary shell, delete, commit, push, or deployment tools.

## Configure projects

The server reads `%USERPROFILE%\.local-project-workspace\config.json` by default. Set `LOCAL_PROJECT_WORKSPACE_CONFIG` to use another file.

Copy `config.example.json`, add only the project roots you want to expose, and keep `writable` false until write access is actually needed. Task commands and arguments are controlled by this local file; ChatGPT can select a task name but cannot supply arbitrary command text.

## Install and test

```powershell
git clone https://github.com/dxawdc/local-project-workspace.git
Set-Location .\local-project-workspace
npm ci
npm test
npm run smoke:mcp
```

To use the repository as a personal Codex plugin, place it at `%USERPROFILE%\plugins\local-project-workspace` or create a directory junction there. The default personal marketplace entry is stored at `%USERPROFILE%\.agents\plugins\marketplace.json`. Start a new Codex task after installing or refreshing the plugin so the MCP server and skill are discovered.

## Connect ChatGPT on the web

Use OpenAI Secure MCP Tunnel so the local stdio server remains private:

1. Create a tunnel in OpenAI Platform tunnel settings and associate it with the intended ChatGPT workspace.
2. Install `tunnel-client` from the current download link in tunnel settings.
3. Set `CONTROL_PLANE_API_KEY` for the current process using your approved secret-management method, then run the included setup script:

   ```powershell
   .\scripts\setup-tunnel.ps1 -TunnelId tunnel_REPLACE_WITH_YOURS
   ```

4. Keep `tunnel-client run --profile local-project-workspace` running.
5. In ChatGPT developer mode, create a private app from that tunnel and inspect the discovered tools before enabling it.

Do not store the tunnel runtime API key in this plugin, its configuration, shell history, or a Git repository.

## Private runtime data

Keep machine-specific state outside the repository. A typical Windows installation uses `%USERPROFILE%\.local-project-workspace` for the authorized-project configuration, tunnel profiles, downloaded tunnel client, logs, and secrets. Only `config.example.json` belongs in source control.

Before publishing a fork, inspect the complete committed tree for API keys, tokens, personal paths, private repository URLs, logs, and real project configuration.

## License

MIT
