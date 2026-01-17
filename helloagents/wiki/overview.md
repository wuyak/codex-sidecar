# codex_sidecar

> 旁路读取 Codex 会话 JSONL 的本地 UI 工具（不修改 Codex）。

## 模块索引

| 模块名称 | 职责 | 状态 | 文档 |
|---------|------|------|------|
| rollout_sidecar | 监听 rollout JSONL + UI 展示 + 翻译 Provider | 开发中 | modules/rollout_sidecar.md |
| nvidia_translate | NVIDIA NIM 翻译 Provider（Chat Completions） | 开发中 | modules/nvidia_translate.md |
| nvidia_translate_migration | NVIDIA 翻译接入迁移指南（配置/请求/响应/提示词） | 开发中 | modules/nvidia_translate_migration.md |

- 后端（HTTP + watcher）：`codex_sidecar/`
- 启动脚本：`scripts/`（根目录 `./ui.sh`、`./run.sh` 为兼容入口）
- 默认配置目录：`config/sidecar/`（已加入 `.gitignore`）

- UI（默认 `/ui`）：静态 UI（保留现有交互/筛选/性能优化逻辑）
  - 源码目录：`ui/`
  - 会话切换：左侧“自动隐藏会话列表”；鼠标移到最左侧热区浮现、离开自动隐藏；长按可重命名
  - 归档：旧版/快照 UI 已移入 `old/`（不再提供 `/ui-legacy`、`/ui-v2` 路由）
