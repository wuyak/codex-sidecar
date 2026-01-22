# 轻量迭代任务清单：SSE 缓冲策略与 all 视图一致性

- [√] 修正 SSE 缓冲策略：仅对“已缓存视图”的会话 key 缓冲，避免长时间挂着导致内存被冷门 key 占用
- [√] all 视图一致性：当前在 `all` 视图时，仍为已缓存会话视图缓冲 SSE，切回时可无刷新看到最新
- [√] 侧栏性能：`op=update`（译文回填）不触发会话列表重绘
- [√] 文档同步：CHANGELOG / wiki
- [√] 质量验证：`node --check`
- [ ] 迁移方案包至 `helloagents/archive/` 并更新 `helloagents/archive/_index.md`
- [ ] Git 提交
