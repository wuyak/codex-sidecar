# 轻量迭代任务清单：刷新期 SSE Pending 上限与回源保护

- [√] UI：`ssePending` 增加长度上限，避免刷新列表时长时间积压导致卡顿/内存上涨
- [√] UI：检测到 pending 溢出后，刷新结束自动触发一次回源 `refreshList()` 兜底同步
- [√] 文档同步：CHANGELOG / wiki（如有需要）
- [√] 质量验证：`node --check`
- [√] 迁移方案包至 `helloagents/archive/` 并更新 `helloagents/archive/_index.md`
- [√] Git 提交
