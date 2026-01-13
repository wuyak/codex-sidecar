# 技术设计: tool_call / tool_output 友好展示与格式化

## 技术方案

### 核心策略：UI 层解析 + 渲染（不改后端协议）
原因：
- sidecar 的 `/ingest` 目前只需要 `id/kind/text` 等字段即可工作；
- 为保持兼容与减少改动，优先在前端将 `msg.text` “拆解”为结构化字段并按规则展示；
- 同时保留“原始文本”折叠区，避免丢失调试信息。

### 数据解析规则（启发式，失败即回退）
#### tool_call
输入示例（当前格式）：
```
shell_command
call_id=call_xxx
{"workdir":"...","command":"..."}
```
解析：
- `tool_name` = 第一行
- `call_id` = 以 `call_id=` 开头的行
- `args_raw` = 剩余内容（可能是 JSON）

#### tool_output
输入示例（当前格式）：
```
call_id=call_xxx
Exit code: 0
...
```
解析：
- `call_id` = 第一行（若存在）
- `output_raw` = 剩余内容
- 若 `call_id` 可映射到 tool_call，则显示 tool_name 与摘要

### 专用渲染
- `update_plan`：
  - `args_raw` JSON 解析成功后，按 `plan[]` 渲染为分行列表
  - `status` 映射到图标：`completed=✅`、`in_progress=▶`、`pending=⏳`
- `shell_command`：
  - `args_raw` JSON 解析成功后，提取 `workdir/command`
  - `command` 单独展示为代码块；其他字段放入“更多信息”
- 其它工具：
  - 若 `args_raw` 是 JSON → `JSON.stringify(obj, null, 2)` 生成缩进文本
  - 否则原样展示

### 摘要生成（tool_output）
优先级：
1. 若能解析出 `Exit code:` → 摘要展示 exit code
2. 若能找到对应 tool_call 且为 `shell_command` → 摘要附带命令首行（截断）
3. 否则展示输出首个非空行

## 测试与验证
- 通过 UI 观察：
  - `update_plan` 显示为列表而不是 JSON
  - `shell_command` 显示为命令块 + 工作目录
  - `tool_output` 折叠摘要不再是 `call_id=...`
- 保底：当解析失败时仍能看到原始文本（不影响功能）。
