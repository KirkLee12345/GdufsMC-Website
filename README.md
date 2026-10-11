# 云城像素社 GdufsMC-Website

广外我的世界同好交流会网站。Next.js 16 + Tailwind v4，`output: standalone`，跑在 Windows Server 上，由 GitHub Actions 自托管 Runner 构建并自动发布。

**这份文档覆盖全部运维知识**：项目结构、内容怎么改、怎么发布、服务器怎么维护、故障怎么排。
不需要再翻其它文档——原先分散在 `deploy/` 下的 5 份说明已全部并入本文。

## 目录

- [项目概览](#项目概览)
- [快速开始](#快速开始)
- [一、发布方式：GitHub 构建，服务器自动发布](#一发布方式github-构建服务器自动发布)
- [二、内容外置与内容自动同步](#二内容外置与内容自动同步)
- [三、完整构建自动发布](#三完整构建自动发布)
- [四、自动发布上线验收清单](#四自动发布上线验收清单)
- [五、部署后自动清 EdgeOne 缓存](#五部署后自动清-edgeone-缓存)
- [六、校园服务器初始化与迁移](#六校园服务器初始化与迁移)
- [七、架构与关键设计](#七架构与关键设计)
- [八、安全（分层防御）](#八安全分层防御)
- [九、日常运维](#九日常运维)
- [十、故障排查](#十故障排查)
- [十一、速查表](#十一速查表)

---

## 项目概览

| 项 | 值 |
|---|---|
| 框架 | Next.js 16（App Router、Turbopack） |
| UI | Tailwind CSS v4 + framer-motion + Tabler Icons |
| 运行时 | Node 24.21.0，`output: standalone` |
| 进程管理 | PM2（`deploy/ecosystem.config.js`，跨平台） |
| 反代 / HTTPS | Caddy（自动 ACME，basic auth） |
| CDN | 腾讯云 EdgeOne（HTML `s-maxage=86400`，发布后自动 purge） |
| CMS | Sveltia CMS（vendored 固定 commit，见 `scripts/cms/build-cms-release.mjs`） |
| 生产目录 | `H:\GDUFSMC-web` |
| 域名 | `gdufscraft.top` + `www.gdufscraft.top` |

### 渲染方式（混合）

实测各路由的 `x-nextjs-prerender` 响应头：

| 路由 | 渲染 | 原因 |
|---|---|---|
| `/`、`/guide`、`/map` | 构建期预渲染（SSG） | 数据来自编译进 bundle 的 `data/` |
| `/news`、`/news/[slug]` | 每请求现渲染（SSR，`force-dynamic`） | 读 `CONTENT_ROOT` 下的 `content/`，CMS 改完即时生效 |
| `/api/server-status` | 动态 API | 实时服务器状态 |
| `/api/admin/image-convert` | 动态 API | CMS 图片转换 |

分界线：**读 `content/` 的走动态，读 `data/` 的走静态。** 改 `data/` 需要重新发布，改 `content/` 只需跑一次内容同步。

所有 HTML 页面带 `s-maxage=86400`，即源站渲染结果在边缘缓存一天，靠发布后自动 purge 失效。

### 目录结构

```
├── app/                       路由（Server Components 为主）
│   ├── admin/                 CMS 入口（重写到 public/admin/index.html）
│   ├── api/admin/             图片转换接口
│   ├── api/server-status/     服务器状态接口
│   ├── content/[...path]/     content/ 下任意文件（含图片）
│   ├── guide/  map/  news/
├── components/
│   ├── global/                header-nav / footer / sw-register
│   ├── guide/  home/  map/  news/
├── lib/
│   ├── global/                 全站通用：utils/ logger/ server/（状态接口与共享常量）
│   ├── news/                   server-only 数据访问层（读 content/）+ leaderboard/ + slugify
│   ├── map/                    地图数据与几何变换 + search/（拼音搜索）
│   └── slugify-core.mjs        冻结：content-tools 生产打包契约，路径不可移动
├── data/                      编译进 bundle 的静态数据（server/map/guide/global）
├── content/                   CMS 管理的可编辑内容（news/ leaderboard/）
├── deploy/                    部署脚本（PowerShell）
├── scripts/                   构建/校验/测试脚本（build/ cms/ tests/ + content 工具）
├── public/                    静态资源（icons/ images/ admin/）
│   └── admin/config.yml        Sveltia CMS 配置
├── Caddyfile                  反代配置（手动复制到 H:\GDUFSMC-web\）
└── secrets.caddy.example      basic auth 哈希模板
```

## 快速开始

**本地开发**（开发机）：

```powershell
pnpm install
pnpm dev          # http://localhost:3000
```

跑回归：

```powershell
pnpm typecheck
pnpm lint
pnpm test:content                                     # 内容/打包/同步的 Node 用例
node scripts/tests/test-csp.mjs                             # CSP 策略不变量
powershell -NoProfile -File scripts/tests/test-content-operations.ps1   # PowerShell 侧
```

**日常发版**（开发机）：

```powershell
git push origin main
```

Actions 构建 → 自动投递 ZIP → 服务器管理员任务发布 → purge EdgeOne。**不需要在服务器上做任何事。**

若改的是 `content/`（新闻、积分榜），Actions 会走内容同步，只换数据不重建程序，见[第2章](#二内容外置与内容自动同步)。

---

## 一、发布方式：GitHub 构建，服务器自动发布

2026-10-03：新增完整构建自动发布。按[第3章](#三完整构建自动发布)安装独立管理员任务，再开启 `RELEASE_PUBLISH_ENABLED=true`：Actions 构建成功后自动投递 ZIP，服务器校验、解包、调用原 publisher，并回传结果。纯内容提交继续使用现有 `GdufsmcContentQueue`，见[第2章](#二内容外置与内容自动同步)。

> **以下为当前流程。** 后文的 self-hosted 初始化和服务器构建内容仅为历史参考，不要再次执行，也不要改动现有开机启动服务。

未开启自动发布时仍提供 artifact。管理员可把 ZIP 放进 `artifacts/`，运行 `release-tools/publish-from-artifacts.ps1 -DryRun` 预览，去掉 `-DryRun` 发布。这些低层手工步骤保留作排查参考，不要与自动发布并行运行。

### 1.1 手工发布流程（自动发布未启用时）

1. 提交并推送代码到 `main`（改造不会自动替你提交或推送）。在 Actions 的 `Deliver content or build release` 查看分流；初次迁移保持 `CONTENT_SYNC_ENABLED` 未设置或为 `false`，等待完整构建、类型检查、lint 和解包冒烟测试通过。
2. 完整构建提供两个发布 artifact：`content-sync-tools-...` 是管理员安装的固定工具与依赖，`windows-release-...` 是程序包及 publisher。将程序 artifact 解压到新的独立下载目录，应包含 `outputs/*.tar.gz`、同名 `.sha256.txt`、`deploy/publish-release.ps1`、**同目录的 `content-operations.ps1`** 和部署文档；不能只复制 publisher 单文件。只使用自己仓库可信提交生成的包；校验和用于检测损坏，不是来源认证。
3. 用 **WINSERVER08\Administrator 的管理员 PowerShell** 操作。先确认网站当前在 PM2 中 online，且本机 `http://127.0.0.1:3000/` 返回 200。现有 NETWORK SERVICE runner 通过固定客户端投递，不能直接调用管理员 publisher。
4. 在 artifact 解压目录运行下面的校验/解包命令，再执行发布。

```powershell
$ErrorActionPreference = 'Stop'
$archives = @(Get-ChildItem .\outputs\*.tar.gz)
if ($archives.Count -ne 1) { throw 'Expected exactly one archive' }
$archive = $archives[0]
$id = $archive.Name -replace '\.tar\.gz$', ''
$expected = ((Get-Content -LiteralPath ".\outputs\$id.sha256.txt" -Raw).Trim() -split '\s+')[0]
$actual = (Get-FileHash -LiteralPath $archive.FullName -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw 'SHA256 mismatch; stop here' }
$incoming = "H:\GDUFSMC-web\incoming\$id"
if (Test-Path -LiteralPath $incoming) { throw 'Use a fresh incoming directory' }
New-Item -ItemType Directory -Path $incoming | Out-Null
# Use the same explicit Windows tar executable as CI and automatic publishing.
& "$env:SystemRoot\System32\tar.exe" -xf $archive.FullName -C $incoming
if ($LASTEXITCODE -ne 0) { throw 'Archive extraction failed' }
$manifest = Get-Content "$incoming\release.json" -Raw | ConvertFrom-Json
$nodeVersion = (& 'C:\Program Files\nodejs\node.exe' --version).Trim().TrimStart('v')
if ($nodeVersion -ne $manifest.nodeVersion) { throw 'Node version differs from release; align versions before publishing' }
& .\deploy\publish-release.ps1 -ReleaseDirectory $incoming
```

工作流固定的 Node/pnpm 版本必须确实可下载；生产 Node 必须与发布清单中的版本完全一致。不要为通过校验直接替换正在运行的 Node；先核实服务器实际版本，再统一构建配置及运行时。

新版程序包通过 `contentSyncVersion: 1` 声明配套内容，保存于 `content-snapshot/{manifest.json,content/}`。publisher 先调用已安装的固定工具校验 sidecar，再用候选内容在临时回环端口验证程序。正式切换时先停止并移除 `gdufsmc`，保留旧内容后替换固定目录，再启动新程序，验证源站实际内容并记录配套代码/内容状态。失败会尝试恢复旧内容和旧进程。**切换使用 stop/delete/start，会有短暂停机，不是零停机发布。** 成功后执行 `pm2 save`；publisher 不修改既有开机服务或 Caddy，其他 PM2 应用不受操作。

成功发布后检查：

```powershell
& 'C:\npm\pm2.cmd' list
Invoke-WebRequest http://127.0.0.1:3000/__release.json -UseBasicParsing
Invoke-WebRequest https://gdufscraft.top/ -UseBasicParsing
```

如需回到上一个版本，在同一管理员会话运行：

```powershell
& .\deploy\publish-release.ps1 -Rollback
```

`H:\GDUFSMC-web\releases` 保留当前和上一个成功版本；只清理状态中明确被淘汰的旧成功版本。新版回滚同时恢复该程序版本对应的内容备份，并保留当前内容以便反向恢复。`content-backups/` 在每次**成功**发布或内容同步后自动剪枝到最新 10 份（`-ContentBackupRetention` 可调；当前 operation 和 `shared/content-state.json` 记录的那份永远保留，失败的发布不消耗名额，跳过项只告警不删）。`content-failed/` 和失败候选保留供排查，不自动清理。自动包装器每次尝试后清空 `incoming`，保留失败的 `candidate` 与本次 `artifacts`；原 publisher 单独运行不清 incoming。首次迁移的旧根目录也保留，不删除它：初次回滚还依赖旧文件。状态、journal 与私有 PM2 配置位于 `shared`，可能含环境变量，不要上传或公开。未完成 journal 会阻止后续发布，先按[第2章的恢复说明](#27-日常行为与恢复)核对和恢复。

---

## 二、内容外置与内容自动同步

### 2.1 内容外置

打包脚本在**不设置外置开关**时默认仍把 `content/` 放入 release；运行时未设置 `CONTENT_ROOT` 才会从 `<release>/content` 读取新闻、积分榜和图片。

CI 设置 `RELEASE_EXTERNAL_CONTENT=1`，运行时仍固定从 `CONTENT_ROOT=H:\GDUFSMC-web` 下的 `content/` 读取新闻、榜单和图片。程序包不带供运行时直接读取的顶层 `content/`，但现在附带 `content-snapshot/` 作为完整发布的配套输入；publisher 将其校验后同步到生产固定目录。

用户已选择始终使用 `H:\GDUFSMC-web\content\news`，接受短暂维护。站点继续读取 `CONTENT_ROOT=H:\GDUFSMC-web`，没有增加指针、版本图片 URL 或新的运行时接口。

### 2.2 实际流程

CMS 把内容保存并提交到 `main` 后，Actions 调用服务器上预先安装的工具。工具比较**生产代码 commit 到候选 commit** 的全部受检提交；只有均在 `content/` 内且内容版本向前时，才提交内容任务。代码曾改动又撤销仍要求完整发布；历史过长或 API 列表截断也保守转完整构建。

现有网络服务账户 runner 只写任务队列、读取结果。管理员计划任务每分钟检查一次队列，共用 `shared/deployment.lock`，下载候选的完整内容、校验字段/图片和文件哈希，复查 `main` 及生产版本，然后：

1. 确认只有一个 `gdufsmc`，其路径及 CONTENT_ROOT 与记录一致。
2. 停止这个 PM2 应用，确认进程已停。
3. 保留旧目录，将完整候选放到固定 `Root/content`。
4. 重启同一个应用，核对整个线上内容树的哈希、代码标记、新闻 slug/标题、一个详情的文本、前八名榜单玩家与分数，以及一个图片的完整字节。
5. 记录内容 commit，提交 EdgeOne purge 并查询结果。

正常更新有停服窗口，Caddy/源站访问可能短暂失败；这里没有实现专用维护页。下载与首次校验发生在停服前。整个同步只替换 `content` 数据；工具、状态和备份放在各自运维目录，业务代码与程序 release 不改变。

坏内容、过期任务不会开始停服。切换或健康检查异常会尝试恢复旧目录并重启；恢复不成功则明确失败并保留日志。进程被强杀、断电等留下未完成 journal 时，后续任务会停止并要求管理员检查，不宣称这种中断能无人值守恢复。

### 2.3 一次性上线步骤

#### 2.3.1 提交改造，先生成完整包

将本轮脚本、workflow、文档，以及希望上线的内容变更按审核流程提交到 `main`。本地图片重命名和正文引用属于用户已有修改，提交时一起核对，避免只提交其一。

暂不设置仓库变量 `CONTENT_SYNC_ENABLED`，或保持 `false`。Actions **Deliver content or build release** 会走完整构建，提供两个 artifact：

- `content-sync-tools-<commit>-<attempt>`：独立可运行的可信工具与依赖。
- `windows-release-<commit>-<attempt>`：程序归档、配套内容清单和管理员 publisher。

完整构建仍在 GitHub-hosted Windows runner 上执行，服务器不安装候选依赖或构建应用。工具 artifact 仅由管理员安装；后续内容提交不能更新它。

#### 2.3.2 管理员检查并安装固定任务

在服务器将工具 artifact 解压至**部署根目录以外**的新目录，例如 `H:\GDUFSMC-content-tools-download`。用现有 PM2 所属用户 `WINSERVER08\Administrator` 打开提升权限的 PowerShell。

```powershell
$tools = 'H:\GDUFSMC-content-tools-download'
$tccli = (Get-Command tccli -ErrorAction Stop).Source
$zoneId = '<现有 EdgeOne zone-id>'

# 只读检查；默认 runner 身份为 NT AUTHORITY\NETWORK SERVICE。
& "$tools\deploy\setup-content-sync.ps1" -Inspect
& "$tools\deploy\setup-content-sync.ps1" -DryRun -ToolDirectory $tools -TccliPath $tccli -ZoneId $zoneId

# 检查 DryRun 输出里的账户、PM2_HOME、Node/tccli 路径、生产基线后安装。
& "$tools\deploy\setup-content-sync.ps1" -Install -ToolDirectory $tools -TccliPath $tccli -ZoneId $zoneId
```

安装器会核对当前程序 marker 与私有部署状态，以及父目录权限。若拒绝，先按错误核对具体 ACL/版本漂移，不要给整个 runner 管理员权限，也不要递归授予部署根目录 Modify。准确 runner 身份应从 Windows 服务「登录身份」确认；如不同，用 `-RunnerIdentity` 明确传入。

默认 Node 路径为 `C:\Program Files\nodejs\node.exe`，PM2 为 `C:\npm\pm2.cmd`；可在安装命令用 `-NodePath`、`-Pm2Path` 指定真实路径。workflow 内固定 Node/工具路径必须与安装一致。必须使用现有管理员的 PM2_HOME。

安装布局：

| 路径 | 用途及权限 |
|---|---|
| `content-tools/` | 固定脚本、依赖、非秘密配置；管理员写，runner 读执行 |
| `coordination/queue/` | runner 写请求；只接受 commit/仓库/id/时间，不能传脚本或任意路径 |
| `coordination/results/`、`coordination/code/` | 管理员写，runner 读 |
| `coordination/staging/` | 管理员下载和校验的候选，runner 不可写 |
| `shared/` | 原私有锁、PM2 配置、部署/内容状态、journal、诊断；不向 runner 开放 |
| `content-backups/`、`content-failed/` | 旧内容及失败内容，保留用于恢复。`content-backups/` 在每次**成功**激活后自动剪枝到最新 10 份（`Clear-OldContentBackups`，数量用 `-ContentBackupRetention` 调）；失败的激活不消耗名额，跳过的目录只告警不删。`content-failed/` 不自动清理 |

计划任务 `GdufsmcContentQueue` 用管理员 S4U 身份、最高权限执行固定入口，每分钟及开机触发，同一任务不并发。它不修改既有 PM2 开机服务。安装器不自动开启 GitHub 变量，也不立即替换内容。

#### 2.3.3 核对计划任务的外部访问，再发布一次配套版本

管理员 tccli 配置需能执行 `teo:CreatePurgeTask` 和 `teo:DescribePurgeTasks`，使用当前 zone。计划任务上下文必须实际可读凭据并能访问 GitHub/腾讯云 HTTPS；交互终端可用不代表 S4U 任务也可用。不要把凭据给 runner 或写入队列。

管理员任务**必须**在仅管理员/SYSTEM 可读的 `shared/content-sync-secrets.json` 配置只读仓库 token：`{"githubToken":"..."}`，权限限定目标仓库 Contents: Read。runner 的临时 GITHUB_TOKEN 不会传给独立计划任务；匿名限额不足以持续逐提交及逐文件检查，因此缺少管理员凭据会明确拒绝。用受控本地编辑器创建，不把真实 token 放进命令历史、仓库或聊天。

按[第1章的手工发布流程](#11-手工发布流程自动发布未启用时)下载、校验并解包 `windows-release`，使用该 artifact 内的新版 `publish-release.ps1` 和同目录 `content-operations.ps1` 完整发布一次。也可在安装独立发布任务后按[第3章](#三完整构建自动发布)自动完成；无需修改本内容队列。新包有 `contentSyncVersion: 1` 和 `content-snapshot/{manifest.json,content/}`。

publisher 会先用候选配套内容在临时端口验包，再在停服窗口同步程序和固定内容目录，建立 `shared/content-state.json`。首次旧生产文件会保留备份；若旧内容没有可证实的 Git commit，不会编造基线。未建立配套基线时，纯内容任务只会转回完整构建。

```powershell
Get-Content 'H:\GDUFSMC-web\coordination\code\current.json' -Raw
Invoke-WebRequest 'http://127.0.0.1:3000/__release.json' -UseBasicParsing
Start-ScheduledTask -TaskName 'GdufsmcContentQueue'
Get-ScheduledTaskInfo -TaskName 'GdufsmcContentQueue'
```

核对代码 commit/releaseId 与源站一致，contentCommit 是本次包的 commit。空队列执行成功只能证明任务启动正常；API 凭据和内容链路仍须下一步实际验收。

#### 2.3.4 打开开关并做一次 CMS 验收

确认仓库 `main` 和 `.github/workflows/**` 变更受审核，现有 self-hosted runner 不接收不可信 PR 代码。然后在仓库 **Settings → Secrets and variables → Actions → Variables** 新增：

```text
CONTENT_SYNC_ENABLED = true
```

先手动运行工作流，保持 `force_full_build=false`，验证已部署 commit 的 noop/待清缓存路径。再通过 CMS 修改一篇文章的可见文字并保存到 `main`。预期 `content` job 成功、`build` job 跳过，约一分钟内开始处理；耗时还取决于下载、重启与 purge。

验收看三个位置：

- Actions 摘要/`coordination/results/<sha>-<run>-<attempt>.json`：`status=success`。
- 私有 `content-state.json` 的 `contentCommit` 前进、`purge.status=success`；`deployment-state.json.current.commit` 与源站 `__release.json` 保持原代码版本。
- 实际域名上的 `/news`、详情、图片和积分榜内容符合本次提交。自动 HTTP 检查是采样，不代替全部内容的人工呈现检查。

随后在测试环境检查新增/删除文章、重命名图片、坏内容被拒绝、旧任务重试和健康失败恢复。生产端到端通过后才能认定已启用完成。

### 2.4 之后发版

GitHub Actions 的 build job 已有以下 env（`deploy.yml`），无需重复添加：

```yaml
      - name: Package release
        env:
          RELEASE_EXTERNAL_CONTENT: '1'
        run: node scripts/build/package-release.mjs
```

开启完整自动发布后无需手工校验、解包或运行 publisher，配套内容仍由现有 publisher 一起处理。纯内容任务通过版本检查后只替换完整内容目录并重启同一个 PM2 应用，不构建程序，也不改变程序 release。生产代码落后于内容所需代码、基线未知或历史不能充分核验时，会回到完整构建及自动发布。

### 2.5 安全网

新版完整发布和内容任务使用固定工具校验候选快照与清单哈希，拒绝缺内容、格式错误和不安全路径；它们共用私有 `shared/deployment.lock`，防止内容更新与人工发布互相覆盖。候选验证、停服换目录、实际源站验证、状态记录和失败恢复分别有明确步骤。旧程序包没有 `contentSyncVersion: 1` 时仍保留旧兼容分支，其父目录检查不能替代新版内容验证。

开发机运行 `pnpm test:content` 执行回归，运行 `node scripts/verify-content-root.mjs . --json` 校验完整快照。工具会拒绝缺目录、空新闻、非法字段/日期/slug、缺图、越界路径和异常文件；`summary` 不要求必填。独立校验器的 `--allow-empty-news` 不等于自动发布渠道允许空内容；生产渠道保持默认闸门。

`scripts/tests/test-release.mjs` 在 `RELEASE_EXTERNAL_CONTENT=1` 时会：

- `CONTENT_ROOT` 未设或目录不存在 → 直接 exit 1
- content 树里没有 `.md` → 在 news 检查处 exit 1
- 正常时新增 `news-list-renders-content(N article(s))` 检查，比对磁盘上的文章数与页面实际渲染出的 `/news/<slug>` 链接数

GitHub Actions 里跑 smoke test 时需要给两个 env：

```yaml
        env:
          RELEASE_EXTERNAL_CONTENT: '1'
          CONTENT_ROOT: ${{ github.workspace }}
```

### 2.6 从旧手工方式迁移

早期外置改造采用人工复制内容、设置 PM2 环境变量并手工 purge。该流程仅为历史说明，不再提供对在线目录逐文件镜像覆盖的命令。

当前顺序是：先核对生产内容有无未回写 Git 的改动，管理员安装可信工具和受限队列任务，再完整发布一次含 sidecar 的新程序包，最后明确开启 `CONTENT_SYNC_ENABLED=true` 并做真实 CMS 验收。第一次完整发布会保留旧生产内容。工具尚未安装时，新包会拒绝发布，不会默默降级为旧流程。

### 2.7 日常行为与恢复

- **改代码或 workflow**：转完整构建，管理员继续按原流程发布；不会自动发布程序。CMS 改动前若存在尚未发布的代码，也走这条路。
- **旧任务**：候选不是最新 main，标记 `stale` 跳过；不会覆盖新内容。
- **同一内容重试**：已生效时不再次停服；若 purge 未完成，只查询已有 job。失败/过期的 purge job 才重新提交。
- **purge 失败**：Actions 失败但源站已更新。先修管理员凭据/API 权限，再重跑该工作流（新的 run attempt）；不得把这种情况当作内容未上线。新版 full publisher 原有 purge 仍是警告式提交，完整确认由 noop 内容任务完成。
- **请求等候超时**：管理员任务可能仍在处理，先看对应结果、任务状态、锁和 journal；不要直接重复手工覆盖目录。
- **普通激活失败**：脚本尝试恢复旧内容及旧状态并重启。日志在 `shared/content-operation-error.json`，操作进度在 `shared/content-journal.json`；不公开这些私有文件。
- **未完成 journal / CRITICAL**：先将 GitHub 开关设为 `false` 并停用内容计划任务，确认没有 publisher/worker 正运行。管理员检查 journal 的 phase、backupPath、oldContentState/oldCodeProjection；确认 `gdufsmc` 停止后恢复记录的内容与状态，再启动并验证。完整发布 journal 还需恢复记录的程序 PM2 config 与 deployment-state。核对健康后才将 journal 标为 completed 并恢复任务。不能在进程仍读目录时 rename，也不能盲删 journal 解除闸门。
- **需要完整包**：手动运行工作流并选择 `force_full_build=true`，即使内容开关开启也会跳过服务器队列。
- **服务器 runner 离线或内容任务失败**：启用开关后，自动分流依赖这个 runner，普通代码 push 的构建也可能等待/中止。用 `force_full_build=true` 手动生成完整包；这不会自动发布程序或掩盖原内容任务的失败。
- **停止自动同步**：仓库变量设为 `false` 阻止新任务；已入队任务仍可能执行，需同时停用计划任务并检查是否有正在进行的维护。
- **停用快速通道**：将 `CONTENT_SYNC_ENABLED` 设为 `false` 可让后续 push 回到完整构建；检查已有队列及正在执行的任务，不能把关闭开关视为已取消服务器任务。程序及配套内容用新版 publisher 的 `-Rollback` 恢复。回到内置 content 属于另一次部署方案变更，需要同时处理运行环境、任务开关和内容来源，不能只删掉打包开关。

备份、暂存、失败目录和请求结果不自动清理。管理员定期检查磁盘，仅删除已确认不被当前/上一程序版本、内容状态或未完成 journal 引用的目录。不要用 `robocopy /MIR` 清理这些运维目录。

固定图片 URL 按当前内容树服务。删除或改名后，旧浏览器页面/尚未刷新的 CDN HTML 可能仍引用旧 URL；purge 不能召回已经打开的页面。需要保留历史页面图片时，在内容中暂时保留旧文件名，不能指望备份目录自动通过网站访问。

工具升级需管理员明确更换可信 bundle，并与新 schema 同时评估；内容提交不能升级校验器。当前校验策略会拒绝空新闻目录，不能借 CMS 删除全部文章来隐式清空站点。

### 2.8 本地验证

```powershell
pnpm test:content
powershell -NoProfile -File scripts/tests/test-content-operations.ps1
powershell -NoProfile -File scripts/tests/test-content-activation.ps1
powershell -NoProfile -File scripts/tests/test-content-purge.ps1
powershell -NoProfile -File scripts/tests/test-content-backup-retention.ps1
node scripts/verify-content-root.mjs . --json
node scripts/package-content-tools.mjs
node scripts/tests/test-csp.mjs
```

Node 用例覆盖 GitHub 变化判定、来源/哈希、工具依赖闭包、健康检查及 purge 重试；PowerShell 用临时目录和模拟 PM2 检查切换及恢复，不操作真实服务。Windows PowerShell 5.1 与 PowerShell 7 都应通过。完整发布包仍需 CI 的 Node 24.21.0 构建/解包/运行验证和服务器现场验收。

EdgeOne 的输入文件使用 [TCCLI 官方 `--cli-input-json` 用法](https://cloud.tencent.com/document/product/440/34013)，状态查询按 [DescribePurgeTasks](https://intl.cloud.tencent.com/zh/document/api/1145/50532) 的 `job-id` filter 实现。

---

## 三、完整构建自动发布

完整链路：GitHub `build` 验证成功 → self-hosted `publish` 下载本次 build 的 artifact ID → 固定投递客户端生成 ZIP → 独立管理员任务发布 → Actions 等待成功/失败结果。纯内容更新继续使用现有 `GdufsmcContentQueue`；两个发布器共用原来的 `shared/deployment.lock`，新包装脚本不另加锁。

### 3.1 一次性启用

1. 先让包含这些改动的 `main` 完整构建通过，保持仓库变量 `RELEASE_PUBLISH_ENABLED` 未设置或为 `false`。必要时在 Actions 手动运行并勾选 `force_full_build`。
2. 下载可信的 `windows-release-…` artifact，在服务器解压到独立安装目录，例如 `H:\GDUFSMC-release-install`，保留 `outputs/` 和 `deploy/`。不要执行其他来源的 publisher；SHA256 检查用于发现损坏，不能证明来源。全量自动发布意味着允许该仓库的 `main` 构建代码及包内 publisher 以现有 PM2 管理员身份运行，必须继续保护 `main`、Actions 和 runner。
3. 用 **WINSERVER08\Administrator 的提升权限 PowerShell** 运行：

```powershell
cd H:\GDUFSMC-release-install
.\deploy\setup-release-publish.ps1 -DryRun
.\deploy\setup-release-publish.ps1 -Install
Get-ScheduledTask -TaskName GdufsmcReleasePublish
Start-ScheduledTask -TaskName GdufsmcReleasePublish
Get-ScheduledTaskInfo -TaskName GdufsmcReleasePublish
```

安装前会检查当前身份、部署根 ACL、Node **24.21.0**、既有 PM2 home、PM2 路径、已安装 content tools 和 deployment-state。默认 runner 身份为 `NT AUTHORITY\NETWORK SERVICE`，实际不同则给安装命令加 `-RunnerIdentity '实际账户'`。已有安装/任务时拒绝覆盖；安装中断后应检查已生成目录和任务，不能直接用 `-Force` 重装。

安装只复制固定工具到 `H:\GDUFSMC-web\release-tools`，新增 **GdufsmcReleasePublish**（S4U、管理员、启动及每分钟触发）。`IgnoreNew` 防止计划任务自身重入，执行时间不设上限，以便发布失败后的恢复有时间完成。此设置与 [Microsoft 的任务超时说明](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-executiontimelimit) 一致。现有 content task、PM2 开机服务和 Caddy 不变。

4. 确认空队列执行退出码为 0 后，在 GitHub 仓库 Settings → Secrets and variables → Actions → **Variables** 添加 `RELEASE_PUBLISH_ENABLED=true`。无需新增 GitHub secret 或 SSH 凭据。
5. 推送新的代码提交到 `main`，或手动运行 `force_full_build=true`。检查 `build` 和 `publish` 两个 job。`publish` 按 [download-artifact 的 artifact-ids 参数](https://github.com/actions/download-artifact/blob/v4/action.yml) 精确下载上游构建产物；不 checkout，也不在 runner 上执行下载来的脚本。
6. 现场验收源站 `http://127.0.0.1:3000/__release.json` 的 commit、`/news` 新内容、PM2 online 和 CDN 展示。完整 publisher 的 EdgeOne purge 失败仍沿用现有警告语义；Actions 成功不等于 CDN purge 已完成。

本地测试使用隔离临时目录和模拟 publisher，不能代替生产身份、任务、ACL、真实 PM2 回滚和网站验收。

### 3.2 目录及权限

| 路径（相对 `H:\GDUFSMC-web`） | 用途 | runner 权限 |
|---|---|---|
| `release-tools/` | 管理员安装的固定客户端、worker 和准备脚本 | RX |
| `release-delivery/inbox/` | Actions ZIP 投递区 | Modify |
| `release-delivery/results/` | 按 run ID / attempt / commit 返回结果 | RX |
| `release-delivery/logs/` | 每个请求的完整发布 transcript | 无 |
| `release-delivery/paused.json` | 失败/中断后暂停标记 | 只读 |
| `artifacts/` | 管理员保护的 ZIP 和 `release-YY.M.P` 归档 | 无 |
| `candidate/` | 同名 release 解包目录 | 不新增权限 |
| `incoming/` | 历史临时目录；每次准备/发布尝试结束后清空 | 不新增权限 |

runner 不直接写生产 artifacts：客户端先创建 `<run>-<attempt>-<commit>.uploading`，完成后原子改名为 `.zip`。管理员 worker 独占读取 ZIP，复制到 artifacts 的新文件，再删除投递副本。复制会创建继承管理员权限的新文件，避免同盘移动保留 runner 可写 ACL。未完成的 `.uploading` 不会被消费；异常中断留下的文件由管理员核对来源后清理。

投递区和 archive 内脚本都是全量代码发布入口；不要把该权限授予 CMS 内容队列或其他非可信提交。`content-tools`、`coordination` 及其 ACL 不变。

### 3.3 准备与发布规则

- 扫描 ZIP 文件名升序，逐个发布。多个包分别经过停服窗口；首个失败立即停止。
- 从 artifacts 中严格匹配 `release-YY.M.P` 的目录取当年当月最大序号，加一；无目录从 1 开始。按服务器本地日期编号，不改 `release.json.id`。
- ZIP 解压成功后立即删除；按年、月、序号数值保留最新 3 个 archive 目录，输出删除日志。`-KeepArtifacts` 禁止轮换，`-Keep N` 可调整保留数。未来日期的目录挤掉本次版本时会拒绝操作，要求先检查时钟。
- 必须有且只有一对 tar.gz / SHA256，名称与哈希一致。ZIP 路径及 tar 路径、文件类型在解压前验证；拒绝越界、链接、reparse point，已有目录不覆盖。
- 解包到 `candidate/<同名版本>`，验证 `server.js`、可解析的 `release.json`、Windows x64 / Node 24.21.0 / contentSyncVersion 1，拒绝顶层 `content/`。自动投递还必须匹配请求 commit。
- 调用包内 `deploy/publish-release.ps1`，停服、同步内容、健康检查、恢复、purge 保持现有行为。固定工具不会因新包出现而自动更新。
- 成功删除 candidate；失败保留 candidate 和本次 archive，清理 `incoming`。后续人工批准的新发布仍可能按保留策略轮换旧 archive，排查资料应先另行保存。清理遇到异常链接会拒绝删除并报告失败。
- `DryRun` 只打印计划，不创建目录、日志、锁文件，也不校验尚未解开的包。空投放目录退出码为 0。

### 3.4 手工预览或投放

管理员可把可信 ZIP 放进 artifacts，然后运行固定脚本。手动批量运行前应禁用独立自动发布任务并确认其未运行，避免两个包装器争用编号或清理目录；不要同时执行历史 incoming 手工发布。

```powershell
& H:\GDUFSMC-web\release-tools\publish-from-artifacts.ps1 -DryRun
& H:\GDUFSMC-web\release-tools\publish-from-artifacts.ps1
# 仅发布指定 ZIP、保留所有归档：
& H:\GDUFSMC-web\release-tools\publish-from-artifacts.ps1 -ZipName windows-release.zip -KeepArtifacts
```

计划任务只消费 inbox 中符合 `<run>-<attempt>-<commit>.zip` 格式的 Actions 请求。手动放 artifacts 的其他 ZIP 需运行以上命令。脚本也可在首次安装包的 `deploy/` 中运行，但必须保留同目录 `artifact-operations.ps1` 和 `content-operations.ps1`。

### 3.5 失败、超时与恢复

Actions 最多等待结果 30 分钟；等待失败或用户取消不会终止独立管理员任务，也不会终止 publisher 的回滚。超时后先确认任务和源站状态，不要马上重新发包。

worker 写入 `processing` 后才开始消费。失败会先写 `paused.json` 再写 `failed` 结果，停止后续请求；服务器重启等造成 `processing` 遗留时，下次也会暂停。成功/失败结果保留，不重复执行同一请求。完整日志位于 `release-delivery/logs/publish-<请求ID>.log`，普通 runner 只读简要结果。

恢复步骤：

1. 将 `RELEASE_PUBLISH_ENABLED` 设为 `false`；禁用 **GdufsmcReleasePublish** 的后续触发并确认当前执行已结束。不要强制结束正在回滚的进程，也不要操作 `GdufsmcContentQueue`。
2. 查看 transcript、源站 marker、PM2、`shared/deployment-state.json` 和内容 journal。若 publisher 报恢复失败，按[第2章的 journal 恢复流程](#27-日常行为与恢复)先恢复线上。包装器不会声称「回滚一定成功」。
3. 对因进程中断遗留的 `results/<请求ID>.json`，人工核实后使用固定 `content-operations.ps1` 的 `Write-ContentJsonAtomic` 将 `processing` 改为实际 `success` 或 `failed`，保留 requestId；否则下次仍会检测到中断并暂停。失败结果不要删除来强迫重试。
4. 审核 inbox 里尚未处理的 ZIP，将不再需要的包移到队列以外；保存失败 candidate/archive 和日志。核对所有失败/中断请求完成处置后，由管理员删除 `paused.json`。
5. 恢复任务并重新开启变量，推送修复提交或重跑**整个** workflow 生成新的程序 release。只重跑 publish job 会复用旧包；若旧 `release.json.id` 已存在，现有 publisher 会拒绝覆盖。

停止自动发布只需关闭变量并禁用上述独立任务；已经开始的发布仍应等待完成。工具升级需管理员在任务空闲且禁用时显式更新 `release-tools` 中的固定文件，再验证并恢复任务，不自动替换 content tools。

### 3.6 本地验证

```powershell
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -File scripts/tests/test-artifact-publish.ps1
pwsh -NoProfile -NonInteractive -File scripts/tests/test-artifact-publish.ps1
```

覆盖编号/跨年、数值轮换、零写入 dry-run、实际 ZIP/tar、校验失败、危险路径、publisher 非零退出、清理、投递与结果回传、重复请求和中断暂停。CI 在上传发布 artifact 之前运行两种 PowerShell 的这些测试。

---

## 四、自动发布上线验收清单

> 时间：2026-10-03 · 代码已实现，**尚未在生产验收**
> 严格按顺序执行。**任何一步失败就停，不要跳到下一步。**
>
> 关键原则：先证明「发布成功」路径，再证明「失败回滚」路径，最后才自动化。
> 顺序反了的话，第一次失败可能就停服停在那儿。

### 4.1 前提确认（只读，零风险）

```powershell
# 服务器上执行
cd C:\Users\Administrator

# 1. 当前生产状态（回滚的兜底）
(Invoke-WebRequest http://127.0.0.1:3000/__release.json -UseBasicParsing).Content
Get-Content 'H:\GDUFSMC-web\shared\deployment-state.json' -Raw
# 记下 current.id 和 current.commit —— 后面要对照
```

```powershell
# 2. 仓库变量必须是 false（现在还不能开）
#    GitHub → Settings → Secrets and variables → Actions → Variables
#    RELEASE_PUBLISH_ENABLED 应该不存在或为 false
```

**通过标准**：能正常读到两个 JSON，变量是关的。

### 4.2 DryRun（只读，不动任何文件）

**需要先把一个 zip 放进 artifacts**。如果没有，先跳到「准备测试包」那节。

```powershell
$tools = 'H:\GDUFSMC-web\release-tools'   # 如果还没装，见「准备」

& "$tools\publish-from-artifacts.ps1" -DryRun
```

**检查输出里的这几行**：

```
[时间] Prepare <zip名> -> release-26.10.N        ← 版本号算对了吗
[时间] DRY RUN: expand ZIP to ...; delete ZIP only after successful extraction.
[时间] DRY RUN: remove old artifact release-...  ← 要删的版本对吗
[时间] DRY RUN: verify exactly one SHA256/tarball pair; extract to ...
[时间] DRY RUN: invoke artifact deploy/publish-release.ps1; clear incoming on success/failure
```

**通过标准**：
- ✅ 版本号符合规则（同年月最大 +1）
- ✅ 要删的旧版本 ≤ 3 个保留
- ✅ **DryRun 之后 `artifacts\` 和 `candidate\` 内容完全没变**（自己确认一下）

**如果版本号算错**（比如服务器日期是 2027 年）：
```
New version sorts outside the retention window; check server date or use KeepArtifacts.
```
→ 检查系统日期，或用 `-KeepArtifacts` 绕过。

### 4.3 手工发布一次（真实停服）

**这一步会停服。** 挑没人用的时候。

```powershell
& "$tools\publish-from-artifacts.ps1"
```

**观察这些**：

| 时机 | 期望 |
|---|---|
| 开始 | `Prepare <zip> -> release-26.10.N` |
| 解压后 | `ZIP extracted; deleting <zip>` |
| 清理旧版 | `Remove old artifact release-...`（如有） |
| 校验 | `SHA256 verified; extracting release with System32/tar.exe.` |
| 发布前 | `Publish release-26.10.N (commit <40位>), source <zip>` |
| **publisher 输出** | `DEPLOY SUCCEEDED: <id>` + `EdgeOne purge submitted successfully` |
| 收尾 | `Published release-26.10.N; remove successful candidate.` + `Clear incoming after this attempt.` |

**发布后立即验证**：

```powershell
# 1. 新版本生效
(Invoke-WebRequest http://127.0.0.1:3000/__release.json -UseBasicParsing).Content
#    commit 应该等于刚才日志里的 commit

# 2. 部署状态同步
Get-Content 'H:\GDUFSMC-web\shared\deployment-state.json' -Raw
Get-Content 'H:\GDUFSMC-web\shared\content-state.json' -Raw
#    codeCommit 应该也前进了

# 3. 线上能访问（绕过 EdgeOne 缓存）
$h = (Invoke-WebRequest 'http://127.0.0.1:3000/news' -UseBasicParsing).Content
if ($h -match '共\s*(\d+)\s*条') { "origin: $($Matches[1]) 条" }

# 4. 目录状态
Get-ChildItem 'H:\GDUFSMC-web\artifacts' -Directory | Select-Object Name
Get-ChildItem 'H:\GDUFSMC-web\candidate' -ErrorAction SilentlyContinue   # 应该空了
Get-ChildItem 'H:\GDUFSMC-web\incoming' -ErrorAction SilentlyContinue    # 应该空了
```

**通过标准**：
- ✅ `/__release.json` 的 commit 是新版本
- ✅ `content-state.json` 的 `codeCommit` 前进
- ✅ origin `/news` 正常显示文章
- ✅ `candidate\` 和 `incoming\` 空了
- ✅ `artifacts\` 里 zip 没了，目录在，≤ 3 个

**线上验证**（EdgeOne purge 后）：

```powershell
$h = (Invoke-WebRequest 'https://gdufscraft.top/news' -UseBasicParsing).Content
if ($h -match '共\s*(\d+)\s*条') { "线上: $($Matches[1]) 条" }
```

### 4.4 失败回滚（最重要，最容易被跳过）

**必须验。** `publish-release.ps1` 的回滚逻辑在真实环境从没跑过——今天所有部署都走的成功路径。

#### 4.4.1 制造一个必然失败的包

```powershell
# 复制一份现有 zip，改坏 sha256
$test = 'H:\GDUFSMC-web\artifacts\corrupt-test.zip'
Copy-Item '<第一步用的那个 zip 已经删了，重新放一个>' $test
# 用 PowerShell 打开 zip 改掉 sha256.txt 的内容
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::Open($test, 'Update')
$e = $z.Entries | Where-Object { $_.FullName -like '*.sha256.txt' }
$r = New-Object IO.StreamReader($e.Open())
$null = $r.ReadToEnd(); $r.Dispose()
$s = $e.Open(); $s.SetLength(0)
$w = New-Object IO.StreamWriter($s)
$w.Write('0000000000000000000000000000000000000000000000000000000000000000  wrong.tar.gz')
$w.Flush(); $w.Dispose()
$z.Dispose()
"corrupted"
```

#### 4.4.2 跑发布，应该失败

```powershell
& "$tools\publish-from-artifacts.ps1" -ZipName 'corrupt-test.zip'
```

**期望**：

```
[时间] FAILED release-26.10.N : SHA256 mismatch; artifact retained for diagnosis.
```

**关键检查——线上必须还活着**：

```powershell
(Invoke-WebRequest http://127.0.0.1:3000/__release.json -UseBasicParsing).Content
# commit 应该还是第二步那个版本，没变
$h = (Invoke-WebRequest 'http://127.0.0.1:3000/news' -UseBasicParsing).Content
# 正常显示
```

**还要确认**：
- `candidate\` 里留下了一个 release-26.10.N 目录（失败时**不删**，供排查）→ **手工删掉**
- `incoming\` 空了（finally 清的）
- `artifacts\` 里 corrupt-test.zip **还在**（sha256 失败时 zip 不删）

**通过标准**：**网站完全正常，PM2 没重启，release 目录没变。**

#### 4.4.3 清理

```powershell
Remove-Item 'H:\GDUFSMC-web\artifacts\corrupt-test.zip' -Force
Remove-Item 'H:\GDUFSMC-web\candidate\release-26.10.N' -Recurse -Force
```

### 4.5 装计划任务（自动化）

前三步都过了再装。

```powershell
# 只读检查
& "$tools\setup-release-publish.ps1" -Inspect

# 演练
& "$tools\setup-release-publish.ps1" -DryRun -ToolDirectory $tools

# 安装
& "$tools\setup-release-publish.ps1" -Install -ToolDirectory $tools
```

**装完验证**：

```powershell
Get-ScheduledTaskInfo -TaskName 'GdufsmcReleasePublish' |
  Select-Object LastRunTime, LastTaskResult, NextRunTime
# LastTaskResult 应该是 0（空 inbox 正常退出）
```

### 4.6 开变量

GitHub → Settings → Secrets and variables → Actions → **Variables**：

```
RELEASE_PUBLISH_ENABLED = true
```

**注意值只填 `true`**，不要写成 `RELEASE_PUBLISH_ENABLED = true`（之前 `CONTENT_SYNC_ENABLED` 就踩过这个坑）。

### 4.7 端到端

从 CMS 改一篇文章（只改文字）→ 保存。

**如果判定是 full**（改了 `config.yml` 之类）：

```
content job  → mode=full
build job    → 完整构建
publish job  → 下载 zip → 投递 → S4U 任务发布 → 等结果
```

**期望**：

| 检查点 | 期望 |
|---|---|
| `publish` job | success |
| 服务器日志 | `Published release-26.10.N` |
| `artifacts\` | zip 没了，多一个新目录 |
| `candidate\` + `incoming\` | 空的 |
| 线上 | 内容更新（purge 之后） |
| `deployment-state.json` | commit 前进 |

**在 servers 上查发布记录**：

```powershell
Get-ChildItem 'H:\GDUFSMC-web\release-delivery\results' | Sort-Object LastWriteTime -Descending |
  Select-Object -First 3 Name, LastWriteTime
Get-Content '<最新的那个>.json' -Raw
```

### 4.8 失败暂停机制

第三步失败时，`paused.json` 会被写（自动发布**永久停止**，防止连续失败）。

**恢复方法**：

```powershell
# 1. 先查为什么停了
Get-Content 'H:\GDUFSMC-web\release-delivery\paused.json' -Raw
Get-ChildItem 'H:\GDUFSMC-web\release-delivery\logs' | Sort-Object LastWriteTime -Descending |
  Select-Object -First 3 Name

# 2. 确认线上正常后
Get-Content 'H:\GDUFSMC-web\shared\deployment-state.json' -Raw   # current 正常？
(Invoke-WebRequest http://127.0.0.1:3000/news -UseBasicParsing).StatusCode

# 3. 确认没问题才删
Remove-Item 'H:\GDUFSMC-web\release-delivery\paused.json' -Force
```

**任何时候看到 `paused.json` 存在，自动发布就是停的**，必须人工确认后才能删。

### 4.9 关闭自动发布（出问题时）

最快：把仓库变量改成 `false`。

```powershell
# 或者直接停任务（更快，立即生效）
Disable-ScheduledTask -TaskName 'GdufsmcReleasePublish'
```

**注意**：关变量只阻止**新请求**，已在 `inbox\` 里的 zip 仍会被处理。要彻底停，得停任务。

### 4.10 待清理的东西（上线一段时间后）

| 路径 | 内容 | 何时清 |
|---|---|---|
| `candidate\release-26.10.N` | 失败发布留下的 | **每次失败后手工删**（第三步会看到） |
| `release-delivery\inbox\` | 未处理的 zip | 正常情况处理完就空 |
| `release-delivery\logs\` | transcript 日志 | 累积，**不会自动清**，定期手工删 |
| `release-delivery\results\` | 每次发布的记录 | 同上 |
| `content-backups\` | content 备份 | **自动清理**：每次成功发布/同步后只保留最新 10 份 |
| `content-failed\` | 失败内容 | 累积，**不会自动清**，排查完手工删 |

**除 `content-backups/` 外都不自动清理。** 磁盘会慢慢涨，建议每月检查一次。

`content-backups` 的保留逻辑（`Clear-OldContentBackups`）只在成功之后跑，所以一次失败发布不会消耗名额。它只删 `content-backups/` 的直接子目录，且必须同时满足：目录名是合法 operation id、里面确实有 `content/` 子目录、整棵树没有 reparse point、并且不是当前 operation 也不是 `shared/content-state.json` 里记录的那份。不满足的一律跳过并在日志里告警。数量用 `-ContentBackupRetention` 调（默认 10）。

### 4.11 完整验收清单

- [ ] 零、前提状态读到了，变量是关的
- [ ] 一、DryRun 版本号算对，文件没被动
- [ ] 二、真实发布成功，`/__release.json` commit 前进
- [ ] 二、`content-state.json` 的 codeCommit 前进
- [ ] 二、`candidate\` / `incoming\` 空了
- [ ] 二、线上 origin 和公网都能看
- [ ] **三、坏包被拒，线上完全没受影响**
- [ ] 三、失败后 zip 还在、candidate 留下、incoming 清了
- [ ] 四、计划任务装上，`LastTaskResult=0`
- [ ] 五、`RELEASE_PUBLISH_ENABLED=true`（只填 true）
- [ ] 六、端到端发布成功
- [ ] 七、`paused.json` 机制理解清楚

**第三步是整份清单里最重要的一条。** 没验过回滚就开自动发布，等于赌。

---

## 五、部署后自动清 EdgeOne 缓存

`publish-release.ps1` 在 DEPLOY / ROLLBACK 成功后会自动调用 `tccli teo CreatePurgeTask --Type purge_all`，让用户访问到新版本（不用等 s-maxage=86400 自然过期）。失败时仅 warn，不阻塞发布。

这条历史 publisher 路径只确认提交 purge，**不轮询完成状态**；新版内容状态因此保留 `purge: pending`。固定内容 worker 会查询 purge 任务结果并记录完成/失败，可在内容已激活后单独重试清缓存。源站更新成功与 CDN 刷新完成是两个状态。

### 5.1 一次性配置（管理员 PowerShell，仅需一次）

```powershell
# 1. 装 tccli
pip install tccli

# 2. 腾讯云 CAM 控制台 → 用户 → 新建子用户
#    用户名: gdufsmc-edgeone-purge
#    访问方式: 仅勾选"编程访问"（不要勾控制台登录）
#    操作保护: 禁用（MFA 设备未绑定会卡 API 调用）

# 3. 创建策略 GdufsmcEdgeOnePurgeOnly（策略内容 JSON 见下）

# 4. 子用户 → API 密钥 → 新建 → 复制 SecretId + SecretKey（仅显示一次）

# 5. tccli 配凭证
tccli configure set secretId   "AKIDxxx..."
tccli configure set secretKey  "xxx..."
tccli configure set region    "ap-guangzhou"
tccli configure set output    "json"

# 6. 验证（应返回 TotalCount: 0 + 空 Tasks）
tccli teo DescribePurgeTasks --cli-unfold-argument `
    --StartTime "2026-09-28T00:00:00+08:00" `
    --EndTime   "2026-09-28T23:59:59+08:00" `
    --Limit 1

# 7. 创建 secrets 文件
ni "H:\GDUFSMC-web\secrets.edgeone.json" -ItemType File -Force
notepad "H:\GDUFSMC-web\secrets.edgeone.json"
# 填入（注意 ZoneId 必须填对，region 可选）:
{
  "zoneId": "zone-3vdw90vs6duq",
  "region": "ap-guangzhou"
}

# 8. ACL 限制为只允许 Administrator + SYSTEM 读
$acl = Get-Acl "H:\GDUFSMC-web\secrets.edgeone.json"
$acl.SetAccessRuleProtection($true, $false)
$adminRule = New-Object Security.AccessControl.FileSystemAccessRule("Administrator", "Read", "Allow")
$sysRule   = New-Object Security.AccessControl.FileSystemAccessRule("NT AUTHORITY\SYSTEM", "Read", "Allow")
$acl | Set-Acl "H:\GDUFSMC-web\secrets.edgeone.json"
```

### 5.2 CAM 策略内容（`GdufsmcEdgeOnePurgeOnly`）

```json
{
  "version": "2.0",
  "statement": [
    {
      "action": [
        "teo:CreatePurgeTask",
        "teo:DescribePurgeTasks"
      ],
      "effect": "allow",
      "resource": [
        "qcs::teo::uin/<主账号UIN>:zone/<zone-id>"
      ]
    }
  ]
}
```

⚠️ EdgeOne CAM 资源格式**不是 6 段式**（跳过 region 段，resource 用 `uin/<UIN>:zone/<zoneId>`）：
- 第 3 段（region）**留空**，不是 `*` 也不是 `ap-guangzhou`
- 第 4 段是 `uin/<主账号UIN>`，不是 `*`
- 整段用 `:::` 分割，不是 `::::`

主账号 UIN 查法：腾讯云控制台右上角 → 账号信息 → 账号 ID（UIN），形如 `10001xxxxx`。

### 5.3 缓存策略

`MAIN_SECURITY_HEADERS` 已设 `Cache-Control: public, max-age=0, s-maxage=86400, stale-while-revalidate=86400`：
- `max-age=0`：浏览器不缓存 HTML（避免用户刷新看不到新版本）
- `s-maxage=86400`：CDN 边缘缓存 1 天，配合部署后自动 purge
- `/api/*` 单独覆盖为 `no-store`，`/_next/static/*` 单独覆盖为 `immutable`

### 5.4 手动 fallback（purge 失败时）

```powershell
# EdgeOne 控制台 → 站点列表 → 缓存清理 → 提交全站刷新
# URL: https://console.cloud.tencent.com/edgeone
```

> 依赖安装和构建已移出生产服务器。**Realtek 网卡驱动导致的 0x139 蓝屏不会因此修复**，驱动问题需单独处理。稳定后可关闭临时 Caddy `debug` 日志。

---

## 六、校园服务器初始化与迁移

> 适用：在国内校园网部署本项目（Next.js 16），使用 GitHub Actions 自托管 Runner + Caddy 反代。
> 域名：`gdufscraft.top` + `www.gdufscraft.top`
> **服务器部署目录：`H:\GDUFSMC-web`**

### 6.0 前置条件

- 校园服务器一台（Windows Server 2019+ 或 Windows 10+）
- 至少 **2GB RAM**（map build 期间 PM2 + Caddy + Runner 全跑）
- 至少 **20GB 磁盘**（`node_modules/` + `.next/` + `content/` + 日志）
- **H 盘**（Windows Server 安装时第二个盘符，C 盘系统盘 + D 盘可能是光驱/恢复，H 盘稳）
- **公网 IP**（校园 IT 给的固定 IP，**没有公网 IP 整个迁移方案不可行**）
- **DNS 解析**：
  - `gdufscraft.top` A 记录 → 公网 IP
  - `www.gdufscraft.top` CNAME → `gdufscraft.top`
- DNS 解析必须**先于**首次启动 Caddy（Caddy 走 Let's Encrypt HTTP-01 验证需要 80 端口入站 + DNS 已解析）

### 6.1 服务器初始化（在校园服务器上）

#### 6.1.1 创建项目目录

```powershell
# 用 Administrator 登录
mkdir H:\GDUFSMC-web
mkdir H:\GDUFSMC-web\logs
```

#### 6.1.2 安装依赖软件

```powershell
# 用 winget（Windows 11 / Server 2022 自带）
winget install OpenJS.NodeJS.LTS
winget install CaddyServer.Caddy
npm install -g pnpm pm2

# 验证
node --version   # 期望 v22.x
pnpm --version
pm2 --version
caddy version    # 期望 v2.x
```

#### 6.1.3 防火墙规则

```powershell
# 入站：浏览器用户访问 (Caddy 监听)
New-NetFirewallRule -DisplayName "Caddy HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
New-NetFirewallRule -DisplayName "Caddy HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow

# 出站：默认已放行（GitHub Runner / Caddy ACME / npm 都走 443 出站）
# 如学校有出站限制，需要额外放行：
#   - 443/TCP 出站 → GitHub Actions runner
#   - 80/TCP 出站 → Let's Encrypt ACME 验证
#   - 53/UDP 出站 → DNS 解析
```

### 6.2 第一次部署（冷启动）

#### 6.2.1 克隆代码

```powershell
cd H:\GDUFSMC-web
git clone https://github.com/QingShi-Dev/GdufsMC-Website.git .
```

#### 6.2.2 安装依赖 + 构建

```powershell
pnpm install --frozen-lockfile --prod
pnpm run build

# 验证产物
dir .next  # 应该有 BUILD_ID, server/, static/ 等目录
```

#### 6.2.3 启动 PM2（Next.js 后端）

```powershell
pm2 start deploy/ecosystem.config.js
pm2 save

# 验证
pm2 status       # 期望看到 gdufsmc 在线
curl http://127.0.0.1:3000/                    # HTTP 200
curl http://127.0.0.1:3000/api/server-status  # JSON 响应
```

#### 6.2.4 启动 Caddy（反代 + HTTPS）

```powershell
# 第一次手动跑（前台运行，看 HTTPS 证书申请是否成功）
& "C:\Program Files\Caddy\caddy.exe" run --config H:\GDUFSMC-web\Caddyfile

# 预期看到：
#   - "obtained certificate" for gdufscraft.top
#   - "obtained certificate" for www.gdufscraft.top
#   - "serving HTTPS on :443"
# Ctrl+C 退出

# 验证证书位置
dir "C:\ProgramData\Caddy\.local"  # 或 %APPDATA%\Caddy
dir "C:\ProgramData\Caddy\acme"
```

#### 6.2.5 装 Caddy 为 Windows 服务

```powershell
# 装 NSSM（包装任意 exe 为 Windows 服务）
scoop install nssm
# 或 choco install nssm

# 用项目自带的脚本（推荐）
.\deploy\setup-caddy-service.ps1

# 或手动
nssm install Caddy "C:\Program Files\Caddy\caddy.exe"
nssm set Caddy AppParameters "run --config H:\GDUFSMC-web\Caddyfile"
nssm set Caddy AppDirectory "H:\GDUFSMC-web"
nssm set Caddy DisplayName "Caddy"
nssm set Caddy Description "Reverse proxy for gdufsmc (Caddy)"
nssm set Caddy Start SERVICE_AUTO_START
nssm set Caddy AppStdout "H:\GDUFSMC-web\logs\caddy-stdout.log"
nssm set Caddy AppStderr "H:\GDUFSMC-web\logs\caddy-stderr.log"
nssm start Caddy

# 验证
nssm status Caddy
Get-Service Caddy
```

### 6.3 注册 GitHub Actions Runner

#### 6.3.1 在 GitHub 上获取 Token

1. 打开 `https://github.com/QingShi-Dev/GdufsMC-Website/settings/actions/runners/new`
2. 选 OS = **Windows**，Architecture = **x64**
3. 记下页面上显示的 `--token Axxxxxxxxxxxxxxxxxxxxxxx` 和 runner 版本号

#### 6.3.2 下载并配置 Runner

```powershell
# 在校园服务器上
mkdir C:\actions-runner
cd C:\actions-runner

# 下载（用 GitHub 给的版本号）
$version = "2.319.1"  # ← 替换成 GitHub 当前显示的版本
Invoke-WebRequest -Uri "https://github.com/actions/runner/releases/download/v$version/actions-runner-win-x64-$version.zip" -OutFile "runner.zip"
Expand-Archive runner.zip -DestinationPath .

# 配置（用第 3.1 步拿到的 token）
.\config.cmd --url https://github.com/QingShi-Dev/GdufsMC-Website `
            --token <TOKEN> `
            --runnergroup default `
            --labels "self-hosted,windows,gdufsmc" `
            --name "gdufsmc-campus" `
            --work "_work"

# 期望看到: "Settings saved." 和 "Runner successfully added"
```

#### 6.3.3 装成 Windows 服务

```powershell
.\svc.sh install    # 用当前用户登录后启动
.\svc.sh start

# 验证
Get-Service | Where-Object { $_.Name -like "actions.runner.*" }
```

`https://github.com/QingShi-Dev/GdufsMC-Website/settings/actions/runners` 应该看到 `gdufsmc-campus` Runner 状态是 **Idle**（绿色）。

### 6.4 首次验证

| URL | 期望结果 |
|-----|---------|
| `https://gdufscraft.top/` | Next.js 主页，HTTP 200 |
| `https://www.gdufscraft.top/` | 自动跳转到 `https://gdufscraft.top/` |
| `https://gdufscraft.top/map` | 地图页 |
| `https://gdufscraft.top/api/server-status` | JSON 响应 |
| `https://gdufscraft.top/admin/` | Basic Auth 弹窗 |

**Basic Auth 登录**：用户名 `admin`，密码是 `Caddyfile` 里配置的密码（部署前在开发机生成 bcrypt 哈希，见 `secrets.caddy.example`）。

**Sveltia CMS 测试**：

1. 登录 Sveltia CMS 后能编辑 `content/news/` 或 `content/leaderboard/` 的某条
2. 改一行文字，点 Publish
3. Sveltia 通过 PAT commit + push 到 main
4. 看 GitHub Actions 是否自动触发 deploy workflow
5. 等 1-3 分钟，刷新网站看到新内容

### 6.5 触发一次 GitHub Actions 部署

**方式 A**：开发机推送

```powershell
# 在开发机 (Windows PowerShell)
cd G:\Project\NodeProject\gdufsmc-site-dev
# 改一行字测试，比如 content/news/xxx.md
git add .
git commit -m "test:触发 deploy workflow"
git push origin main
```

**方式 B**：手动触发

1. 打开 `https://github.com/QingShi-Dev/GdufsMC-Website/actions/workflows/deploy.yml`
2. 点 "Run workflow" → 选 main → 点绿色按钮

监控：`https://github.com/QingShi-Dev/GdufsMC-Website/actions` 里看各 step 结果，失败时看该 step 的日志定位。

---

## 七、架构与关键设计

### 7.1 为什么 GitHub Actions self-hosted runner

校园网 NAT 没公网 SSH 端口，让 GitHub Runner 跑在服务器上：
- Runner 走 outbound 443 出站 → 校园 NAT 友好
- 不依赖公网 IP / 域名 / SSH
- 直接访问本地文件 (`H:\GDUFSMC-web\`) → 操作最直接
- 取消 SSH secrets (`SERVER_HOST` / `SERVER_USER` / `SSH_PRIVATE_KEY`)

### 7.2 为什么 Caddy 替代 nginx

- **自动 HTTPS**：Caddy 内置 ACME 客户端, 无需 certbot + 手动续期
- **零配置反代**：一行 `reverse_proxy` 替代 nginx 多行 `location`
- **跨平台**：同一份配置文件，Windows / Linux 同语法

### 7.3 为什么配置都放进项目目录 (`H:\GDUFSMC-web\`)

- **单一目录管理**：代码 + 配置 + 日志 + 证书备份 都在一处
- **git 跟踪**：Caddyfile / ecosystem.config.js 跟代码一起 versioned
- **迁移简单**：`git clone` 整套, 不用单独 rsync `/etc/`

### 7.4 PM2 跨平台 (`deploy/ecosystem.config.js`)

- 用 `process.platform === 'win32'` 自动选路径
- Linux: `cwd: "/opt/gdufsmc"`, `log_file: "/opt/gdufsmc/logs/..."`
- Windows: `cwd: "H:\\GDUFSMC-web"`, `log_file: "H:\\GDUFSMC-web\\logs\\..."`
- 一份配置, 两套系统都能跑

---

## 八、安全（分层防御）

### 8.1 Layer 1: GitHub 仓库

- 公开仓库 + branch protection on main
- PAT 模式: Sveltia 用户在浏览器粘贴 PAT, 不存仓库
- 即使 token 泄露也只能 commit (PR 模式需审核)

### 8.2 Layer 2: `/admin` 路径 (Caddy basic auth)

Caddyfile 里 `@adminPath` 覆盖 `/admin`、`/admin/*`、`/api/admin`、`/api/admin/*`（`/api/admin` 也在内，因为它同样需要鉴权）：

```caddyfile
@adminPath path /admin /admin/* /api/admin /api/admin/*
import secrets.caddy
```

`secrets.caddy` 内含 `basicauth @adminPath { admin $2a$14$BCRYPT_HASH }`。

| 层 | 措施 | 防什么 |
|---|------|------|
| 1 | basic auth (bcrypt) | 密码不知道直接 401 |
| 2 | 速率限制 (见 `proxy.ts` 的 `/api/server-status` 限流) | 接口暴力刷 |
| 3 | GitHub Actions 只通过 main branch 部署 | PAT 泄露也需 PR |

> **已知事项**：Caddy 的 `basic_auth` 会在 Next.js 之前短路，所以 401 响应拿不到 `next.config.ts` 里的 `no-store`，浏览器可能缓存这个空 401 导致「不弹密码框」。当前未处理。

### 8.3 Layer 3: 响应头 (next.config.ts + Caddyfile 双层)

- `Content-Security-Policy`（在 `scripts/build/csp.mjs` 里构造）
  - 主路径：`script-src 'self' 'unsafe-inline'` + **`script-src-attr 'none'`**（拦内联事件属性）
  - `/admin`：`script-src 'self' 'sha256-<内联脚本哈希>'`，**零 `unsafe-inline`**；另放行 `api.github.com`、`raw.githubusercontent.com`、`avatars.githubusercontent.com`、`unpkg.com`（Sveltia 运行时从 unpkg 拉 locale JSON）
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`

> 注意：EdgeOne 会用自己的一组头覆盖部分响应头（例如 HSTS 变成 `max-age=14400`），`Permissions-Policy` / `Referrer-Policy` 会重复出现。不影响功能，但要让 HSTS 一年生效需去 EdgeOne 控制台改。

### 8.4 Layer 4: Windows 防火墙 (deploy/setup.ps1 自动配)

- 入站: 80/443 (Caddy)
- 出站: 443 (GitHub Runner / Caddy ACME / npm)

---

## 九、日常运维

### 9.1 监控命令速查

```powershell
# PM2 状态
pm2 status
pm2 logs gdufsmc --lines 200

# Caddy 状态
nssm status Caddy
Get-Content H:\GDUFSMC-web\logs\caddy-stderr.log -Tail 50

# GitHub Runner 状态
Get-Service | Where-Object { $_.Name -like "actions.runner.*" }
# 或 GitHub 网页: https://github.com/QingShi-Dev/GdufsMC-Website/settings/actions/runners

# 健康检查
curl http://127.0.0.1:3000/
curl http://127.0.0.1:3000/api/server-status

# 磁盘空间
Get-PSDrive C

# 内存
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 10
```

### 9.2 日志位置

所有日志都在项目目录 `H:\GDUFSMC-web\logs\` 下，统一管理。

| 日志 | 路径 | 大小限制 |
|------|------|---------|
| PM2 综合 | `H:\GDUFSMC-web\logs\gdufsmc-combined.log` | PM2 默认 10MB 切 |
| PM2 错误 | `H:\GDUFSMC-web\logs\gdufsmc-error.log` | 同上 |
| PM2 输出 | `H:\GDUFSMC-web\logs\gdufsmc-out.log` | 同上 |
| Caddy stdout | `H:\GDUFSMC-web\logs\caddy-stdout.log` | NSSM 轮转 10MB |
| Caddy stderr | `H:\GDUFSMC-web\logs\caddy-stderr.log` | 同上 |
| Caddy 访问 | `H:\GDUFSMC-web\logs\caddy-access.log` | Caddy 滚 10MiB 保 5 |
| 发布 transcript | `H:\GDUFSMC-web\release-delivery\logs\publish-<请求ID>.log` | 累积，手工清 |
| GitHub Runner | `C:\actions-runner\_diag\*.log` | Runner 默认 100MB |

> 注意：`C:\actions-runner\` 是 GitHub Runner 安装目录，**不在项目目录**，但跟项目目录同台机器上。

### 9.3 备份策略

每周备份：

```powershell
# 备份项目数据（排除 node_modules + .next + logs）
Compress-Archive -Path H:\GDUFSMC-web\* `
    -DestinationPath C:\backup\gdufsmc-$(Get-Date -Format 'yyyy-MM-dd').zip `
    -CompressionLevel Optimal `
    -Force `
    -Exclude "node_modules",".next","logs","*.log"

# 备份 Caddy 证书（自动恢复部署时不用重申请）
Copy-Item -Recurse "C:\ProgramData\Caddy" "C:\backup\caddy-data-$(Get-Date -Format 'yyyy-MM-dd')"
```

Git history 在 GitHub 上，**不需要单独备份**。

### 9.4 升级 / 维护

| 操作 | 步骤 |
|------|------|
| 部署新代码 | 开发机 `git push origin main`（Actions 自动跑） |
| 重启应用 | 服务器 `pm2 restart gdufsmc` |
| 重启 Caddy | 服务器 `Restart-Service Caddy`（`admin off`，配置变了必须重启而非 reload） |
| 更新证书（手动） | `& "C:\Program Files\Caddy\caddy.exe" reload --config H:\GDUFSMC-web\Caddyfile --force` |
| 回滚代码 | 服务器 `git checkout <commit-hash>` → `pnpm run build` → `pm2 restart gdufsmc`（更推荐用 `publish-release.ps1 -Rollback`，它会同时恢复配套内容） |
| 看访问日志 | `H:\GDUFSMC-web\logs\caddy-access.log` |
| 完全重置 | `Remove-Item -Recurse H:\GDUFSMC-web`，重新跑 `setup.ps1` |

### 9.5 卸载（如需迁移到新服务器）

```powershell
# 停所有服务
Stop-Service Caddy
pm2 delete gdufsmc
Stop-Service "actions.runner.*"

# 卸载服务
nssm remove Caddy confirm
.\svc.sh uninstall

# 清理
Remove-Item -Recurse H:\GDUFSMC-web
Remove-Item -Recurse C:\actions-runner
Remove-Item -Recurse "C:\ProgramData\Caddy"

# 取消 GitHub Runner 注册
# https://github.com/QingShi-Dev/GdufsMC-Website/settings/actions/runners
# 点对应 runner 的 Remove 按钮

# 同时删除 DNS A 记录 (避免 DNS 还指向空服务器)
```

---

## 十、故障排查

### 10.1 浏览器访问超时

```powershell
# 1. DNS 解析对吗
nslookup gdufscraft.top

# 2. Caddy 跑着吗
nssm status Caddy
& "C:\Program Files\Caddy\caddy.exe" run --config H:\GDUFSMC-web\Caddyfile  # 前台跑看错误

# 3. 防火墙开了吗
Get-NetFirewallRule | Where-Object { $_.DisplayName -like "Caddy*" }

# 4. PM2 跑着吗
pm2 status
curl http://127.0.0.1:3000/
```

### 10.2 GitHub Runner 不工作

```powershell
# Runner 服务状态
Get-Service | Where-Object { $_.Name -like "actions.runner.*" }

# Runner 日志
Get-Content C:\actions-runner\_diag\Runner_*.log -Tail 100

# 重启 Runner
Stop-Service "actions.runner.*"
Start-Service "actions.runner.*"
```

### 10.3 部署后 502 Bad Gateway

PM2 没起来或端口不对：

```powershell
pm2 status
pm2 logs gdufsmc --err --lines 100
pm2 restart gdufsmc
```

### 10.4 HTTPS 证书没申请成功

```powershell
# 看 Caddy 日志
Get-Content H:\GDUFSMC-web\logs\caddy-stderr.log -Tail 100

# 常见原因:
#   - DNS 没解析 (用 nslookup 检查)
#   - 80 端口被防火墙拦 (ACME HTTP-01 验证需要 80 入站)
#   - Caddy 数据目录权限 (用管理员运行)
```

### 10.5 内存不够 build 失败

```powershell
# 看内存
Get-Counter "\Memory\Available MBytes"

# 临时关停 PM2 释放内存
pm2 stop gdufsmc
pnpm run build
pm2 start gdufsmc
```

### 10.6 内容同步卡住 / 报未完成 journal

见[第2章的「日常行为与恢复」](#27-日常行为与恢复)。要点：先关 `CONTENT_SYNC_ENABLED` 并停计划任务，再按 journal 的 `phase` / `backupPath` 恢复，**不要盲删 journal**。

---

## 十一、速查表

### 11.1 关键文件

| 文件 | 作用 | 跑在哪 |
|------|------|--------|
| `Caddyfile` (项目根) | Caddy 反代 + 自动 HTTPS + basic auth | 手动复制到 `H:\GDUFSMC-web\` |
| `deploy/ecosystem.config.js` | PM2 配置 (cwd 自动按 OS 切换) | 服务器 `H:\GDUFSMC-web/deploy/` |
| `deploy/setup.ps1` | Windows 校园服务器一次性初始化 | 服务器 (Administrator) |
| `deploy/setup-caddy-service.ps1` | 把 Caddy 装成 Windows 服务 (NSSM) | 服务器 (Administrator) |
| `deploy/setup-content-sync.ps1` | 内容同步工具与计划任务安装器 | 服务器 (Administrator) |
| `deploy/setup-release-publish.ps1` | 自动发布工具与计划任务安装器 | 服务器 (Administrator) |
| `deploy/publish-release.ps1` | 发布 / 回滚核心逻辑 | 服务器 (Administrator) |
| `deploy/content-operations.ps1` | 内容读取/校验/切换的共享函数 | 随 content-tools 一起装 |
| `secrets.caddy.example` | basic auth 哈希模板 | 开发机生成哈希 |

### 11.2 项目目录 `H:\GDUFSMC-web`

```
H:\GDUFSMC-web\                                 ← 项目根 (服务器部署目录)
├── Caddyfile                                ← Caddy 配置（反代 + HTTPS + basic auth）
├── app/  components/  lib/                  ← Next.js 源码
├── content/                                 ← Markdown/YAML 内容数据
├── public/                                  ← 静态资源（图片、图标）
├── .next\                                   ← 构建产物（git ignore，每次部署重新生成）
├── node_modules\                             ← 依赖（git ignore）
├── logs\                                    ← 所有日志（git ignore）
├── releases\                                ← 当前 + 上一版本
├── incoming\  candidate\  artifacts\         ← 发布暂存区
├── content-backups\  content-failed\        ← 内容备份 / 失败内容
└── deploy\                                  ← 部署配置（git 跟踪）
```

### 11.3 系统级目录（不在项目目录）

```
C:\actions-runner\                          ← GitHub Runner 目录（系统级）
├── _diag\                                   ← Runner 诊断日志
├── _work\                                   ← Runner 工作目录（job 临时文件，部署后清理）
├── *.cmd / *.sh                            ← Runner 可执行脚本
└── config / .runner                         ← Runner 配置

C:\Program Files\Caddy\caddy.exe            ← Caddy 可执行文件
C:\ProgramData\Caddy\                       ← Caddy 数据 + 自动续期的证书
├── acme\                                    ← Let's Encrypt 证书
└── ocsp\                                    ← OCSP 缓存

C:\backup\                                   ← 备份目录（手动创建，每周备份到这里）
├── gdufsmc-<日期>.zip                       ← 项目数据 + 配置 + content
└── caddy-data-<日期>\                      ← Caddy 证书备份
```

### 11.4 关键参数

| 参数 | 值 |
|------|-----|
| 项目部署目录 | `H:\GDUFSMC-web` |
| GitHub Runner 目录 | `C:\actions-runner` |
| Node 版本 | 24.21.0（发布清单强制一致） |
| Next.js 端口 | 3000 (反代) |
| Caddy 端口 | 80 (HTTP) + 443 (HTTPS) |
| GitHub Runner 标签 | `self-hosted`, `windows`, `gdufsmc` |
| 主域 | `gdufscraft.top` |
| www 重定向 | `www.gdufscraft.top` → `gdufscraft.top` (301) |
| Basic auth 路径 | `/admin/*` 与 `/api/admin/*` |
| Caddy 自动 HTTPS | Let's Encrypt (90 天自动续期) |
| 防火墙入站 | 80, 443 |
| 防火墙出站 | 443 (默认开放) |
| 项目数据存储 | `H:\GDUFSMC-web\content\` (git 跟踪) |
| 部署触发 | `git push origin main` → GitHub Actions 自动 build |

### 11.5 外部依赖

| 服务 | 用途 |
|---|---|
| 腾讯云 EdgeOne | CDN + 自动 purge（zone `zone-3vdw90vs6duq`） |
| Sakura Frp | Minecraft 服务器内网穿透（**与网站无关**，网站不走 frp） |
| GitHub Actions | 构建 + self-hosted runner 执行发布 |
| Sveltia CMS | 内容管理，vendored 固定 commit |

### 11.6 参考文档

- [Caddy 官方文档](https://caddyserver.com/docs/)
- [PM2 Windows 文档](https://pm2.keymetrics.io/docs/usage/process-container/)
- [GitHub Actions self-hosted runners](https://docs.github.com/en/actions/hosting-your-own-runners)
- [NSSM - the Non-Sucking Service Manager](https://nssm.cc/)