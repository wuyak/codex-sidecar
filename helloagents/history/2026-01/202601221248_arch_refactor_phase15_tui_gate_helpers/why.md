# 变更提案: TUI Gate 解析/渲染逻辑解耦（Phase15）

## 需求背景
`codex_sidecar/watch/tui_gate.py` 的 `TuiGateTailer` 目前同时包含：
- 文件 tail 与增量读取
- 行解析（去 ANSI、拆时间戳、识别 waiting/released、解析 ToolCall）
- 文本格式化（Markdown 组装、敏感信息脱敏、tool 名映射）
- UI 事件打包与去重/投递

虽然功能稳定，但职责较重，难以在不触碰 IO/状态机的前提下对“解析/格式化”做单测与复用。

## 变更内容
在不改变外部行为（事件 kind/schema、去重语义、输出文本与判定规则）的前提下：
1. 抽离“解析/格式化”的纯逻辑到独立 helper 模块
2. `TuiGateTailer` 保留现有接口与状态机，只调用 helper 完成解析与文本生成
3. 增加单测覆盖关键格式化/解析分支（包含脱敏）

## 影响范围
- **模块:** watch
- **文件:** `codex_sidecar/watch/tui_gate.py`（重构）、新增 `codex_sidecar/watch/tui_gate_helpers.py`、新增 tests
- **API:** 无变更
- **数据:** 无变更

## 核心场景
### 需求: UI 能提示终端等待确认
**模块:** watch
当 `codex-tui.log` 出现 `waiting for tool gate` / `tool gate released` 时，向 UI 推送 `tool_gate` 事件，减少“UI 看起来卡住”的困惑。

#### 场景: waiting 行包含 ToolCall 详情
- 预期结果：消息中包含工具名、理由（脱敏）与命令（脱敏）

## 风险评估
- **风险:** 重构导致 Markdown 细节变化、脱敏规则变化或解析边界变化，影响 UI 展示一致性
- **缓解:** helper 保持与原实现等价；新增单测覆盖格式化/脱敏与时间戳拆分关键路径
