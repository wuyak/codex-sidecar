# Why - Phase50 export markdown utils

## 背景

`ui/app/export.js` 内包含多段 Markdown 兼容性处理逻辑（fence 平衡、代码块 fence 选择、从 UI 渲染态 HTML `<pre class="code">` 回转为 fenced code block）。这些属于可复用的纯文本处理，不应与导出主流程强耦合。

## 目标

- 抽离 Markdown 兼容性处理为独立模块，降低 `export.js` 体积与职责复杂度。
- 保持行为不变：输出 Markdown 仍能在不同 renderer 中稳定显示，不被未闭合 fence “吞掉后续内容”。

