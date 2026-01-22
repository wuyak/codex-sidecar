# 轻量迭代任务清单：侧栏渲染降频

- [√] SSE 高频消息下对 `renderTabs()` 做降频（合并到 50ms-200ms 一次），降低重排/重绘
- [√] 质量验证：`node --check`
- [ ] 迁移方案包至 `helloagents/archive/` 并更新 `helloagents/archive/_index.md`
- [ ] Git 提交
