# 任务清单: TUI Gate 解析/渲染逻辑解耦（Phase15）

目录: `helloagents/plan/202601221248_arch_refactor_phase15_tui_gate_helpers/`

---

## 1. watch 模块
- [√] 1.1 新增 `codex_sidecar/watch/tui_gate_helpers.py`，抽离时间戳拆分/ToolCall 解析/脱敏/Markdown 生成逻辑，验证 why.md#需求-ui-能提示终端等待确认
- [√] 1.2 重构 `codex_sidecar/watch/tui_gate.py` 调用 helper，保留原有接口与行为不变

## 2. 测试
- [√] 2.1 新增 `tests/test_tui_gate_helpers.py` 覆盖解析与格式化关键分支（含脱敏）

## 3. 文档更新
- [√] 3.1 更新 `helloagents/wiki/modules/rollout_sidecar.md` 记录模块拆分
- [√] 3.2 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [√] 5.1 将本方案包迁移至 `helloagents/history/2026-01/202601221248_arch_refactor_phase15_tui_gate_helpers/` 并更新 `helloagents/history/index.md`
