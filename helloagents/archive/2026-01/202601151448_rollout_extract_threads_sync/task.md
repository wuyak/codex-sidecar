# 轻量迭代任务清单：抽离 rollout 解析 + 线程列表回源同步

- [√] 抽离：`watcher.py` 的 JSONL 解析/提取逻辑 → `watch/rollout_extract.py`，让 watcher 聚焦“读行→入库→翻译入队”
- [√] UI：SSE 断线重连后标记 `threadsDirty`，下一次 `refreshList()` 时回源 `/api/threads` 同步会话列表（避免漏会话/排序不准）
- [√] UI：长时间挂着时对 `all` 视图做低频线程列表同步（避免依赖 SSE 造成的长期漂移）
- [√] 文档同步：README / wiki / CHANGELOG
- [√] 质量验证：`python3 -m py_compile`、`node --check`
- [√] 迁移方案包至 `helloagents/archive/` 并更新 `helloagents/archive/_index.md`
- [√] Git 提交
