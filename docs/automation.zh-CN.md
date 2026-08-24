# Windows 自动化配置参考

本文面向希望快速部署 ChatGPT Workspace MCP 的 Windows 用户。自动化目标是减少 JSON 手工编辑和重复命令，同时保留账号、密钥、项目范围、commit 和 push 权限的人工控制。

## 自动化边界

仓库脚本可以自动完成：

- 安装锁定的 Node.js 依赖；
- 运行单元测试和 MCP 冒烟测试；
- 幂等增加或更新授权项目；
- 自动识别常见 npm 任务；
- 增加 ChatGPT 可发现项目的父目录；
- 创建和检查已有 Tunnel ID 对应的 profile；
- 注册当前用户登录自启动任务；
- 重启已有 runtime；
- 按项目配置 commit、remote 和 branch 权限。

以下操作必须由用户在官方界面或本机明确完成：

- 登录 OpenAI 并创建 Secure MCP Tunnel；
- 创建、保存或撤销 Runtime API Key；
- 下载并校验官方 `tunnel-client`；
- 接受 ChatGPT 私有应用风险提示；
- 决定哪些父目录可用于项目发现；
- 决定哪些项目可写、可 commit 或可 push；
- 设置真实 Git 作者身份。

## 推荐目录

```text
源码仓库       D:\Tools\chatgpt-workspace-mcp
授权配置       %USERPROFILE%\.chatgpt-workspace-mcp\config.json
Tunnel profile %USERPROFILE%\.chatgpt-workspace-mcp\tunnel-profiles\
Runtime Key    C:\Secrets\openai-tunnel-runtime-key.txt
项目父目录     D:\Projects\
```

不要把 Runtime Key、真实配置或 profile 放在源码仓库中。

## 场景一：已有 Tunnel，一条命令接入项目

```powershell
Set-Location "D:\Tools\chatgpt-workspace-mcp"

.\scripts\quick-setup.ps1 `
  -ProjectRoot "D:\Projects\my-app" `
  -DiscoveryRoot "D:\Projects" `
  -RestartTunnel
```

默认行为：

- 项目可读写；
- 允许本地 commit；
- 不允许 push；
- 安装依赖并执行完整测试；
- 自动检测 `test`、`lint`、`build`、`typecheck` npm scripts；
- 重启 `chatgpt-workspace-mcp` runtime。

项目必须已经设置 Git 身份：

```powershell
git -C "D:\Projects\my-app" config user.name "Your Name"
git -C "D:\Projects\my-app" config user.email "you@example.com"
```

也可以使用全局 Git 配置。

## 场景二：首次完整部署

先在 OpenAI Platform 创建 Tunnel 和 Runtime Key，并下载官方客户端。然后：

```powershell
$RepositoryRoot = "D:\Tools\chatgpt-workspace-mcp"
$ProjectRoot = "D:\Projects\my-app"
$ProjectsRoot = "D:\Projects"
$TunnelClient = "C:\Tools\tunnel-client\tunnel-client.exe"
$RuntimeKeyFile = "C:\Secrets\openai-tunnel-runtime-key.txt"
$TunnelId = "tunnel_REPLACEME"

Set-Location $RepositoryRoot

.\scripts\quick-setup.ps1 `
  -ProjectRoot $ProjectRoot `
  -DiscoveryRoot $ProjectsRoot `
  -TunnelId $TunnelId `
  -TunnelClient $TunnelClient `
  -ControlPlaneApiKeyRef ("file:" + $RuntimeKeyFile) `
  -RegisterStartup `
  -StartTunnel
```

代理环境增加：

```powershell
-HttpProxy "http://127.0.0.1:7890"
```

脚本顺序：依赖安装 → 测试 → 配置写入 → `tunnel-client init` → `doctor --explain` → 注册计划任务 → 启动。

## 场景三：只读接入

```powershell
.\scripts\quick-setup.ps1 `
  -ProjectRoot "D:\Projects\audit-only" `
  -ReadOnly `
  -SkipInstall `
  -SkipTests `
  -RestartTunnel
