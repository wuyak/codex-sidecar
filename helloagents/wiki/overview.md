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
  - 会话切换：底部“浏览器标签栏”风格（始终可见当前会话）；支持 `×` 临时关闭（该会话有新输出会自动回到列表）、长按重命名、右键移除/恢复
  - 会话管理：底部菜单按钮打开抽屉，可搜索/显示已移除会话/导出当前会话（Markdown）
  - 归档：旧版/快照 UI 已移入 `old/`（不再提供 `/ui-legacy`、`/ui-v2` 路由）
