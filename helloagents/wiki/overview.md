# codex-thinking-sidecar-zh

> 旁路读取 Codex 会话 JSONL 的本地 UI 工具（不修改 Codex）。

## 模块索引

| 模块名称 | 职责 | 状态 | 文档 |
|---------|------|------|------|
| rollout_sidecar | 监听 rollout JSONL + UI 展示 + 翻译 Provider | 开发中 | modules/rollout_sidecar.md |
| nvidia_translate | NVIDIA NIM 翻译 Provider（Chat Completions） | 开发中 | modules/nvidia_translate.md |

- UI 模块（ESM，无构建）：
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/app/markdown/*`: Markdown 渲染/清理/导入切分（含 inline/table 子模块）
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/app/decorate/core.js`: 行装饰实现（门面：`ui/app/decorate.js`）

  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/app/render/*`: 消息渲染实现（门面：`ui/app/render.js`；Markdown 缓存 + 翻译原位回填 + tool 卡片 + thinking/tool 分层）
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/app/list/*`: 列表刷新/线程聚合/启动回放（门面：`ui/app/list.js`）
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/app/events/*`: SSE 事件流（timeline/buffer/stream；门面：`ui/app/events.js`）
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/app/views.js`: 多会话视图缓存（切换复用 DOM + 还原滚动）
