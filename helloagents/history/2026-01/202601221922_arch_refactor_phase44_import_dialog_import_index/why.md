# Why - Phase44 import dialog import index

## 背景

`ui/app/control/wire/import_dialog.js` 的 `renderImportList()` 内联了“离线文件按 sessions/YYYY/MM/DD 分桶 + 年/月计数 + min/max 日期”索引构建逻辑，属于纯数据处理，与 DOM 渲染/交互无关，导致函数体冗长且不利于复用与回归。

## 目标

- 将索引构建逻辑抽离为纯函数模块，降低 `renderImportList()` 复杂度。
- 保持行为不变：索引结构（Map/Date/null）与统计规则保持一致。

