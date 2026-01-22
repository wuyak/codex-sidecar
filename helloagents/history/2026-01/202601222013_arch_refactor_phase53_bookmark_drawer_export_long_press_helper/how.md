# How - Phase53 bookmark drawer export long press helper

## 方案

1. 在 `wireBookmarkDrawer` 内新增 `_wireExportPrefsLongPress(btn, key)`
   - 复用原有 LONG_MS=520 / MOVE_PX=8 的判定
   - 内部处理 longFired click 抑制与弹层开关逻辑
2. 替换离线展示列表与会话列表中重复的 exportBtn 长按实现为 helper 调用。
3. 运行后端单测与编译校验，确保重构无语法错误。

## 风险控制

- 仅抽取重复逻辑，不改变事件绑定顺序与 UI 文案。
- helper 内部保留 try/catch，保持原实现的“最佳努力”容错风格。

