# 轻量迭代任务清单：UI 模块优化（拆分长文件）

- [√] 拆分 UI `sdk.js`：引入 `ui/app/sdk/*`，保留门面导出不变
- [√] 拆分 UI `render.js`：引入 `ui/app/render/*`，保留门面导出不变
- [√] 更新文档与知识库：README / wiki / CHANGELOG
- [√] 质量验证：`node --check`（UI 模块）+ `python3 -m py_compile`
- [√] 迁移方案包至 `helloagents/archive/` 并更新 `helloagents/archive/_index.md`
