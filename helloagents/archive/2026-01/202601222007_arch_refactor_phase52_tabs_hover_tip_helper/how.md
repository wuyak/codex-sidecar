# How - Phase52 tabs hover tip helper

## 方案

1. 在 `ui/app/sidebar/tabs.js` 增加 `_canHoverTip(e)` helper。
2. 移除 `_wireBookmarkInteractions()` 内的局部 `canHoverTip`，并将引用替换为 `_canHoverTip`。
3. 运行后端单测与编译校验，确保无语法错误。

