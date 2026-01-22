
# How: Export prefs panel 拆分（Phase40）

- 新增 `ui/app/control/wire/export_prefs_panel.js`，封装：
  - 会话级导出偏好 key 的选择与 UI 同步
  - 弹层打开（靠近触发按钮）与对齐抽屉位置的定位逻辑
  - 偏好切换后触发书签列表重绘（通过回调注入，避免强耦合）
- `ui/app/control/wire.js` 改为创建 panel controller，并继续以 `_openExportPrefsPanel` 供后续代码调用（行为保持不变）。

