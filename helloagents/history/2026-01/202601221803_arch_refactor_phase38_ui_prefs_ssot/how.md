
# How: UI prefs SSOT（Phase38）

- 新增 `ui/app/control/ui_prefs.js`：集中定义 localStorage key、读取 helper、以及 CSS 变量应用函数。
- `load.js` 与 `wire.js` 改为调用该模块导出，移除重复实现（保持行为不变）。
- 更新知识库模块文档，记录 UI 偏好 SSOT 位置，便于后续维护。

