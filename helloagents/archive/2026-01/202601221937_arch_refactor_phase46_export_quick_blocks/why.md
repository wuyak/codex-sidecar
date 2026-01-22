# Why - Phase46 export quick blocks

## 背景

`ui/app/export.js` 内联了 quick view blocks（精简导出块）读取/清洗逻辑（localStorage + state fallback）。该逻辑属于导出配置读取，与导出主流程无强耦合，导致 `export.js` 体积进一步膨胀。

## 目标

- 将 quick blocks 读取/清洗/默认值逻辑抽离为独立模块，降低 `export.js` 复杂度。
- 保持行为不变：优先 state，其次 localStorage，最后默认集合。

