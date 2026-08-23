# Secure Local Workspace MCP（安全本地工作区 MCP）

[English](README.en.md) | 中文（默认）

让 ChatGPT 网页版安全连接本地项目：无论是否使用 Git，都可以查看、搜索和修改文件、运行白名单任务；Git 项目还可以检查差异、创建本地提交，并在用户显式授权后推送到指定远端和分支。

你不需要安装 Codex。ChatGPT 通过 OpenAI Secure MCP Tunnel 调用仍运行在你电脑上的 MCP 服务；项目目录和 MCP 端口不需要暴露到公网。

## 先选你的使用场景

| 你的情况 | 从哪里开始 |
| --- | --- |
| 第一次连接 ChatGPT，还没有 Tunnel | 按照[首次安装：从零连接 ChatGPT](#首次安装从零连接-chatgpt)操作 |
| Tunnel 已经能在 ChatGPT 中使用，只想增加项目 | 跳到[已有 Tunnel：接入一个新项目](#已有-tunnel接入一个新项目) |
| 已经接入项目，想让 ChatGPT 修改或提交 | 直接复制[日常使用提示词](#日常使用提示词) |
| 想允许 ChatGPT push | 先完成[单独启用受控 push](#单独启用受控-push) |
| 安装或连接报错 | 查看[常见问题](#常见问题) |

## 你会得到什么

| 工作流 | MCP 工具 | 关键保护 |
| --- | --- | --- |
| 发现项目 | `diagnostics`、`list_projects`、`discover_projects` | 识别 Git 仓库和常见非 Git 工程，只扫描预先批准的父目录 |
| 接入或撤销 | `connect_project`、`disconnect_project` | 不能越过批准范围；撤销不会删除项目文件 |
| 查看和搜索 | `list_files`、`read_file`、`search_text` | 限制目录、深度、数量和文件大小 |
| 修改文件 | `apply_patch`、`create_text_file`、`delete_text_file` | 修改或删除现有文件必须匹配最新 SHA-256 |
| 运行验证 | `run_task` | 只能运行配置好的固定任务 |
| 审查 Git | `git_status`、`git_diff` | 固定只读 Git 命令，并返回状态/差异哈希 |
| 本地提交 | `git_unstage`、`git_commit` | 明确文件、状态防并发、敏感扫描、不混入已有暂存内容 |
| 远端推送 | `git_push` | 默认关闭；只允许指定 remote/branch；禁止 force push |

项目不提供任意 Shell、`git add .`、强制推送、历史重写、生产部署或任意磁盘访问。

## 首次安装：从零连接 ChatGPT

以下流程以 Windows PowerShell 为例。通常只需完成一次。

### 第 1 步：检查前置条件

需要：

- Windows PowerShell；
- Git；
- Node.js 20 或更高版本；
- 可以使用 ChatGPT 开发人员模式；
- OpenAI Platform 中具有 Tunnel 所需权限。

检查本机命令：

```powershell
git --version
node --version
npm --version
```

如果准备让 ChatGPT 创建 Git commit，还要先设置 Git 身份。已经设置过可以跳过：

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

### 第 2 步：下载项目

```powershell
git clone https://github.com/dxawdc/secure-local-workspace-mcp.git
Set-Location .\secure-local-workspace-mcp
```

### 第 3 步：在 OpenAI 页面准备 Tunnel

按照 [OpenAI Secure MCP Tunnel 官方文档](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)完成以下操作：

1. 在 OpenAI Platform 创建 Tunnel；
2. 将 Tunnel 关联到准备使用它的 ChatGPT workspace；
3. 创建供 `tunnel-client` 使用的 Runtime API Key；
4. 下载官方最新版 `tunnel-client`；
5. 记录 `tunnel_id` 和 `tunnel-client.exe` 的本机路径。

这些步骤涉及账号权限和密钥，必须由用户在 OpenAI 页面确认，项目不会代替用户创建或读取账号凭据。

### 第 4 步：把 Runtime Key 保存到仓库外

不要把 Key 写进 README、项目配置、Git 或 PowerShell 命令历史。可以先创建一个仓库外文件：

```powershell
New-Item -ItemType Directory -Path "C:\Secrets" -Force
notepad "C:\Secrets\openai-tunnel-runtime-key.txt"
```

在记事本中粘贴 Runtime Key，只保留一行，保存后关闭。生产或团队环境应改用组织批准的密钥管理方案，并限制该文件的访问权限。

### 第 5 步：运行一键配置

把示例中的三个路径和 Tunnel ID 换成自己的值：

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

参数怎么填：

- `ProjectRoot`：这次要交给 ChatGPT 操作的项目目录，可以不是 Git 仓库；
- `DiscoveryRoot`：允许 ChatGPT 发现项目的父目录，通常是 `ProjectRoot` 的上一级；
- `TunnelId`：OpenAI Platform 显示的真实 `tunnel_id`；
- `TunnelClient`：下载并解压后的 `tunnel-client.exe`；
- `ControlPlaneApiKeyRef`：Runtime Key 文件路径，必须带 `file:` 前缀。

脚本会自动完成：

1. 使用锁文件安装 Node.js 依赖；
2. 运行单元测试和 MCP 冒烟测试；
3. 把项目设置为可读写并允许本地 commit；
4. 批准项目发现目录；
5. 自动识别 `package.json` 中的 `test`、`lint`、`build`、`typecheck`；
6. 创建并检查 Tunnel profile；
7. 注册当前用户登录自启动任务并立即启动 Tunnel。

默认不允许 push。非 Git 项目会自动保留文件读写能力，同时强制关闭 commit 和 push，不需要手动添加 `-DisableCommit`。

如果本机访问 OpenAI 必须经过代理，在命令末尾增加：

```powershell
-HttpProxy "http://127.0.0.1:7890"
```

### 第 6 步：在 ChatGPT 中创建私有应用

1. 在 ChatGPT 设置中启用开发人员模式。Enterprise/Edu 用户可能需要管理员授权；
2. 打开 [ChatGPT Plugins](https://chatgpt.com/plugins)；
3. 点击加号创建开发人员模式应用；
4. Connection 选择 **Tunnel**；
5. 选择刚创建的 Tunnel，或粘贴真实 `tunnel_id`；
6. 创建应用，等待 ChatGPT 发现工具。

官方说明要求 `tunnel-client` 保持运行；否则 ChatGPT 无法发现或调用工具。

### 第 7 步：验证连接

在 ChatGPT 新对话中选择或 `@` 这个应用，然后发送：

```text
调用 diagnostics 和 list_projects。
告诉我 Tunnel 后面的本地 MCP 是否正常，并列出已授权项目、读写权限、commit 权限和 push 权限。
不要修改任何文件。
```

正常情况下应看到项目列表，并且默认 `allowPush` 为 `false`。新版一共提供 17 个工具；如果仍显示旧工具，请重启 Tunnel 后在 ChatGPT 中刷新应用或新建对话。

## 已有 Tunnel：接入一个新项目

如果 Tunnel 和登录自启动任务都是通过本项目配置的，在仓库目录执行：

```powershell
.\scripts\quick-setup.ps1 `
  -ProjectRoot "D:\Projects\another-app" `
  -DiscoveryRoot "D:\Projects" `
  -SkipInstall `
  -SkipTests `
  -RestartTunnel
```

这会增加或更新项目配置，不会覆盖其他已授权项目。

如果没有使用本项目注册登录任务，请去掉 `-RestartTunnel`，配置完成后用原来的方式重启 `tunnel-client`。重启后在 ChatGPT 应用设置中刷新工具。

### 让 ChatGPT 自动接入非 Git 项目

常见的 Node.js、Python、Java、Go、Rust、.NET、PHP、Ruby、Elixir、Swift、CMake 等工程目录会被 `discover_projects` 自动识别。即使目录没有常见工程标识，也可以在已批准的 `DiscoveryRoot` 内通过明确绝对路径接入：

```text
调用 discover_projects，列出已批准目录中的 Git 和非 Git 项目。
把 D:\Projects\notes-app 接入为可读写项目。
如果它不是 Git 仓库，必须自动关闭 commit 和 push。
接入后调用 list_projects，确认 projectType 和最终权限。
```

ChatGPT 调用 `connect_project` 后配置会立即持久化并在当前 MCP 进程生效，不需要为单个项目再次重启 Tunnel。

### 只允许查看，不允许修改

```powershell
.\scripts\quick-setup.ps1 `
  -ProjectRoot "D:\Projects\reference-project" `
  -DiscoveryRoot "D:\Projects" `
  -ReadOnly `
  -SkipInstall `
  -SkipTests `
  -RestartTunnel
```

### 允许修改，但不允许 commit

```powershell
.\scripts\quick-setup.ps1 `
  -ProjectRoot "D:\Projects\my-app" `
  -DiscoveryRoot "D:\Projects" `
  -DisableCommit `
  -SkipInstall `
  -SkipTests `
  -RestartTunnel
```

### 只增加可发现的项目父目录

```powershell
.\scripts\quick-setup.ps1 `
  -DiscoveryRoot "E:\OtherProjects" `
  -SkipInstall `
  -SkipTests `
  -RestartTunnel
```

不要把 `DiscoveryRoot` 设置为磁盘根目录、整个用户目录或包含大量私人文件的目录。它应当是专门存放代码仓库的父目录。

## 日常使用提示词

项目名以 `list_projects` 返回的 ID 为准。以下提示词可以直接复制到 ChatGPT，再替换项目名和需求。

### 1. 只查看和分析

```text
使用 Secure Local Workspace MCP 检查项目 my-app。
先调用 list_projects 确认项目，再查看与登录流程有关的代码。
解释实现和可能的问题，不要修改文件，不要提交。
```

### 2. 修改并测试，但不提交

```text
检查项目 my-app 的重复提交问题并完成修复。
修改前重新读取目标文件并使用最新 SHA-256，只改与本次问题有关的文件。
运行项目允许的 test 或 lint 任务，最后展示 git_status 和 git_diff。
不要 commit，不要 push。
```

### 3. 修改、测试并创建本地提交

```text
修复项目 my-app 的重复提交问题。
运行相关测试，然后展示完整 git_diff 和 git_status。
确认差异只包含本次修改后，使用最新 statusSha256，
只提交本次涉及的明确文件，提交信息为：fix: prevent duplicate submissions。
提交后报告本地 commit SHA。不要 push。
```

### 4. 只提交已经完成的修改

```text
检查项目 my-app 当前 git_status 和 git_diff，不要继续改代码。
如果存在与本任务无关或已经预暂存的文件，停止并告诉我。
否则使用最新 statusSha256，只提交这些明确文件：src/example.js、test/example.test.js。
提交信息为：fix: handle duplicate submissions。不要 push。
```

`git_commit` 会拒绝：

- `.`、目录或项目外路径；
- 审查后已经变化的 Git 状态；
- 预先存在的 staged changes；
- `.env`、私钥、证书、密码库等敏感路径；
- 高可信 API Key、Token、私钥或真实 Tunnel/组织标识；
- `git diff --cached --check` 失败；
- 未在本机配置中启用 commit。

提交成功只代表本地已 commit，不代表已 push。

## 单独启用受控 push

Push 是外部写操作，所以必须在本机针对项目显式开启。建议同时限制目标分支：

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

然后在 ChatGPT 中明确要求：

```text
检查项目 my-app 当前分支、HEAD、git_status 和待推送 commit。
只有在工作区状态和 commit 都符合预期时，才把当前 HEAD 推送到允许的 origin/main。
禁止 force push。分别报告本地 commit SHA、远端分支和推送结果。
```

`git_push` 不会自动创建 commit，也不会推送到未配置的 remote 或 branch。

## 自动化与手工操作边界

| 操作 | 是否自动化 | 原因或说明 |
| --- | --- | --- |
| 安装依赖、运行测试 | 自动 | `quick-setup.ps1` 默认执行 |
| 增加发现目录和项目 | 自动 | 幂等更新，不覆盖其他项目 |
| 识别常见 npm 任务 | 自动 | 只加入固定任务白名单 |
| 创建、检查 Tunnel profile | 自动 | 需要用户提供 Tunnel ID、Client 路径和密钥引用 |
| 注册登录自启动 | 可选自动 | 使用 `-RegisterStartup -StartTunnel` |
| 创建 OpenAI Tunnel | 用户确认 | 涉及 OpenAI 组织和 workspace 权限 |
| 创建 Runtime API Key | 用户确认 | 密钥只应由用户或组织管理员管理 |
| 在 ChatGPT 创建应用 | 用户确认 | ChatGPT 会显示权限和连接确认界面 |
| Git commit | ChatGPT 按明确指令执行 | 默认需要审查状态与明确文件 |
| Git push | 本机授权后再由 ChatGPT 执行 | 默认关闭，remote/branch 受限 |

更详细的批量配置、代理、自启动、回滚和无人值守参考见：[Windows 自动化配置流程](docs/automation.zh-CN.md)。

## 配置管理

默认配置文件位于仓库外：

```text
%USERPROFILE%\.secure-local-workspace-mcp\config.json
```

如果新版配置不存在，服务会兼容读取旧路径：

```text
%USERPROFILE%\.local-project-workspace\config.json
```

查看当前配置：

```powershell
npm run config -- list
```

不使用 PowerShell 自动化时，也可以调用跨平台配置 CLI：

```powershell
npm run config -- add-discovery-root --root "D:\Projects"

npm run config -- add-project `
  --root "D:\Projects\my-app" `
  --writable `
  --allow-commit `
  --no-push
```

兼容脚本 `bootstrap-config.ps1` 也会幂等地增加或更新单个项目，不会替换整个配置。

## 更新项目

```powershell
Set-Location .\secure-local-workspace-mcp
git pull --ff-only
npm ci
npm test
npm run smoke:mcp
```

代码或工具定义更新后必须重启 `tunnel-client`，并在 ChatGPT 中刷新应用或新建对话。

## 撤销项目访问

在 ChatGPT 中发送：

```text
调用 disconnect_project 撤销项目 my-app 的 MCP 访问权限，然后重新列出项目。
```

这只会删除本地授权配置，不会删除项目目录、文件或 Git 历史。

如需移除登录自启动任务：

```powershell
Stop-ScheduledTask -TaskName "Secure Local Workspace MCP Tunnel"
Unregister-ScheduledTask -TaskName "Secure Local Workspace MCP Tunnel" -Confirm:$false
```

这不会删除 Tunnel、Runtime Key、profile 或项目文件。

## 常见问题

### `Git commit identity is missing`

先设置 Git 用户名和邮箱，再重新运行配置：

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

### `Scheduled task not found`

你使用了 `-RestartTunnel`，但 Tunnel 不是通过本项目注册的。去掉该参数完成项目配置，然后按原来的方式重启 `tunnel-client`。

### ChatGPT 中看不到 Tunnel

依次检查：

1. Tunnel 是否关联了当前 ChatGPT workspace，而不只是 Platform organization；
2. 当前账号是否有 Tunnels Read + Use；
3. ChatGPT 开发人员模式是否已启用；
4. `tunnel-client` 是否仍在运行并处于 healthy/ready 状态。

### ChatGPT 没有发现 17 个工具

- 重启 Tunnel runtime；
- 运行 `tunnel-client doctor --profile <profile> --explain`；
- 在 ChatGPT 应用设置中刷新；
- 新建一个 ChatGPT 对话，避免旧会话继续使用缓存的工具定义。

### 项目无法发现或接入

- 项目必须位于已批准的 `DiscoveryRoot` 内；
- Git 仓库和包含常见工程标识的非 Git 目录会自动出现在发现结果中；
- 没有工程标识的普通目录不会自动列出，但可以让 ChatGPT 使用它的明确绝对路径调用 `connect_project`；
- 非 Git 项目会显示 `projectType: non-git`，并强制关闭 commit 和 push；
- 运行 `npm run config -- list` 检查实际配置；
- 需要时重新添加父目录并重启 Tunnel。

### 写入被拒绝或提示 SHA 过期

- 项目必须允许写入；
- 修改或删除已有文件前，ChatGPT 必须重新调用 `read_file`；
- 文件被其他程序修改后，旧 SHA 会失效，这是正常的并发保护。

### Commit 因已有 staged changes 被拒绝

先让 ChatGPT 调用 `git_status` 检查。确认可以取消暂存时，再调用 `git_unstage` 处理明确文件；该操作不会丢弃工作区内容。

### Tunnel 本地正常，但 ChatGPT 调用超时

- 检查 `api.openai.com:443` 的出站连接；
- 浏览器能使用代理，不代表 `tunnel-client` 自动使用相同代理；
- 首次配置时通过 `-HttpProxy` 写入代理；
- 检查本机防火墙、代理证书和组织网络策略。

## 本地验证

```powershell
npm ci
npm test
npm run smoke:mcp
npm audit --omit=dev
```

本地 MCP 前台启动：

```powershell
.\scripts\start-local.ps1
```

Tunnel 状态至少应满足：

```text
process_running = true
healthy = true
ready = true
```

## 安全建议

- Discovery Root 应是专门的项目父目录，不要使用磁盘根目录或整个用户目录；
- 优先只启用 commit，确有需要时再按项目、remote 和 branch 启用 push；
- Runtime Key、Tunnel profile、真实配置和日志必须保存在仓库外；
- MCP commit 会临时禁用项目 Git hooks，测试和格式化应通过显式任务白名单运行；
- 推送前仍应核对明确的 commit SHA、remote 和 branch；
- 密钥一旦误提交，应立即吊销并清理完整 Git 历史。

安全设计与报告漏洞请参阅 [SECURITY.md](SECURITY.md)。

## 官方参考

- [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [OpenAI MCP and Connectors](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)

## License

MIT
