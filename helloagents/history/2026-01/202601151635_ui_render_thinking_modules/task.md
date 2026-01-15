# 轻量迭代任务清单：render/thinking 分层与 update 降载

- [√] UI：将 `render/thinking.js` 拆分为 `render/thinking/*`（visibility/derive/patch/block），保留 facade 导出不变
- [√] UI：翻译回填 `op=update` 的思考块 patch 路径减少不必要 DOM 更新（例如跳过 EN 重渲染）
- [√] UI：思考块 `op=update` 成功 patch 后默认走 `queueDecorateRow`（避免频繁更新阻塞 UI）
- [√] 文档同步：CHANGELOG / wiki（如有需要）
- [√] 质量验证：`node --check`
- [√] 迁移方案包至 `helloagents/history/` 并更新 `helloagents/history/index.md`
- [√] Git 提交
