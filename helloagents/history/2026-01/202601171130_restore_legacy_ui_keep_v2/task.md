# 任务清单: 恢复旧版 UI 为默认（/ui），UI v2 独立演进（/ui-v2）

目录: `helloagents/plan/202601171130_restore_legacy_ui_keep_v2/`

---

## 1. 回退与隔离
- [√] 1.1 将默认 `/ui` 恢复为重构前的 legacy UI（不改变其交互/筛选/性能优化逻辑）
- [√] 1.2 UI v2 保持在独立目录（`ui_v2/`），不再覆盖 `/ui`

## 2. 新路由（不影响旧逻辑）
- [√] 2.1 新增 `/ui-v2` 静态路由，用于访问 UI v2 构建产物
- [√] 2.2 调整 Vite build `base` 为 `/ui-v2/`，保证静态资源路径正确

## 3. 构建与验证
- [√] 3.1 `ui_v2` 可 `npm run build` 产出 `dist/`
- [√] 3.2 启动 sidecar 后 `/ui`、`/ui-v2`、`/ui-legacy` 均可访问（HTTP 200）

## 4. 文档同步
- [√] 4.1 更新 README 与知识库：默认 UI=legacy，UI v2=实验/逐项对齐迁移
