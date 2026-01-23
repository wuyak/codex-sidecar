# codex_sidecar

一个**不修改 Codex** 的旁路工具：读取 `CODEX_HOME/sessions/**/rollout-*.jsonl`，提取思考摘要/推理文本并在本地 Web UI 展示（可选翻译 Provider）。

核心原则：
- **读取优先**：先把英文原文入库/推送到 UI，避免翻译阻塞采集。
- **翻译解耦**：翻译在后台队列慢慢补齐，完成后以 `op=update` 回填到原消息块（不改变时间线位置）；失败仅回填 `translate_error`（用于状态/重试提示），不把告警写进内容区。
- **时间线稳定**：服务端为新增消息附加单调递增 `seq`，UI 按 `(timestamp, seq)` 插入渲染，避免“时间倒退/回跳”。
- **切换稳定**：UI 刷新期对 SSE 做暂存与批量回放，避免“回源刷新 + 实时插入”并发导致错位或闪烁。
- **切换可维护**：UI 通过模块拆分管理状态（render/list/events/markdown 等），尽量减少 DOM 手工管理导致的交互错乱。
- **跟随策略**：选择具体会话时，后端会自动 `pin` 到该会话对应的 rollout 文件（减少“自动跳走”）；切回 `all` 时恢复 `auto`。
- **未读提醒**：新输出会在左侧会话列表徽标显示未读数；可在设置中选择提示音或关闭。
- **行内翻译/切换**：未译时默认只显示英文原文；翻译完成后默认切到中文；单击思考块可在 EN/ZH 间切换；“翻译/重译”按钮可手动触发翻译请求（仍以 `op=update` 原位回填）。
- **渲染加速**：Markdown 渲染按消息缓存；翻译回填优先原位更新 ZH 区块，减少重绘与上下文丢失。
- **旁路只读**：不提供浏览器“驱动 Codex 执行”的控制入口（避免把 UI 变成远程执行面）。

## 快速开始

```bash
./ui.sh
```

打开：
- `http://127.0.0.1:8787/ui`

监视目录固定为 `CODEX_HOME`（默认 `~/.codex`，UI 仅展示不提供修改入口）；保存配置后点击“开始监听”。也可以启用“自动开始监听（UI）”省去手动点击。

如果你希望 **启动即开始监听**（不走 UI 按钮）：

```bash
./run.sh
```

## 分享/发布（GitHub 安全）

### 配置与敏感信息

- 本机配置默认落在 `config/sidecar/config.json`（已加入 `.gitignore`，不会提交到 GitHub）。
- 可发布/可提交的示例配置：`config/sidecar/config.example.json`（无敏信息）。
- UI 会对敏感字段做脱敏展示（例如 OpenAI `base_url/api_key`、HTTP Profile `token`、NVIDIA `api_key`），避免误拷贝泄漏。

### 打包发给别人（不改代码、开箱即用）

前提：对方有 Python 3（无需额外依赖）。

- 方式 A：直接打包当前 Git 版本（推荐）
  - `git archive --format=zip --output codex_sidecar.zip HEAD`
  - 对方解压后运行：`./ui.sh`

- 方式 B：只发一条命令（对方自行 clone）
  - `git clone <your_repo_url>`
  - `./ui.sh`

### 做成 exe（可行但需要额外工具）

可以用 PyInstaller 为每个系统单独打包（Windows/macOS/Linux 各自构建一次）。

注意：本项目会读取本机 `CODEX_HOME/sessions/**`，因此“开箱即用”仍依赖目标机器上安装/运行 Codex，并能访问对应的 sessions 目录。

已提供构建脚本（会把 `ui/` 静态资源一并打包到可执行文件中）：

```bash
./scripts/build_exe.sh
```

Windows（PowerShell）：

```powershell
.\scripts\build_exe.ps1
```

构建产物：
- Linux/macOS：`dist/codex-sidecar`
- Windows：`dist/codex-sidecar.exe`

运行示例：

```bash
./dist/codex-sidecar --ui
```

## 版本
本项目不维护单独的版本号，直接以 Git 提交为准（例如：`git rev-parse --short HEAD`）。

## 说明

### 翻译 Provider
- 可在 UI 切换（默认使用 `nvidia`）：
  - `http`：通用 HTTP 适配器（支持 Profiles）
  - `openai`：Responses API 兼容（用于 GPT 类网关/自建代理）
  - `nvidia`：NVIDIA NIM（Chat Completions 兼容；默认 `integrate.api.nvidia.com/v1`；内置 RPM 节流与 429 重试）

说明：
- 翻译默认不会阻塞采集；中文会稍后“回填”到对应消息。
- 为提高导入速度：仅在**回放/积压导入阶段**会对同一会话做**最多 5 条批量翻译**；实时新增通常逐条翻译（避免跨会话串流/无谓聚合）。
  - 批量翻译协议位于 `codex_sidecar/watch/translate_batch.py`：使用 `<<<SIDECAR_ITEM:{id}>>> ... <<<SIDECAR_END>>>` 进行打包/解包，确保“同一对话内批量、不同对话不串流”。
  - 对 `openai` Provider：批量 prompt 会被**原样**发送（不再额外包裹通用翻译 prompt），避免标记行被翻译/改动导致解包失败与性能退化。

### 高级设置（UI）
- `回放行数`：启动监听时从文件尾部回放最近 N 行（用于补历史）
- `翻译模式`：`自动翻译/手动翻译`；手动模式下仅在你单击思考块或点“翻译/重译”时才会发起翻译请求
- `并行会话`：同时 tail 最近 N 个会话文件（默认 3），用于“至少 3 个会话同时实时更新”（锁定仅影响主跟随，不阻断后台摄取）
- `进程定位/仅跟随进程/进程 regex`：在 Linux/WSL 下用 `/proc/<pid>/fd` 更精准跟随正在写入的 rollout 文件，减少“挂着但读旧会话”
- `poll/scan`：读文件/扫描新会话文件的频率

## 目录结构（概览）

- `codex_sidecar/`（后端）
  - `controller.py`: 监听线程生命周期与配置控制（供 HTTP handler 调用）
  - `watcher.py`: 跟随 rollout 读取→`/ingest`；TUI tool gate 提示；翻译通过 `watch/` 子模块异步回填
  - `watch/`: watcher 侧子模块（rollout 路径/进程扫描/跟随策略/翻译批处理与队列）
    - `watch/rollout_extract.py`: rollout JSONL 单条记录 → UI 事件提取（assistant/user/tool/reasoning）
  - `control/`: 控制面子模块（translator schema / translator 构建 / 配置校验）
- `server.py`: HTTP+SSE 启动器（绑定 state/controller，启动 ThreadingHTTPServer）
- `ui/`：默认 UI（静态源码，服务端以 `/ui/*` 提供）
- `scripts/`：启动脚本实现（`run.sh` / `ui.sh`）
- `config/sidecar/`：本地配置落点（默认；已加入 `.gitignore`）
  - 实际配置：`config/sidecar/config.json`（本机使用，已加入 `.gitignore`）
  - 示例配置：`config/sidecar/config.example.json`（可提交/发布，无敏信息）
- `old/`：归档（历史草稿/快照/旧 tools 结构）
- `helloagents/`: 知识库（`CHANGELOG.md` / `INDEX.md` / `modules/` / `archive/` / `plan/`）
