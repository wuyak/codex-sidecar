# Why - Phase45 export tool call utils

## 背景

`ui/app/export.js` 同时包含导出主流程与大量“tool_call 文本解析/归一化/计划更新识别”的辅助逻辑，使导出模块过于臃肿，也不利于后续对工具输出渲染规则的独立演进。

## 目标

- 将 tool_call 解析与分类逻辑抽离到独立模块，降低 `export.js` 复杂度与耦合。
- 保持导出行为不变（同样的输入生成同样的 markdown 输出）。

