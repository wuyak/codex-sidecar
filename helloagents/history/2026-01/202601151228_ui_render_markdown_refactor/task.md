# 轻量迭代任务清单：UI 渲染与 Markdown 拆分重构

- [√] 拆分 `ui/app/render/core.js`：抽出 `md_cache/thinking/tool` 子模块，职责更清晰
- [√] 修正模块依赖：`render/*` 统一从 `ui/app/format.js` 引用格式化工具（避免错误相对路径）
- [√] 拆分 `ui/app/markdown/render.js`：抽出 `inline/table` 子模块，保持纯静态 ESM
- [√] 文档同步：README / wiki / CHANGELOG
- [√] 质量验证：`node --check`（UI 模块）+ `python3 -m py_compile`
- [√] 迁移方案包至 `helloagents/history/` 并更新 `helloagents/history/index.md`
- [√] Git 提交
