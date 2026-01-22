# 任务清单: 修复 TUI gate 误报（Phase16）

目录: `helloagents/plan/202601221339_fix_tui_gate_false_positive/`

---

## 1. 后端修复
- [√] 1.1 修复 `codex_sidecar/watch/tui_gate_helpers.py` 的时间戳拆分逻辑，避免缩进示例行误报
- [√] 1.2 修复 `codex_sidecar/watch/tui_gate.py`：仅对带 timestamp 的行解析 ToolCall

## 2. 测试
- [√] 2.1 更新 `tests/test_tui_gate_helpers.py` 覆盖缩进示例行不触发解析

## 3. 文档更新
- [√] 3.1 更新 `helloagents/modules/rollout_sidecar.md` 记录“误报规避”策略
- [√] 3.2 更新 `helloagents/CHANGELOG.md` 记录本次修复

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [√] 5.1 将本方案包迁移至 `helloagents/archive/2026-01/202601221339_fix_tui_gate_false_positive/` 并更新 `helloagents/archive/_index.md`
