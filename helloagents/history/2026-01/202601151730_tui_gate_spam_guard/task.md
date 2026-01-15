# 轻量迭代任务清单：tool gate 事件防刷屏

- [√] 修复：`codex-tui.log` 在长时间等待确认时可能重复输出 `waiting for tool gate`，sidecar 仅在状态变化时发一条 `tool_gate` 消息，避免刷屏与会话计数膨胀
- [√] 文档同步：CHANGELOG / wiki（如需要）
- [√] 质量验证：`python3 -m py_compile ...`
- [√] 迁移方案包至 `helloagents/history/` 并更新 `helloagents/history/index.md`
- [√] Git 提交
