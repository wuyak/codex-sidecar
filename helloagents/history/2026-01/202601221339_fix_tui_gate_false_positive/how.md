# 技术设计: 修复 TUI gate 误报（Phase16）

## 技术方案
### 核心技术
- Python 标准库（re）

### 实现要点
- `tui_gate_helpers.split_ts()`：
  - 不再对行做 `lstrip()`（避免缩进示例行被当作日志行）
  - 增加“行首必须是数字”判定（更明确的 guard）
- `TuiGateTailer._scan_gate_state()`：
  - 仅当 `ts` 非空时才解析 ToolCall（避免 patch 文本中出现 `ToolCall:` 污染 last_toolcall）
- 单测：
  - 增加缩进示例行用例，确保 `split_ts()` 不误判

## 测试与部署
- **测试:** `python3 -m unittest discover -s tests`
- **部署:** 重启 sidecar 生效（仅运行态解析逻辑变更）
