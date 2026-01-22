# Why - Phase49 bookmark drawer hover tip helper

## 背景

`ui/app/control/wire/bookmark_drawer.js` 在会话管理抽屉列表渲染时，会在每一行渲染循环中重复定义 `canHoverTip` 与 `wireMiniBtnHoverTip`（闭包函数），增加不必要的函数分配与阅读噪音，并且与离线展示列表中的 hover 判定逻辑重复。

## 目标

- 将 hover 判定统一为单一 helper（`_canHoverTip`），并将 `wireMiniBtnHoverTip` 提升到列表渲染循环之外，减少重复创建。
- 保持行为不变：仅在 mouse/非 coarse pointer 下显示 hover tip，触控设备不弹出。

