# codex-thinking-sidecar-zh

> 旁路读取 Codex 会话 JSONL 的本地 UI 工具（不修改 Codex）。

## 模块索引

| 模块名称 | 职责 | 状态 | 文档 |
|---------|------|------|------|
| rollout_sidecar | 监听 rollout JSONL + UI 展示 + 翻译 Provider | 开发中 | modules/rollout_sidecar.md |
| nvidia_translate | NVIDIA NIM 翻译 Provider（Chat Completions） | 开发中 | modules/nvidia_translate.md |

- UI（默认 /ui）：legacy 静态 UI（保留现有交互/筛选/性能优化逻辑）
  - 源码目录：`tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/`
  - 回滚/对照：`tools/codex_thinking_sidecar/codex_thinking_sidecar/ui_legacy/`，服务端路由 `/ui-legacy`
  - 会话切换：右侧书签栏用于会话切换；默认窄条，hover/当前会话自动展开；长按可重命名（为保持极简，已移除“会话书签管理抽屉”入口）

- UI v2（/ui-v2）：Vue 3 + Vite + Pinia（实验入口，逐项对齐迁移，不影响 `/ui`）
  - 源码工程：`tools/codex_thinking_sidecar/codex_thinking_sidecar/ui_v2/`
  - 构建产物：`tools/codex_thinking_sidecar/codex_thinking_sidecar/ui_v2/dist/`
  - 构建脚本：`tools/codex_thinking_sidecar/codex_thinking_sidecar/ui_v2/deploy.sh`（仅 build，不再覆盖 `/ui`）
