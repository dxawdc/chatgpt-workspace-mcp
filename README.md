# Secure Local Workspace MCP（安全本地工作区 MCP）

[English](README.en.md) | 中文（默认）

一个面向 ChatGPT 和 Codex 的安全本地工作区网关。它通过 MCP 只暴露明确授权的项目目录，并提供受限的文件读取、搜索、补丁修改、Git 检查和白名单任务能力，不向模型开放任意 Shell、删除、提交、推送或部署权限。

## 适用场景

- 在 ChatGPT 网页端读取、分析和修改本机项目代码。
- 让 Codex 通过统一 MCP 工具访问用户明确授权的多个项目。
- 对写入操作增加目录边界、文件大小和 SHA-256 并发保护。
- 将测试、构建等操作限制为本地配置中的任务白名单。

## 功能与安全边界

| 能力 | 工具 | 约束 |
| --- | --- | --- |
| 项目发现 | `diagnostics`、`list_projects` | 只返回本地配置中授权的项目 |
| 文件浏览 | `list_files`、`read_file`、`search_text` | 限制目录、深度、文件数、大小和返回条数 |
| 文件写入 | `apply_patch`、`create_text_file` | 现有文件必须携带最新 SHA-256；新文件禁止覆盖 |
| Git 检查 | `git_status`、`git_diff` | 固定只读参数，不接受任意 Git 命令 |
| 项目任务 | `run_task` | 只能运行配置中预先声明的命令和参数 |

服务端会校验真实路径，阻止 `..`、绝对路径和符号链接逃逸。项目默认只读；只有将项目配置为 `writable: true` 后，写入工具才会生效。

本项目刻意不提供：

- 任意 Shell 或任意命令执行；
- 文件删除或覆盖式创建；
- Git commit、push、分支重写；
- 生产部署和远程服务器操作。

## 目录与隐私数据

仓库只存放源码、示例配置和自动化脚本。真实授权配置、API Key、隧道配置和日志必须位于仓库之外。

Windows 推荐目录：

```text
项目源码              <clone-directory>
授权配置              %USERPROFILE%\.secure-local-workspace-mcp\config.json
隧道 profile          %USERPROFILE%\.secure-local-workspace-mcp\tunnel-profiles\
运行时 API Key        用户自选的受保护文件或环境变量
tunnel-client         用户自选的本机工具目录
```

旧版 `%USERPROFILE%\.local-project-workspace\config.json` 仍会在新版路径不存在时自动读取，方便无中断升级。

## 环境要求

- Windows、macOS 或 Linux；自动化脚本以 Windows PowerShell 为主。
- Node.js 20 或更高版本。
- Git。
- 若连接 ChatGPT 网页端：OpenAI Platform 中可创建 Tunnel，并能在 ChatGPT 中使用开发人员模式。

## 完整人工配置流程

### 1. 获取源码并安装依赖

```powershell
git clone https://github.com/dxawdc/secure-local-workspace-mcp.git
Set-Location .\secure-local-workspace-mcp
npm ci
npm test
npm run smoke:mcp
```

### 2. 创建本地授权配置

推荐使用自动化脚本创建首个项目配置：

```powershell
.\scripts\bootstrap-config.ps1 `
  -ProjectId "my-app" `
  -ProjectLabel "我的应用" `
  -ProjectRoot "D:\Projects\my-app"
```

脚本默认创建只读项目。确认写入风险后，显式加入 `-Writable`：

```powershell
.\scripts\bootstrap-config.ps1 `
  -ProjectId "my-app" `
  -ProjectLabel "我的应用" `
  -ProjectRoot "D:\Projects\my-app" `
  -Writable `
  -Force
```

也可以复制 `config.example.json`，保存为：

```text
%USERPROFILE%\.secure-local-workspace-mcp\config.json
```

任务白名单示例：

```json
{
  "tasks": {
    "test": {
      "command": "npm",
      "args": ["test"],
      "timeoutSeconds": 300
    }
  }
}
```

ChatGPT 或 Codex 只能提交任务名 `test`，不能修改命令或参数。

### 3. 在本机启动并验证 MCP

```powershell
.\scripts\start-local.ps1
```

或：

```powershell
npm start
```

进程会通过标准错误输出实际配置路径和授权项目数量。MCP 本身使用 stdio，前台运行时没有 HTTP 页面。

### 4. 连接 Codex

仓库包含 `.codex-plugin/plugin.json`、`.mcp.json` 和配套 skill。个人插件兼容 ID 仍为 `local-project-workspace`，用于避免已有安装失效；展示名称已经更新为 Secure Local Workspace MCP。

将仓库放在 `%USERPROFILE%\plugins\local-project-workspace`，或创建指向克隆目录的 Junction，然后通过个人 marketplace 安装/刷新插件。更新后请新建 Codex 任务，使 MCP 和 skill 重新载入。

### 5. 创建 OpenAI Secure MCP Tunnel

1. 在 OpenAI Platform 的 Tunnel 管理页创建一个 Tunnel，并绑定目标 ChatGPT 工作区。
2. 创建独立的 Runtime API Key。长期运行进程只使用 Runtime Key，不要使用 Admin Key。
3. 下载 OpenAI 官方 `tunnel-client`，校验发布页提供的 SHA-256 后解压。
4. 将 Runtime API Key 放入仓库外的受保护文件，或通过组织批准的密钥管理工具注入环境变量；绝不写入命令历史、配置示例或 Git。
5. 使用脚本创建并检查 profile。

