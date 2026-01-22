# 技术设计: 基于 Codex 进程的会话自动跟随 + 固定侧边栏切换

## 技术方案

### 核心技术
- Python 3 标准库（`/proc` 文件系统读取、线程、HTTP server）
- 现有架构：`RolloutWatcher` 增量读取 JSONL → `POST /ingest` → 服务端 SSE → 浏览器 UI

### 实现要点

#### 1) 进程检测与 rollout 文件定位（WSL2/Linux）
新增“文件选择策略”：
- **process 优先**：当检测到匹配的 Codex 进程存在时，从其进程树（PID + 子进程）打开的 FD 中寻找符合规则的路径：
  - 必须位于 `watch_codex_home/sessions/**/rollout-*.jsonl`
  - 文件名匹配现有 `_ROLLOUT_RE`
- **fallback 回退**：若未能从进程 FD 定位到 rollout 文件，则回退到当前策略（扫描 sessions 目录选择 mtime 最新）。
- **idle 空闲**：当未检测到 Codex 进程时，可进入“空闲态”（不主动切换文件），并在 status 中标注等待原因。

定位实现建议：
- 不依赖 `lsof` 外部命令，优先使用 `/proc/<pid>/fd/*` 的 symlink 反查真实路径（更少依赖、更易跨环境复用）。
- 若 Codex 写入进程不在主进程本身，可通过构建 `ppid -> children` 关系，扫描“匹配到的 Codex 进程树”而非单 PID。

#### 2) 自动开始解析监听（UI 友好）
在 config 中新增开关（例如 `auto_start` / `follow_codex_process`）：
- UI 初始化时读取 config 与 status：
  - 若 `auto_start=true` 且当前 watcher 未运行，则自动调用 `/api/control/start`
  - watcher 运行后通过“进程优先策略”来决定何时真正开始跟随文件

说明：
- 该设计避免改变 CLI 既有默认行为，同时满足“UI 打开即自动工作”的诉求。

#### 3) 固定侧边栏会话切换（不影响现有滚动逻辑）
UI 采用 CSS 布局改造：
- 会话列表改为 **左侧固定 sidebar**（`position: fixed` + `overflow:auto`）
- 主内容区域增加左侧留白（例如 `margin-left`）避免遮挡
- 维持消息列表使用 `window` 滚动，从而尽量复用现有 autoscroll 逻辑与渲染流程（减少 JS 重构风险）

会话显示名建议：
- 从 `file` 字段提取 `rollout-YYYY-MM-DDTHH-MM-SS-...` 的时间信息，显示为本地时间（或原样显示 UTC 段）+ `short(thread_id)`
- 兜底：仅显示 `short(thread_id)` 或 `rollout-*.jsonl` 文件名

## 架构设计
```mermaid
flowchart LR
  Codex[Codex 进程（WSL2）] -->|append| JSONL[rollout-*.jsonl]
  Watcher[RolloutWatcher\n(process 优先定位 + 增量读取)] -->|POST /ingest| Server[SidecarServer]
  Server -->|SSE /events| UI[Web UI\nfixed sidebar + filter]
```

## 架构决策 ADR

### ADR-001: 使用 /proc 扫描 FD 定位 rollout 文件
**上下文:** 需要从“正在运行的 Codex 会话”精准定位当前写入的 `rollout-*.jsonl`，避免仅凭 mtime 扫描导致误选。
**决策:** 在 Linux/WSL2 下优先使用 `/proc/<pid>/fd` 读取 symlink 获取进程打开的 rollout 文件路径，并支持扫描 Codex 进程树。
**理由:**
- 无需外部依赖（相比 `lsof` 更稳定）
- 可将扫描范围收敛到“目标进程树”，效率更高
- 可在 status 中直接暴露 PID/命中信息便于排障
**替代方案:**
- `lsof -p <pid>`：实现更快但依赖外部命令，且在不同发行版/权限下不稳定
- 纯目录监听/inotify：仍无法保证“当前会话”，且与需求“进程触发”不一致
**影响:**
- 需要实现 PID 扫描与进程树构建逻辑，并控制扫描频率以免引入额外开销

## 安全与性能
- **安全:** 仅读取本机 `/proc` 与本地文件，不引入新的网络上传；仍需提醒用户 rollout 可能包含敏感信息。
- **性能:** 扫描间隔可复用 `file_scan_interval` 或新增 `process_scan_interval`；扫描范围限定为匹配的 Codex 进程树。

## 测试与验证
- 手动验证（WSL2）：
  1. 启动 `./ui.sh` 打开 `/ui`，启用自动模式并保存配置
  2. 启动 Codex，开始一个新会话，确认 UI 自动出现消息且 status 显示当前 follow_file
  3. 在滚动到页面中后段时，通过左侧 sidebar 切换会话，确认过滤正确
  4. 关闭 Codex，确认 sidecar 状态进入等待/空闲且不再错误切换到历史会话
