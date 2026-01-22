# 变更提案: 修复 TUI gate 误报（Phase16）

## 需求背景
目前 `TuiGateTailer` 通过 tail `~/.codex/log/codex-tui.log` 识别：
- `INFO waiting for tool gate`
- `INFO tool gate released`

但 `codex-tui.log` 同时会记录 **apply_patch 的 patch 内容**、以及包含示例日志文本/字符串的代码片段。
当 patch/代码片段里出现类似：
`2026-01-14T12:34:56.123Z  INFO waiting for tool gate`
且该行在文本中带缩进时，现有解析（对行做 `lstrip()`）会把它误当作真实日志行，导致 UI 弹出“终端等待确认”的误导提示。

## 变更内容
在不改变正常场景行为的前提下：
1. 收紧 timestamp 拆分规则：仅当时间戳出现在行首（第 1 列）才认为是日志行
2. 仅对“成功拆出 timestamp”的行解析 ToolCall（避免 patch/代码片段污染 last_toolcall）
3. 增加单测覆盖“缩进示例行不得触发解析”

## 影响范围
- **模块:** watch
- **文件:** `codex_sidecar/watch/tui_gate_helpers.py`、`codex_sidecar/watch/tui_gate.py`、tests
- **API:** 无变更
- **数据:** 无变更

## 核心场景
### 需求: 只在真实 tool gate 时提示
**模块:** watch
当 Codex 真实进入 tool gate waiting 时提示；当日志里只是出现示例文本/patch 内容时不提示。

#### 场景: apply_patch 内容包含缩进示例行
- 预期结果：不会触发 tool_gate waiting 事件与右下角 sticky toast

## 风险评估
- **风险:** 过度收紧导致真实日志行无法解析（漏报）
- **缓解:** 只收紧“必须行首为时间戳”，真实日志通常满足；并补单测验证原有格式仍能解析
