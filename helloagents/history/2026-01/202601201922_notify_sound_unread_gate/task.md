# 轻量迭代任务清单：提示音仅在新通知触发 + 标签提示优化

- [√] 后端：为 watcher 回放导入的消息标记 `replay=true`（区分历史补齐/实时新增）
- [√] 前端：提示音/未读只在“新通知”时触发（回放不响铃；当前视图在底部视为已读）
- [√] UI：优化底部标签 hover 提示（延迟显示、关闭提示锚点对齐）与未读徽标留白
- [√] 文档同步：更新 `helloagents/CHANGELOG.md` 与模块文档
- [√] 质量验证：`python3 -m unittest discover` + `node --input-type=module` 导入检查
