# Why - Phase48 import dialog remove legacy renderer

## 背景

`ui/app/control/wire/import_dialog.js` 内保留了一套旧的离线文件列表渲染实现（`renderImportListLegacy`），已不再被当前导入弹窗逻辑调用。该遗留实现体积较大，会显著增加后续维护/重构的冲突概率与阅读成本。

## 目标

- 移除未使用的 legacy renderer，缩小文件体积与认知负担。
- 保持现有导入弹窗行为不变（当前路径仍走 `renderImportList()`）。

