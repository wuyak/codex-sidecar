# codex_sdk

## 职责
提供一个**可选的控制模式**：通过 Codex SDK 在本机静默创建/恢复对话 thread，并允许浏览器 UI 把输入写入该对话，从而驱动 Codex 执行与输出（尽量贴近 CLI 交互体验）。

## 现状（MVP）
- Node bridge：`src/codex-sdk/run_turn.mjs`（stdin JSON → stdout JSON），支持 `threadId` 续聊与 `codexHome` 覆盖 `CODEX_HOME`
- Sidecar 聚合：`tools/codex_thinking_sidecar/codex_thinking_sidecar/server.py`
  - `GET /api/sdk/status`：探测 runner/node/依赖/CODEX_HOME 可写性，并下发 CSRF token
  - `POST /api/sdk/turn/run`：执行一次 turn，并把 user/assistant 写回 `/events`
- UI：`tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/` 底部输入栏（回车发送、支持恢复 threadId、支持“使用选中会话”）

## 输入/输出
- 输入：UI 侧的用户文本输入（未来可扩展：图片/本地文件上下文等）
- 输出：同一条 `/events` SSE 消息流（`user_message` / `assistant_message`），与旁路模式统一展示

## 边界与约束
- 默认仍以 `rollout_sidecar` 的“旁路只读”模式运行；`codex_sdk` 仅在用户显式启用时生效。
- 安全边界必须严格：控制模式等价于“本机执行入口”，必须默认仅允许本机访问，并具备 CSRF/token 等防护。

## 关键设计
- 推荐以 `src/codex-sdk/` 作为 Node bridge 子服务承载 SDK 逻辑（Codex SDK 文档以 Node 包形式提供且要求 Node.js ≥ 18）。
- Python sidecar 继续负责 UI 资源与旁路监听，可按需提供 `/api/sdk/*` 聚合/代理，避免 UI 跨域与多端口心智负担。

## 运行要求
- Node.js ≥ 18（用于 `src/codex-sdk`）
- 已安装依赖：`cd src/codex-sdk && npm install`
- 本机 Codex 已完成登录/鉴权（否则会返回 401 Unauthorized）
- `CODEX_HOME` 可写：
  - 优先：sidecar 配置 `watch_codex_home`
  - 回退：环境变量 `CODEX_HOME`
  - 再回退：`~/.codex`

## 安全边界（实现）
- 默认仅允许 loopback（`127.0.0.1/localhost/::1`）；如确需对外开放需显式设置 `CODEX_SDK_ALLOW_REMOTE=1`（不建议）。
- `POST /api/sdk/turn/run` 必须携带 `X-CSRF-Token`：
  - token 由 `GET /api/sdk/status` 下发
  - 仅驻内存，sidecar 重启后会变化

## 已知限制
- 当前为“每次 turn spawn 一次 `codex exec`”，并非向既有 TUI 进程注入 stdin/pty（更稳定、也更易于安全隔离）。
- 当前 UI 仅回填 `finalResponse`（非流式）。如需更贴近 CLI，可在后续对接 SDK 的 `runStreamed()` 把事件逐条写入 `/events`。

## 状态
- **状态:** 🚧开发中（MVP 可用）
- **最后更新:** 2026-01-14
