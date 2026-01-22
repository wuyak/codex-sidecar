
# How: Bookmark drawer 模块化（Phase41）

- 新增 `ui/app/control/wire/bookmark_drawer.js`：
  - 负责“会话管理抽屉”列表渲染（监听中/关闭监听/展示中）
  - 负责抽屉开关、标签栏收起开关、以及相关点击/键盘交互
  - 内部仍复用现有 `wire/import_dialog.js`（导入对话）与 `/api/control/reveal_secret` 等既有控制面
- `ui/app/control/wire.js`：
  - 移除书签抽屉相关逻辑，改为调用 `wireBookmarkDrawer(...)`
  - 通过回调向 `export_prefs_panel` 提供“需要重绘抽屉列表”的入口（行为保持不变）
- 更新知识库文档，记录新增模块位置。

