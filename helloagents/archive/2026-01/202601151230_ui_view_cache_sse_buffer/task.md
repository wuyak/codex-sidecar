# 轻量迭代任务清单：UI 视图缓存与 SSE 缓冲回放

- [√] 引入 `list-view` 视图缓存：按会话 key 复用 DOM/索引，切换还原滚动
- [√] 非当前会话 SSE 缓冲：按 key 缓冲，切回回放；溢出或切到 `all` 强制 `refreshList()` 回源
- [√] 清空显示时同步清理视图缓存与 SSE 缓冲
- [√] 文档同步：README / wiki / CHANGELOG
- [√] 质量验证：`node --check`（UI 模块）+ `python3 -m py_compile`
- [√] 迁移方案包至 `helloagents/archive/` 并更新 `helloagents/archive/_index.md`
- [√] Git 提交
