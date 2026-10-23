# ChatGPT Workspace MCP

[中文](README.md) | English

Safely connect ChatGPT to explicitly approved local projects. ChatGPT can discover projects, inspect and edit files, search code, and run allowlisted tasks. For Git repositories it can also review diffs, create guarded local commits, and optionally push to a locally approved remote and branch.

The MCP server and project files remain on your computer. OpenAI Secure MCP Tunnel carries MCP calls without exposing a local port or granting an arbitrary shell.

<!-- caige-author:start -->
**Author: 才哥 (Cai Ge)** · WeChat Official Account: **可以叫我才哥**

Scan with WeChat to follow:

<img src="assets/caige-wechat-qrcode.jpg" alt="Follow 可以叫我才哥 on WeChat" width="172" height="172" />
<!-- caige-author:end -->

## Choose your path

| Situation | Start here |
| --- | --- |
| First installation; no Tunnel yet | [First-time installation](#first-time-installation) |
| Tunnel already works; add another project | [Add a project to an existing installation](#add-a-project-to-an-existing-installation) |
| Give this repository to a coding agent | [Let an AI agent configure it](#let-an-ai-agent-configure-it) |
| Ask ChatGPT to inspect, edit, or commit | [Daily ChatGPT workflows](#daily-chatgpt-workflows) |
| Allow a controlled push | [Enable controlled push separately](#enable-controlled-push-separately) |
| Diagnose a failure | [Troubleshooting](#troubleshooting) |

## Capabilities and safeguards

| Workflow | MCP tools | Main safeguard |
| --- | --- | --- |
| Diagnose and discover | `diagnostics`, `list_projects`, `discover_projects` | Searches only locally approved parent folders |
| Connect or revoke | `connect_project`, `disconnect_project` | Cannot escape an approved discovery root; revocation does not delete files |
| Inspect and search | `list_files`, `read_file`, `search_text` | File size, depth, count, and result limits |
| Edit files | `apply_patch`, `create_text_file`, `delete_text_file` | Existing-file writes require the latest SHA-256 |
| Run checks | `run_task` | Fixed command-and-argument allowlist only |
| Review Git state | `git_status`, `git_diff` | Fixed read-only Git operations with review hashes |
| Commit locally | `git_unstage`, `git_commit` | Explicit paths, unchanged status, secret scanning, no mixed staged work |
| Push | `git_push` | Disabled by default; restricted remote and branch; never force-pushes |

There is no arbitrary shell, `git add .`, force push, history rewrite, production deployment, or unrestricted disk access.

## First-time installation

The examples below use Windows PowerShell.

### 1. Check prerequisites

You need Git, Node.js 20 or later, Windows PowerShell, access to ChatGPT developer mode, and permission to create or use an OpenAI Secure MCP Tunnel.

```powershell
git --version
node --version
npm --version
```

To allow local commits, configure a Git identity if one is not already set:

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

### 2. Clone the repository

```powershell
git clone https://github.com/dxawdc/chatgpt-workspace-mcp.git
Set-Location .\chatgpt-workspace-mcp
```

If the upstream GitHub repository has not been renamed yet, the old clone URL can still be used. The local directory, package, and MCP service are named `chatgpt-workspace-mcp`.

### 3. Create an OpenAI Secure MCP Tunnel

Follow the [official Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels):

1. Create a Tunnel in OpenAI Platform.
2. Associate it with the ChatGPT workspace that will use it.
3. Create a Runtime API Key for `tunnel-client`.
4. Download the current official `tunnel-client`.
5. Record the `tunnel_id` and the local path to `tunnel-client.exe`.

These are account- and credential-sensitive actions. This project does not create, read, or approve them on your behalf.

### 4. Store the Runtime Key outside the repository

Do not place a Runtime Key in a README, configuration committed to Git, or PowerShell command history. One simple local option is a file outside the repository:

```powershell
New-Item -ItemType Directory -Path "C:\Secrets" -Force
notepad "C:\Secrets\openai-tunnel-runtime-key.txt"
```

Paste only the key into that file. In a team or production environment, use an approved secret manager and restrict file access.

### 5. Run the setup script

Replace all example values:

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

Parameter meanings:

- `ProjectRoot` is the exact Git or non-Git project ChatGPT may access.
- `DiscoveryRoot` is a parent folder beneath which ChatGPT may discover and connect projects.
- `TunnelId` is the real ID shown in OpenAI Platform.
- `TunnelClient` is the downloaded executable.
- `ControlPlaneApiKeyRef` references the key without embedding it in project configuration.

The script installs locked dependencies, runs unit and MCP smoke tests, authorizes the project, detects common `test`, `lint`, `build`, and `typecheck` npm scripts, creates and checks the Tunnel profile, and optionally registers a current-user logon task. Push remains disabled. Non-Git projects retain file access but always have commit and push disabled.

If outbound OpenAI traffic must use a proxy, append:

```powershell
-HttpProxy "http://127.0.0.1:7890"
```

Never approve a disk root, your entire user profile, or a broad private directory as `DiscoveryRoot`. Use a dedicated parent folder for source projects.

### 6. Create the private ChatGPT app

1. Enable developer mode in ChatGPT settings. Enterprise or Edu workspaces may require administrator approval.
2. Open [ChatGPT Plugins](https://chatgpt.com/plugins).
3. Add a developer-mode app.
4. Choose **Tunnel** as the connection type.
5. Select the Tunnel or enter its real `tunnel_id`.
6. Review the connection and create the app.

Keep `tunnel-client` running; otherwise ChatGPT cannot discover or call the tools.

### 7. Verify the connection

Select or mention the app in a new ChatGPT conversation and send:

```text
Call diagnostics and list_projects. Confirm that the local MCP behind the Tunnel is healthy.
List every authorized project and its read/write, commit, and push permissions.
Do not modify any file.
```

The project should appear and `allowPush` should normally be `false`. The current server exposes 17 tools. If ChatGPT still shows an older tool set, restart the Tunnel and refresh the app or open a new conversation.

## Let an AI agent configure it

You can open this whole repository in Codex, Claude Code, Cursor Agent, or another AI coding agent with local terminal access. The agent can inspect prerequisites, install dependencies, run tests, prepare and execute safe local setup commands, and report remaining manual steps.

Give the agent this prompt:

```text
Read README.en.md, SECURITY.md, package.json, and scripts/quick-setup.ps1 in this repository.
Help me deploy ChatGPT Workspace MCP on Windows.

Rules:
1. Start with read-only checks of Git, Node.js, npm, PowerShell, and the repository state.
2. Ask me for the missing ProjectRoot, DiscoveryRoot, TunnelId, tunnel-client.exe path,
   and Runtime Key file path. Never ask for, read, or print the Runtime Key itself.
3. Never place a key in the repository, chat, source code, or command line.
4. DiscoveryRoot must be a dedicated project parent folder I explicitly approve;
   never use a disk root or my entire user directory.
5. Run npm ci, npm test, and npm run smoke:mcp before configuration.
6. Run scripts/quick-setup.ps1 with my approved values. Keep push disabled by default.
7. Then run npm run config -- list, inspect the Tunnel profile and scheduled-task state,
   and summarize every change made.
8. Finish with the exact manual steps I must perform in OpenAI Platform and ChatGPT,
   plus a connection-verification prompt.
9. Stop for confirmation before account authorization, secret handling, broader directory access,
   enabling push, or overwriting an existing Tunnel profile.
```

A good handoff sequence is:

1. Let the agent perform only the initial inspection and list missing inputs.
2. Provide non-secret paths and the Tunnel ID.
3. Store the Runtime Key yourself and provide only its `file:` path.
4. Let the agent run tests and setup.
5. Review the final config, authorized roots, `git diff`, and manual instructions yourself.

An AI agent cannot safely replace your confirmation for OpenAI account permissions, Runtime Key creation, ChatGPT workspace association, app approval, broad filesystem access, or enabling push.

## Add a project to an existing installation

If this project created the Tunnel scheduled task, run:

```powershell
.\scripts\quick-setup.ps1 `
  -ProjectRoot "D:\Projects\another-app" `
  -DiscoveryRoot "D:\Projects" `
  -SkipInstall `
  -SkipTests `
  -RestartTunnel
```

This adds or updates one project without replacing other entries. If the scheduled task was created another way, omit `-RestartTunnel`, restart `tunnel-client` yourself, and refresh the ChatGPT app.

To grant read-only access:

```powershell
.\scripts\quick-setup.ps1 `
  -ProjectRoot "D:\Projects\reference-project" `
  -DiscoveryRoot "D:\Projects" `
  -ReadOnly `
  -SkipInstall `
  -SkipTests `
  -RestartTunnel
```

To allow editing but prohibit commits:

```powershell
.\scripts\quick-setup.ps1 `
  -ProjectRoot "D:\Projects\my-app" `
  -DiscoveryRoot "D:\Projects" `
  -DisableCommit `
  -SkipInstall `
  -SkipTests `
  -RestartTunnel
```

ChatGPT can also call `discover_projects` and `connect_project` for a directory beneath an approved discovery root. Common Node.js, Python, Java, Go, Rust, .NET, PHP, Ruby, Elixir, Swift, and CMake project markers are recognized. An explicit directory without a marker can still be connected if it is inside an approved root. Git permissions are automatically disabled for non-Git projects.

## Daily ChatGPT workflows

Use the project ID returned by `list_projects`.

### Inspect only

```text
Use ChatGPT Workspace MCP to inspect project my-app.
Confirm it with list_projects, then locate the code related to sign-in.
Explain the implementation and possible issues. Do not edit, commit, or push.
```

### Edit and test without committing

```text
Fix the duplicate-submission issue in project my-app.
Re-read every target file immediately before editing and use its latest SHA-256.
Change only files relevant to this issue. Run the allowed test or lint task.
Finish with git_status and git_diff. Do not commit or push.
```

### Edit, test, and create a local commit

```text
Fix the duplicate-submission issue in project my-app and run the relevant tests.
Show git_diff and git_status. If the diff contains only this task's changes,
use the latest statusSha256 and commit only the explicit changed files with message:
fix: prevent duplicate submissions
Report the local commit SHA. Do not push.
```

`git_commit` rejects broad paths, stale reviewed status, pre-existing staged work, sensitive paths, high-confidence secrets, Git whitespace errors, or projects without local commit permission. A successful commit is still local until a separate push succeeds.

## Enable controlled push separately

Push is an external write and must be enabled locally for one project. Restrict the branch whenever possible:

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

Then give ChatGPT a precise instruction:

```text
Inspect the current branch, HEAD, git_status, and commits waiting to be pushed for my-app.
Only if the workspace and commit are exactly as expected, push the current HEAD to the allowed origin/main.
Never force-push. Report the local commit SHA, remote branch, and push result separately.
```

`git_push` does not create a commit and cannot target an unapproved remote or branch.

## Configuration and maintenance

The preferred configuration path is outside the repository:

```text
%USERPROFILE%\.chatgpt-workspace-mcp\config.json
```

For upgrades, the server also reads the previous `.secure-local-workspace-mcp` and `.local-project-workspace` paths when the new path does not exist.

Inspect the effective configuration:

```powershell
npm run config -- list
```

The cross-platform configuration CLI can be used without PowerShell automation:

```powershell
npm run config -- add-discovery-root --root "D:\Projects"

npm run config -- add-project `
  --root "D:\Projects\my-app" `
  --writable `
  --allow-commit `
  --no-push
```

Update and validate the project:

```powershell
Set-Location .\chatgpt-workspace-mcp
git pull --ff-only
npm ci
npm test
npm run smoke:mcp
npm audit --omit=dev
```

Restart `tunnel-client` and refresh the ChatGPT app after code or tool-definition changes.

To revoke one project's access, ask ChatGPT to call `disconnect_project`. This changes only local authorization; it does not delete files or Git history.

To remove the default startup task:

```powershell
Stop-ScheduledTask -TaskName "ChatGPT Workspace MCP Tunnel"
Unregister-ScheduledTask -TaskName "ChatGPT Workspace MCP Tunnel" -Confirm:$false
```

## Troubleshooting

### `Git commit identity is missing`

Configure `user.name` and `user.email`, then rerun setup.

### `Scheduled task not found`

You used `-RestartTunnel`, but the default task was not registered by this project. Omit that switch and restart the client using your existing method.

### ChatGPT cannot see the Tunnel or tools

Check that the Tunnel is associated with the correct ChatGPT workspace, the account has Tunnel read/use permission, developer mode is enabled, and `tunnel-client` is healthy and running. After a server update, restart the runtime, run `tunnel-client doctor --profile <profile> --explain`, refresh the app, and start a new conversation to avoid cached tool definitions.

### A project cannot be discovered or connected

Confirm that it is beneath an approved `DiscoveryRoot` and inspect `npm run config -- list`. Non-Git projects show `projectType: non-git` and always have commit and push disabled.

### A write is rejected or its SHA is stale

The project must be writable. ChatGPT must call `read_file` again immediately before changing or deleting an existing file. A change from another process invalidates the old SHA by design.

### Tunnel calls time out

Check outbound access to `api.openai.com:443`, firewall and organization policy, and proxy configuration. Browser proxy settings do not necessarily apply to `tunnel-client`; configure `-HttpProxy` explicitly when required.

For detailed Windows automation, proxy, startup, rollback, and unattended setup notes, see [docs/automation.zh-CN.md](docs/automation.zh-CN.md). For the threat model and vulnerability reporting, see [SECURITY.md](SECURITY.md).

## Official references

- [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [OpenAI MCP and Connectors](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)

## License

MIT
