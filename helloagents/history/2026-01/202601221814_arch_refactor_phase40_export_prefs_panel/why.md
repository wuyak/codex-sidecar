
# Why: Export prefs panel 拆分（Phase40）

`ui/app/control/wire.js` 内包含“导出偏好弹层”的状态管理、UI 同步与定位逻辑，且与其它 wiring 混在一起。

将该功能域抽离为独立模块可以：
- 让 `wire.js` 更聚焦编排
- 便于后续复用 `openExportPrefsPanel`（多处 export 按钮长按入口）
- 行为保持不变（仅重排代码结构）

