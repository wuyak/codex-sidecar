# 轻量迭代任务清单：长列表懒渲染（装饰延后）

- [√] 新增装饰队列：`decorate/queue.js` 以 idle/分片方式批量 `decorateRow`，避免一次性重排卡顿
- [√] `renderMessage()` 支持 `deferDecorate`：刷新列表时对较早行延后装饰，末尾 N 行立即装饰保证可交互
- [√] 文档同步：CHANGELOG / wiki
- [√] 质量验证：`node --check`
- [√] 迁移方案包至 `helloagents/archive/` 并更新 `helloagents/archive/_index.md`
- [√] Git 提交
