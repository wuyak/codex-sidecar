# codex-thinking-sidecar-zh

> 旁路读取 Codex 会话 JSONL 的本地 UI 工具（不修改 Codex）。

## 模块索引

| 模块名称 | 职责 | 状态 | 文档 |
|---------|------|------|------|
| rollout_sidecar | 监听 rollout JSONL + UI 展示 + 翻译 Provider | 开发中 | modules/rollout_sidecar.md |
| codex_sdk | 通过 Codex SDK 提供“浏览器输入 → 本机持续对话”的控制模式 | 🚧开发中（MVP） | modules/codex_sdk.md |

- UI 模块（ESM，无构建）：
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/app/markdown/*`: Markdown 渲染/清理/导入切分
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/app/decorate/core.js`: 行装饰实现（门面：`ui/app/decorate.js`）

  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/app/render/core.js`: 时间线渲染实现（门面：`ui/app/render.js`）
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/app/list.js`: 列表刷新（`DocumentFragment` + refreshToken/Abort）
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/app/events.js`: SSE 事件流（刷新期间暂存/回放）
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/app/sdk/core.js`: SDK 控制 UI 实现（门面：`ui/app/sdk.js`）
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/app/sdk/storage.js`: SDK 选中会话存储（localStorage）
