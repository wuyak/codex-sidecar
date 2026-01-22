# 轻量迭代任务清单：侧栏会话列表增量渲染

- [√] `renderTabs()` 改为复用已有 button 节点：仅更新文案/计数/颜色并用 `DocumentFragment` 重排
- [√] 避免重复绑定事件：改用 `oncontextmenu/ondblclick` 覆盖式赋值
- [√] 文档同步：CHANGELOG / wiki
- [√] 质量验证：`node --check`
- [√] 迁移方案包至 `helloagents/archive/` 并更新 `helloagents/archive/_index.md`
- [√] Git 提交
