# 变更提案: tool_call / tool_output 友好展示与格式化

## 需求背景
当前 UI 对 `tool_call` / `tool_output` 的展示基本是“原样输出”，会出现：

1. `update_plan` 等工具的参数以 JSON 一行显示，**可读性差**（不自动分行、信息层级不清晰）。
2. `tool_output` 折叠摘要取第一行，往往是 `call_id=...`，**没有语义**；展开后也会重复出现 `call_id`。
3. 对 `shell_command` 等工具，UI 仅显示原始参数 JSON，用户很难快速理解“到底执行了什么命令、结果是什么”。

这些信息之所以会出现，是因为 Codex 的会话日志（`rollout-*.jsonl`）会以结构化事件记录工具调用（含参数）与工具输出；sidecar 当前把这些字段拼成文本并直接渲染。

## 变更内容
1. 在 UI 侧对 `tool_call` / `tool_output` 做**结构化解析**（不改变后端存储与日志格式）：
   - 从 `msg.text` 中解析出：`tool_name`、`call_id`、`args_raw` / `output_raw`
   - 建立 `call_id -> tool_call` 的映射，给 tool_output 提供上下文（工具名/命令摘要）
2. 对常见工具提供**专用渲染**：
   - `update_plan`：渲染为“计划列表”（按状态分行），并把 explanation 单独显示
   - `shell_command`：渲染为“工作目录 + 命令正文”，不再以参数 JSON 为主展示
3. 统一折叠摘要策略：
   - tool_output 的摘要优先显示 `tool_name + exit_code + 命令摘要/首行输出`，避免 `call_id` 作为摘要
   - `call_id` 作为元信息展示（可见但不干扰阅读）

## 影响范围
- `tools/codex_thinking_sidecar/codex_thinking_sidecar/server.py`（UI 渲染逻辑）
- `helloagents/modules/rollout_sidecar.md`（补充说明）
- `helloagents/CHANGELOG.md`（记录变更）

## 风险评估
- **风险: 解析基于文本约定，未来 Codex 日志格式变化可能导致解析失败**
  - **缓解:** 解析失败时自动回退到“原样展示”；并保留“原始参数/原始输出”折叠区用于排障。