推荐使用受 ACL 保护的文件引用。以下命令只传递文件路径，不读取或打印密钥内容：

```powershell
.\scripts\setup-tunnel.ps1 `
  -TunnelId "tunnel_REPLACE_ME" `
  -TunnelClient "C:\Tools\tunnel-client\tunnel-client.exe" `
  -ControlPlaneApiKeyRef "file:C:\Secrets\openai-tunnel-runtime-key.txt" `
  -ProfileDir "$env:USERPROFILE\.secure-local-workspace-mcp\tunnel-profiles"
```

如果电脑通过本地代理访问 OpenAI：

```powershell
.\scripts\setup-tunnel.ps1 `
  -TunnelId "tunnel_REPLACE_ME" `
  -TunnelClient "C:\Tools\tunnel-client\tunnel-client.exe" `
  -ControlPlaneApiKeyRef "file:C:\Secrets\openai-tunnel-runtime-key.txt" `
  -ProfileDir "$env:USERPROFILE\.secure-local-workspace-mcp\tunnel-profiles" `
  -HttpProxy "http://127.0.0.1:7890"
```

脚本会运行 `tunnel-client init` 和 `doctor --explain`。检查通过后，前台启动：

```powershell
& "C:\Tools\tunnel-client\tunnel-client.exe" run `
  --profile secure-local-workspace-mcp `
  --profile-dir "$env:USERPROFILE\.secure-local-workspace-mcp\tunnel-profiles"
```

### 6. 在 ChatGPT 网页端创建私有插件

1. 打开 ChatGPT 设置并启用开发人员模式。
2. 进入插件页面，选择“创建应用”。
3. 连接方式选择 Tunnel，选中刚创建的 Tunnel 或输入 Tunnel ID。
4. 本服务自身不需要额外 OAuth，身份验证选择“无身份验证”。Tunnel Runtime Key 只在本机客户端和 OpenAI 控制平面之间使用。
5. 阅读风险提示，确认后创建并连接。
6. 检查是否发现 10 个工具，再执行一次只读验证。

验证提示词：

```text
@Secure Local Workspace MCP 调用 list_projects，只返回项目名称和是否可写。
```

修改提示词：

```text
@Secure Local Workspace MCP 读取 my-app 的 README.md，先说明修改计划，再用哈希保护补丁修改并展示 git_diff。
```

## 自动化配置流程

仓库提供三个 Windows PowerShell 脚本：

1. `bootstrap-config.ps1`：创建授权项目配置，不处理任何密钥。
2. `setup-tunnel.ps1`：生成 Tunnel profile 并运行 doctor。
3. `register-tunnel-startup.ps1`：把已验证的 profile 注册为当前用户登录任务。

完整自动化范例、参数说明、回滚方式和 CI/运维建议请参阅：[自动化配置参考](docs/automation.zh-CN.md)。

## 日常操作

### 查看本地配置诊断

在 ChatGPT/Codex 中调用 `diagnostics` 和 `list_projects`。不要依赖模型猜测项目 ID。

### 更新项目

```powershell
git pull --ff-only
npm ci
npm test
npm run smoke:mcp
```

如果 MCP 工具定义发生变化，需要重启 tunnel-client，并在 ChatGPT 插件设置中刷新工具；Codex 需要新建任务。

### 停止登录自启动任务

```powershell
Stop-ScheduledTask -TaskName "Secure Local Workspace MCP Tunnel"
```

### 删除登录自启动任务

```powershell
Unregister-ScheduledTask -TaskName "Secure Local Workspace MCP Tunnel" -Confirm:$false
```

这只删除任务，不会删除 Tunnel、API Key、profile 或项目配置。

## 常见问题

### Tunnel 本地健康但 ChatGPT 调用超时

- 检查 `api.openai.com:443` 是否需要代理。
- 浏览器使用系统代理不代表 Go 编写的 tunnel-client 会自动读取同一代理。
- 为 profile 设置 `http_proxy`，或在启动进程中设置 `HTTPS_PROXY`。
- 使用 `tunnel-client runtimes status <alias> --json` 区分 `process_running`、`healthy`、`ready` 和远端查询错误。

### ChatGPT 没有发现工具

- 确认 tunnel-client 正在运行。
- 运行 `doctor --explain`。
- 确认 Tunnel 绑定了当前 ChatGPT 工作区。
- 在插件设置中点击“刷新”。
- 检查服务启动日志中的配置路径和授权项目数量。

### 项目列表为空

- 检查实际读取的是新版还是旧版配置路径。
- 也可以设置 `LOCAL_PROJECT_WORKSPACE_CONFIG` 指向明确的配置文件。
- 检查 JSON 格式、项目 ID 和项目根目录是否存在。

### 写入被拒绝

- 项目必须配置为 `writable: true`。
- 修改已有文件前必须重新调用 `read_file` 并使用最新 SHA-256。
- 文件变化后旧哈希会失效；这是预期的并发保护。

## 发布前隐私检查

公开 fork 或提交前至少检查：

- API Key、GitHub Token、私钥和证书；
- Tunnel ID、组织 ID、工作区 ID；
- 真实 `config.json`、日志、下载目录和运行时 profile；
- 个人用户名、绝对路径、私有仓库 URL；
- `node_modules`、构建产物和临时文件。

仓库的 `.gitignore` 已覆盖常见敏感路径，但不能替代提交树扫描和密钥吊销流程。

## License

MIT
