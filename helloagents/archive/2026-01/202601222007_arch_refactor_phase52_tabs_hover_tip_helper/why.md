# Why - Phase52 tabs hover tip helper

## 背景

`ui/app/sidebar/tabs.js` 的 `_wireBookmarkInteractions()` 内联定义了 `canHoverTip()` 并在多个事件回调中重复引用，和其他 UI 模块（如 bookmark_drawer）存在相同 hover 判定逻辑，增加重复与阅读负担。

## 目标

- 把 hover 判定抽成文件级 helper（`_canHoverTip`），减少重复与闭包噪音。
- 保持行为不变：仅在 mouse/非 coarse pointer 下显示 hover tip。

