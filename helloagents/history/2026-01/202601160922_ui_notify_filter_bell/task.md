# 轻量迭代任务清单：通知过滤 + 铃铛可见

- [√] 通知过滤：仅“回答输出/审批提示”触发“有新输出”未读提示；忽略 tool_output/tool_call 等噪音
- [√] 铃铛可见：右下角 toast 不遮挡“↑/🔔/↓”浮动按钮（调整 corner-notify 位置）
- [√] 文档同步：更新 wiki + changelog
- [√] 质量验证：`python3 -m py_compile` + `node --check --experimental-default-type=module` 通过
