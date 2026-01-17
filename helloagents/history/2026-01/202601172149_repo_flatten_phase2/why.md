# 变更提案: 仓库彻底扁平化（Phase 2）

## 需求背景
当前可运行的 Python 服务端与 UI 静态资源深藏在 `tools/` 下多层目录中（`tools/codex_thinking_sidecar/codex_thinking_sidecar/...`），且同目录混杂大量历史草稿/快照（已在 Phase 1 归档到 `old/`）。  
这种结构会导致：
- 启动入口与真实代码位置割裂（需要读脚本才能知道哪里是主代码）。
- 后续继续优化 UI/后端时定位成本高、误改风险高。
- 配置落点与路径策略难以统一。

因此需要进行“彻底扁平化”：把 **当前在用的后端/前端/脚本** 提升到仓库顶层的清晰结构，并把旧的 `tools/` 结构整体归档到 `old/`。

## 变更目标（保持功能不变）
1. **目录清晰**：根目录只保留必要模块：后端、前端、脚本、知识库、归档。
2. **快捷启动不变**：继续支持 `./ui.sh`、`./run.sh` 一键启动（允许实现改为转发到 `scripts/`）。
3. **配置落点显式且在项目内**：默认写入 `./config/sidecar/`，并在首次启动时从旧位置自动导入一次（避免“配置丢失”）。

## 目标目录结构（Phase 2 完成后）
```
./
  codex_sidecar/          # Python 后端（HTTP + watcher）
  ui/                     # 默认 UI（静态，无构建）
  ui_legacy/              # 可选：legacy 回滚/对照 UI
  scripts/                # 启动脚本（run/ui）
  config/sidecar/         # 本地配置（gitignore）
  helloagents/            # 知识库（保持不动）
  old/                    # 归档（Phase 1 已建立）
  run.sh / ui.sh          # 兼容入口（薄 wrapper）
  README.md / .gitignore  # 必要文件
```

## 影响范围
- **模块:** 后端包路径、UI 静态资源路径、启动脚本与默认配置路径、文档
- **文件:** 多文件迁移（路径调整为主），不改业务逻辑
- **API:** URL 路由保持不变（`/health`、`/ui`、`/ui-legacy`、`/events`、`/api/*`）
- **数据:** 配置迁移（仅本地文件移动/导入）

## 风险评估
- **风险:** 路径迁移导致 `PYTHONPATH`/静态资源路由失效，启动后 `/ui` 404 或 import 失败
- **缓解:** 分步迁移：先复制/改脚本→冒烟验证→再归档旧 `tools/`；同时保留 root wrapper，确保用户使用方式不变
