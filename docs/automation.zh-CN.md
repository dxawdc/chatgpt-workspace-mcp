# Windows 自动化配置参考

本文档提供可审计、可回滚的自动化配置流程。脚本不会创建 OpenAI 账号资源，也不会读取或输出 API Key 内容；Tunnel 创建、Runtime Key 创建以及 ChatGPT 风险确认仍需在官方界面完成。

## 自动化边界

可以自动化：

- 安装 Node 依赖和运行测试；
- 生成本地项目授权配置；
- 使用已有 Tunnel ID 和 Runtime Key 引用生成 profile；
- 运行 `doctor --explain`；
- 注册当前用户登录自启动任务；
- 通过 `healthz`、`readyz` 或 runtime status 验证状态。

不能由本仓库脚本自动化：

- 代替用户登录 OpenAI；
- 绕过验证码、MFA 或安全确认；
- 创建、显示或上传 API Key；
- 替用户接受 ChatGPT 第三方插件风险提示；
- 自动扩大项目目录或写入权限。

## 变量规划

在执行前明确以下值：

```powershell
$RepositoryRoot = "D:\Tools\secure-local-workspace-mcp"
$AuthorizedProject = "D:\Projects\my-app"
$TunnelClient = "C:\Tools\tunnel-client\tunnel-client.exe"
$TunnelId = "tunnel_REPLACE_ME"
$RuntimeKeyFile = "C:\Secrets\openai-tunnel-runtime-key.txt"
$StateRoot = Join-Path $env:USERPROFILE ".secure-local-workspace-mcp"
$ProfileDir = Join-Path $StateRoot "tunnel-profiles"
```

`RuntimeKeyFile` 必须位于仓库外，建议只允许当前 Windows 用户读取。脚本只把 `file:<path>` 引用写入 profile，不读取或回显密钥。

## 方案一：逐步自动化（推荐）

### 1. 安装和自检

```powershell
Set-Location $RepositoryRoot
npm ci
npm test
npm run smoke:mcp
npm audit --omit=dev
```

### 2. 生成只读授权配置

```powershell
.\scripts\bootstrap-config.ps1 `
  -ProjectId "my-app" `
  -ProjectLabel "我的应用" `
  -ProjectRoot $AuthorizedProject
```

先使用 `-WhatIf` 预览：

```powershell
.\scripts\bootstrap-config.ps1 `
  -ProjectId "my-app" `
  -ProjectRoot $AuthorizedProject `
  -WhatIf
```

只有确认 AI 可以修改该项目时才加入 `-Writable`。配置已存在时脚本拒绝覆盖，必须显式传入 `-Force`。

### 3. 生成 Tunnel profile

```powershell
.\scripts\setup-tunnel.ps1 `
  -TunnelId $TunnelId `
  -TunnelClient $TunnelClient `
  -ControlPlaneApiKeyRef ("file:" + $RuntimeKeyFile) `
  -ProfileDir $ProfileDir
```

需要 HTTP 代理时：

```powershell
.\scripts\setup-tunnel.ps1 `
  -TunnelId $TunnelId `
  -TunnelClient $TunnelClient `
  -ControlPlaneApiKeyRef ("file:" + $RuntimeKeyFile) `
  -ProfileDir $ProfileDir `
  -HttpProxy "http://127.0.0.1:7890"
```

已有 profile 默认不会被覆盖。确认替换后显式添加 `-Force`。

### 4. 前台验收

首次运行应使用前台模式，方便查看错误：

```powershell
& $TunnelClient run `
  --profile secure-local-workspace-mcp `
  --profile-dir $ProfileDir
```

在另一个 PowerShell 中检查：

```powershell
& $TunnelClient doctor `
  --profile secure-local-workspace-mcp `
  --profile-dir $ProfileDir `
  --explain
```

只有本地进程存在不代表远端可用。至少确认：

- `process_running = true`；
- `healthy = true`；
- `ready = true`；
- Tunnel 远端查询没有鉴权或网络错误。

### 5. 注册登录自启动

先预览：

```powershell
.\scripts\register-tunnel-startup.ps1 `
  -TunnelClient $TunnelClient `
  -ProfileDir $ProfileDir `
  -WhatIf
```

正式注册：

```powershell
.\scripts\register-tunnel-startup.ps1 `
  -TunnelClient $TunnelClient `
  -ProfileDir $ProfileDir
```

如需立即启动，添加 `-StartNow`。任务已存在时默认拒绝替换；确认后使用 `-Force`。

### 6. 验证计划任务

```powershell
Get-ScheduledTask -TaskName "Secure Local Workspace MCP Tunnel"
Get-ScheduledTaskInfo -TaskName "Secure Local Workspace MCP Tunnel"
```

计划任务直接运行 tunnel-client，不会把 Runtime Key 内容写入任务参数。profile 中只保存环境变量或文件引用。

## 方案二：可复制的一次性编排示例

下面的示例按顺序调用仓库脚本；任何一步失败都会停止：

```powershell
$ErrorActionPreference = "Stop"

Set-Location $RepositoryRoot
npm ci
npm test
npm run smoke:mcp

.\scripts\bootstrap-config.ps1 `
  -ProjectId "my-app" `
  -ProjectLabel "我的应用" `
  -ProjectRoot $AuthorizedProject

.\scripts\setup-tunnel.ps1 `
  -TunnelId $TunnelId `
  -TunnelClient $TunnelClient `
  -ControlPlaneApiKeyRef ("file:" + $RuntimeKeyFile) `
  -ProfileDir $ProfileDir

.\scripts\register-tunnel-startup.ps1 `
  -TunnelClient $TunnelClient `
  -ProfileDir $ProfileDir `
  -StartNow
```

此示例故意不包含真实 ID、路径和密钥，也不使用 `-Writable` 或 `-Force`。

## 多项目配置

`bootstrap-config.ps1` 用于安全创建首个配置。多项目环境建议在代码审查后编辑本地 `config.json`，为每个项目指定不同 ID、根目录、只读/可写状态和任务白名单。

不要把多个项目共同授权到过宽的父目录，例如磁盘根目录、用户主目录或整个开发盘。

## 代理环境

如果浏览器能访问 OpenAI，但 tunnel-client 连接超时，常见原因是浏览器读取了系统代理，而 tunnel-client 仍尝试直连。

处理顺序：

1. 确认代理监听地址和端口；
2. 用 `-HttpProxy` 把代理写入 profile；
3. 重新运行 doctor；
4. 检查日志中是否仍出现直连伪 IP；
5. 不要把带用户名/密码的代理 URL 提交到 Git。

## 回滚

停止并删除计划任务：

```powershell
Stop-ScheduledTask -TaskName "Secure Local Workspace MCP Tunnel" -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "Secure Local Workspace MCP Tunnel" -Confirm:$false
```

删除 profile 或配置前先确认精确路径。删除计划任务不会撤销 OpenAI Platform 中的 Tunnel 或 Runtime Key；如不再使用，应在官方界面单独撤销 Key，并按需要删除 Tunnel。

## 自动化后的隐私验收

```powershell
git status --short
git ls-files
```

确认 Git 中不存在：

- `.secure-local-workspace-mcp/`；
- `config.json`；
- `tunnel-profiles/`、`secrets/`、`downloads/`、`bin/`；
- `.env`、证书、私钥和日志；
- Runtime Key、Tunnel ID、组织 ID 或个人绝对路径。

公开仓库前应扫描最终提交树，而不仅是工作目录。
