# 轻量迭代任务清单：通知 toast 不阻塞跳转按钮

- [ ] 调整通知 toast 的布局：避开右下角“↑/🔔/↓”按钮区域
- [ ] 确保 toast 不抢占点击（pointer-events 透传），不影响跳转/铃铛交互
- [ ] 文档同步：更新 wiki + changelog（如需要）
- [ ] 质量验证：node 语法检查

## 执行结果
- [√] 调整通知 toast 的布局：避开右下角“↑/🔔/↓”按钮区域
- [√] 确保 toast 不抢占点击（pointer-events 透传），不影响跳转/铃铛交互
- [√] 文档同步：更新 wiki + changelog
- [√] 质量验证：`node --check --experimental-default-type=module` 通过
