# 轻量迭代任务清单：去除 all 视图会话标识 + 翻译加速

- [√] UI：移除 all 视图每条消息的“会话标识 pill”（保留必要的 hover 信息即可）
- [√] 翻译：auto 模式仅自动翻译 `reasoning_summary`，避免 `agent_reasoning` 导致队列堆积
- [√] UI：`agent_reasoning` 在 auto 模式下按“手动可点翻译”展示/交互（状态文案不再误显示“翻译中”）
- [√] 文档同步：更新 wiki + changelog
- [√] 质量验证：`python3 -m py_compile` + `node --check --experimental-default-type=module` 通过
