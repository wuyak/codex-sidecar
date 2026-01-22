# Why - Phase53 bookmark drawer export long press helper

## 背景

`ui/app/control/wire/bookmark_drawer.js` 中“导出按钮长按打开导出设置”的长按手势逻辑在离线展示列表与会话列表中重复实现（pointerdown/move/up + longFired click 抑制），代码重复较多，后续维护容易产生不一致。

## 目标

- 抽离导出按钮长按逻辑为单一 helper，复用到两个列表渲染路径。
- 保持行为不变：长按触发导出设置弹层并抑制 click；再次长按可关闭弹层。

