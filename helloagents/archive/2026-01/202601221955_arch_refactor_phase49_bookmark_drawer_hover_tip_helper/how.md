# How - Phase49 bookmark drawer hover tip helper

## 方案

1. 在 `wireBookmarkDrawer` 内新增 `_canHoverTip(e)`，供离线展示列表与会话列表共用。
2. 在 `_renderList()` 中将 `wireMiniBtnHoverTip(btn)` 移到循环外，仅定义一次；内部使用 `_canHoverTip`。
3. 替换原本对局部 `canHoverTip` 的引用为 `_canHoverTip`。
4. 运行后端单测与编译校验，确保重构不引入语法错误。

## 风险控制

- 仅调整 helper 的定义位置与引用，不改动事件处理逻辑与 DOM 结构。

