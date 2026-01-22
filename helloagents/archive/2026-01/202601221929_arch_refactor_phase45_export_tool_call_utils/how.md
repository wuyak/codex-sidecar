# How - Phase45 export tool call utils

## 方案

1. 新增 `ui/app/export/tool_calls.js`
   - 提供 `classifyToolCallText(text)`：封装 `parseToolCallText + inferToolName + safeJsonParse` 以及对 `update_plan`（含 `parallel`）的识别逻辑。
2. `ui/app/export.js`
   - 删除内联 `_extractUpdatePlanFromParallelArgs/_classifyToolCallText`，改为调用 `classifyToolCallText(...)`。
   - 清理无用 import（`inferToolName/parseToolCallText`）。
3. 更新知识库，记录导出模块拆分点。
4. 运行后端单测与编译校验（本阶段仅前端重构，确保后端不受影响）。

## 风险控制

- 新模块仅做纯解析与分类，不涉及 DOM/网络/状态写入。
- 保持返回结构字段名一致（`toolName/callId/argsRaw/argsObj/isPlanUpdate/planArgs`）。

