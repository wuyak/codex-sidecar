# 轻量迭代任务清单：SSE 缓冲更新合并（减少翻译回填压力）

- [√] UI：对 `op=update` 的 SSE 缓冲做“按 id 覆盖合并”，避免大量译文回填把每个会话的缓冲顶爆
- [√] 文档同步：CHANGELOG / wiki（如有需要）
- [√] 质量验证：`node --check`
- [√] 迁移方案包至 `helloagents/history/` 并更新 `helloagents/history/index.md`
- [√] Git 提交
