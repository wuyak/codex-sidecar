# How - Phase42 bookmark drawer interactions

## 方案

1. 新增 `ui/app/control/wire/bookmark_drawer/interactions.js`
   - 负责会话管理抽屉相关交互：点击/键盘触发、重命名 inline edit、导出、清除、监听开关、展示名单移除等。
   - 通过 `helpers` 注入 `onSelectKey/renderTabs/renderBookmarkDrawerList/threadDefaultLabel/pickFallbackKey/ensureHiddenSet/toastFromEl`，避免循环依赖与减少状态耦合。
2. 在 `ui/app/control/wire/bookmark_drawer.js` 中接入 `wireBookmarkDrawerInteractions(...)`
   - 删除原本内联的 handler 与 eventListener 绑定，保持行为一致。
3. 更新知识库模块文档，记录新增拆分点。
4. 运行后端单测与基础编译校验，确保重构不影响既有行为。

## 风险控制

- 仅做模块拆分与依赖注入，不改变业务分支逻辑。
- 保持事件监听绑定点与 DOM 选择器不变（从原实现迁移到新模块）。

