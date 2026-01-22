# Why - Phase42 bookmark drawer interactions

## 背景

`ui/app/control/wire/bookmark_drawer.js` 在 Phase41 拆出会话管理抽屉后仍包含较多“交互事件处理”（重命名/导出/清除/监听开关/展示名单等），导致文件体积偏大、职责混杂，后续继续拆分会增加改动风险。

## 目标

- 将“交互事件 wiring + 行为处理”从 `bookmark_drawer.js` 抽离为独立模块，降低主文件复杂度。
- 保持 UI 行为不变（仅重构结构与依赖边界）。