```

只读项目不能修改、删除、commit 或 push。

## 场景四：受控 push

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

建议始终设置 `AllowedBranch`。`git_push` 只会执行非强制的当前 HEAD 推送，不支持 force、删除远端分支或推送其他 ref。

## 场景五：批准新的项目库父目录

```powershell
.\scripts\quick-setup.ps1 `
  -DiscoveryRoot "E:\Repositories" `
  -SkipInstall `
  -SkipTests `
  -RestartTunnel
```

之后 ChatGPT 可通过 `discover_projects` 查看该目录内的 Git 仓库和带常见工程标识的非 Git 项目，并在用户批准工具调用后使用 `connect_project` 接入单个目录。没有工程标识的普通目录也可以通过已批准范围内的明确绝对路径接入。非 Git 项目会自动强制关闭 commit 和 push。发现过程默认限制深度、项目数和扫描目录数，不跟随目录符号链接。

不要批准磁盘根目录、用户主目录或包含大量隐私文件的目录。

## 跨平台配置 CLI

不使用 PowerShell 时，可以运行：

```powershell
npm run config -- add-discovery-root --root "D:\Projects"

npm run config -- add-project `
  --root "D:\Projects\my-app" `
  --writable `
  --allow-commit `
  --no-push `
  --remote origin `
  --branch main

npm run config -- list
```

设置 `LOCAL_PROJECT_WORKSPACE_CONFIG` 可选择非默认配置文件。写入采用同目录临时文件加原子替换，不会清空其他项目。

## 兼容配置脚本

`bootstrap-config.ps1` 适合只增加或更新一个项目：

```powershell
.\scripts\bootstrap-config.ps1 `
  -ProjectId "my-app" `
  -ProjectLabel "我的应用" `
  -ProjectRoot "D:\Projects\my-app" `
  -Writable `
  -AllowCommit
```

新版脚本不会覆盖整个配置。`-Force` 仅为旧调用兼容保留，不再触发全量替换。

## 自动化验证

```powershell
npm ci
npm test
npm run smoke:mcp
npm audit --omit=dev
```

检查 Tunnel：

```powershell
& $TunnelClient doctor `
  --profile chatgpt-workspace-mcp `
  --profile-dir "$env:USERPROFILE\.chatgpt-workspace-mcp\tunnel-profiles" `
  --explain

& $TunnelClient runtimes status chatgpt-workspace-mcp --json
```

至少确认：

```text
process_running = true
healthy = true
ready = true
```

## ChatGPT 验收提示词

```text
@ChatGPT Workspace MCP
调用 diagnostics、list_projects 和 discover_projects。
只列出项目权限，不读取代码。
```

```text
读取 my-app 的 README，进行一个可逆的小修改，运行允许的测试，
展示 git_diff 和 git_status，但不要提交。
```

```text
使用最新 statusSha256，只提交我刚才确认的明确文件。
不要包含其他改动，不要 push。分别报告 commit SHA 和 push 状态。
```

## 回滚

停止和删除计划任务：

```powershell
Stop-ScheduledTask -TaskName "ChatGPT Workspace MCP Tunnel" -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "ChatGPT Workspace MCP Tunnel" -Confirm:$false
```

这不会删除项目、配置、Runtime Key 或 OpenAI Platform 中的 Tunnel。

撤销单个项目授权可以在 ChatGPT 中调用 `disconnect_project`，或在本地审查并编辑配置。撤销授权不会删除项目文件或 Git 历史。

如不再使用 Tunnel，应在 OpenAI Platform 单独撤销 Runtime Key，并按需要删除 Tunnel。

## 隐私验收

公开 fork 或提交本仓库前检查：

```powershell
git status --short
git ls-files
```

不得提交：

- `.chatgpt-workspace-mcp/`、旧版 `.secure-local-workspace-mcp/` 或 `.local-project-workspace/`；
- 真实 `config.json`；
- Tunnel profile、Runtime Key、日志和下载文件；
- `.env`、私钥、证书或密码库；
- 真实 Tunnel ID、组织 ID 或个人绝对路径。

MCP 的提交扫描是最后一道保护，不替代 Git diff 审查、密钥管理和泄漏后的吊销流程。
