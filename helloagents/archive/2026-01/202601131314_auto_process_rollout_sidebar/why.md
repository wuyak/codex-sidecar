# 变更提案: 基于 Codex 进程的会话自动跟随 + 固定侧边栏切换

## 需求背景
当前 sidecar 通过轮询扫描 `CODEX_HOME/sessions/**/rollout-*.jsonl` 并选择“最近修改的文件”来跟随。该策略在以下情况下体验不佳：

1. **不够“当前”**：最近修改的文件不一定是正在进行的会话（可能是旧会话被补写/重放/触碰 mtime）。
2. **启动时机不自然**：需要手动开始监听，且在 Codex 未运行时仍可能选中某个历史文件。
3. **UI 可用性**：会话切换入口在页面上方，滚动到中后段时切换不便。

本变更目标是在 WSL2（Codex 进程运行于 Linux）场景下：通过检测正在运行的 Codex 进程来定位“正在写入的 rollout 文件”，并在 UI 左侧固定显示会话切换列表，保证随时可切换。

## 变更内容
1. **进程触发 + 文件定位**
   - 检测 Codex 进程是否存在（可配置匹配规则）。
   - 当检测到 Codex 进程时，优先从该进程（及必要的子进程）打开的 FD 中定位 `sessions/**/rollout-*.jsonl`。
   - 找到后自动切换并开始解析；无进程或未定位到文件时进入空闲/回退策略。

2. **自动开始解析监听（面向 UI 用户）**
   - 增加“自动模式”配置：sidecar 启动后无需手动点“开始监听”，当检测到 Codex 进程出现时自动开始跟随。

3. **固定侧边栏会话切换**
   - 将会话切换列表固定在左侧（滚动消息时不消失）。
   - 会话显示名更清晰：优先展示 `rollout-...` 中的时间戳 + short thread_id（或文件名兜底）。

## 影响范围
- **模块**
  - `rollout_sidecar`（watcher / server UI / controller / config）
- **文件（预估）**
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/watcher.py`
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/config.py`
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/controller.py`
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/server.py`
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/cli.py`（如需补充参数/默认行为）
  - `tools/codex_thinking_sidecar/README.md`
  - `helloagents/modules/rollout_sidecar.md`
- **API / 数据**
  - 不修改现有 `/ingest` 协议；可选增强 `/api/status` 返回更多“进程定位”状态字段（仅 UI 展示用）。

## 核心场景

### 需求: 自动跟随正在进行的会话文件
**模块:** rollout_sidecar
当 Codex 在 WSL2 中运行并开始产生会话时，sidecar 能自动找到并跟随“当前会话对应的 `rollout-*.jsonl`”。

#### 场景: Codex 进程启动并进入会话
前置条件：sidecar 已启动（UI 模式也可），配置了正确的 `CODEX_HOME`。
- 预期结果：检测到 Codex 进程后自动开始监听，无需手动点击开始。
- 预期结果：优先跟随该进程打开的 `sessions/**/rollout-*.jsonl`，而不是仅按 mtime 选“最新文件”。

#### 场景: Codex 进程退出或不存在
- 预期结果：sidecar 进入空闲状态（不再错误切到历史文件），UI 可提示“等待 Codex 进程”。

### 需求: 固定侧边栏随时切换会话
**模块:** rollout_sidecar
在用户滚动到页面中后段时，仍可直接切换到其他会话视图。

#### 场景: 滚动到中部/底部后切换
- 预期结果：左侧固定会话列表始终可见，可一键切换不同 thread/file。
- 预期结果：切换后消息列表按所选会话过滤展示，并保持现有 SSE 实时更新体验。

## 风险评估
- **风险: 进程匹配不准（误匹配/漏匹配）**
  - **缓解:** 提供可配置的进程匹配规则；在 `/api/status` 中展示匹配到的 PID/命中情况，便于排查。
- **风险: 未能从 FD 中定位到 rollout 文件**
  - **缓解:** 采用“进程优先、目录回退”的双通道策略；并提供明确状态提示。
- **风险: 扫描 `/proc` 带来额外开销**
  - **缓解:** 控制扫描间隔、只扫描匹配到的进程树、结果缓存与增量更新。
