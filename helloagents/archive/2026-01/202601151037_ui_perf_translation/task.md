# 轻量迭代任务清单：UI 性能与翻译体验优化

- [√] 列表刷新性能：`refreshList()` 使用 `DocumentFragment`，避免逐条触发重排/滚动
- [√] SSE 稳定性：刷新期间缓存 SSE 消息，刷新结束后再批量回放，避免插入与清空并发
- [√] 翻译体验：对照/英文模式下也能明确看到“ZH 翻译中”的占位提示
- [√] 文档同步：README / wiki / CHANGELOG
- [√] 质量验证：`node --check`（UI 模块）+ `python3 -m py_compile`
- [√] 迁移方案包至 `helloagents/archive/` 并更新 `helloagents/archive/_index.md`
