# 轻量迭代任务清单：UI 事件流分层（events/ 子模块）

- [√] UI：将 `ui/app/events.js` 拆分为 `ui/app/events/*`（timeline/buffer/stream），保留 facade 导出不变
- [√] UI：刷新期间 `ssePending` 对 `op=update` 做按 id 覆盖合并（避免译文回填导致 pending 爆炸）
- [√] 文档同步：CHANGELOG / wiki（如有需要）
- [√] 质量验证：`node --check`
- [√] 迁移方案包至 `helloagents/history/` 并更新 `helloagents/history/index.md`
- [√] Git 提交
