# 技术设计: Codex SDK 控制模式（浏览器输入 → 本机持续对话）

## 技术方案

### 核心技术
- **Codex SDK:** `@openai/codex-sdk`（Node.js ≥ 18）
- **现有旁路服务端:** `tools/codex_thinking_sidecar/*`（Python 标准库 HTTPServer）
- **浏览器通信:** 复用现有 SSE `/events`（旁路输出 + SDK 控制输出统一展示）

### 实现要点
1. **以 SDK 作为“官方可写入口”**：通过 `codex.startThread()` / `codex.resumeThread(threadId)` 与 `thread.run(prompt)` 驱动持续对话，而非尝试向已运行的 TUI 进程注入 stdin。
2. **新建隔离模块目录**：按你期望在仓库 `src/codex-sdk/` 落地 SDK 逻辑，保持与现有 Python 旁路模块解耦。
3. **保持默认体验不变**：默认仍是“旁路只读”；SDK 控制属于可选模式，显式启用。
4. **落地选择（更稳更简单）**：不常驻 Node HTTP 服务；由 Python sidecar 按需 `subprocess.run(["node", "run_turn.mjs"])` 执行单次 turn（线程由 `threadId` 续聊，UI 侧保存）。

## 架构设计

```mermaid
flowchart LR
  UI[浏览器 UI] -->|HTTP/SSE| Py[Python Sidecar Server]
  Py -->|旁路监听| Watcher[RolloutWatcher]
  Watcher -->|/ingest| Py

  UI -->|控制输入/会话| Py
  Py -->|spawn(按需)| Node[Codex SDK Runner (Node)]
  Node -->|Codex SDK| Codex[Codex 本机执行/Sandbox]
  Py -->|写回 /events| UI
```

> 注：Runner 模式避免常驻第二端口/第二服务；UI 仍保持同源访问，减少跨域与多事件源割裂。

## 架构决策 ADR

### ADR-001: 采用 Node Runner 承载 Codex SDK（按需 spawn）
**上下文:** 当前服务端是 Python 标准库实现；Codex SDK 文档以 Node 包形式提供，并要求 Node.js ≥ 18。  
**决策:** 新增 `src/codex-sdk/` 作为 Node runner（bridge），由 Python sidecar 按需 spawn 执行一次 turn；Python 侧提供同源 API 与 UI 资源，并将结果写回 `/events`。  
**理由:**
- 代码边界清晰：Python 继续负责旁路监听/UI，Node 负责 SDK 控制
- 对 UI 更简单：可保持同源（`127.0.0.1:<port>`）访问，减少 CORS 与多端口复杂度
- 未来可替换：如后续出现官方 Python SDK，可把 bridge 替换为 Python 实现
**替代方案:**
- 方案B：UI 直接访问 Node 服务（跨端口）→ 拒绝原因：跨域/多事件源管理复杂、用户体验割裂
- 方案C：直接在 Python 内实现 SDK → 拒绝原因：目前文档以 Node SDK 为主，需额外确认可用的 Python 入口
**影响:** 引入 Node 运行时；每次 turn 会启动一个短命的 `node`+`codex` 子进程；不需要额外端口与常驻服务。

## API 设计（落地版）

### 状态探测
- `GET /api/sdk/status`
  - **描述:** 探测 runner/node/依赖/CODEX_HOME 可写性，并下发 CSRF token
  - **响应:** `{ ok, available, deps_installed, node, codex_home_*, csrf_token }`

### 对话与执行（一次 turn）
- `POST /api/sdk/turn/run`
  - **描述:** 在指定 thread 上执行一次用户输入（一次 turn）；未提供 `thread_id` 时自动新建 thread
  - **输入:** `{ text: string, thread_id?: string }`（兼容 `threadId` 字段）
  - **响应（MVP）:** `{ ok: true, thread_id: string, final: string }`
  - **副作用:** 将 user/assistant 以 `user_message/assistant_message` 形式写回 `/events`，便于 UI 统一展示

## 数据模型（建议稿）
- **会话标识:** `threadId` 为核心 SSOT（UI 侧可用 localStorage 记忆最近 threadId；服务端可选持久化“别名/列表”）
- **并发策略:** 默认同一 thread 同时仅允许 1 个 active turn；多 thread 并发可配置上限

## 安全与性能
- **安全:**
  - 仅监听 `127.0.0.1`
  - 控制类接口要求 CSRF token（UI 先 `GET /api/sdk/status` 获取 token，再带 `X-CSRF-Token`）
  - UI 明示“控制模式 = 本机执行入口”，默认关闭
- **性能:**
  - 当前先做非流式（MVP）；后续可接入 `runStreamed()` 以更贴近 CLI
  - 为事件与日志做背压（队列/丢弃策略），避免 UI 卡死

## 测试与部署
- **测试:**
  - 单元：bridge 的 thread 生命周期、输入校验、并发限制
  - 手工：新建 thread → 连续对话 → 中断 → 恢复 thread → 关闭/重启服务
- **部署/运行:**
  - 无需常驻 Node 服务；只需确保 `src/codex-sdk` 已 `npm install`
