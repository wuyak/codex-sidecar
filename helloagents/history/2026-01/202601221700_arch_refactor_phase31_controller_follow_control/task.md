# 任务清单: Controller follow 控制逻辑解耦（Phase31）

目录: `helloagents/plan/202601221700_arch_refactor_phase31_controller_follow_control/`

---

## 1. control 模块
- [√] 1.1 新增 `codex_sidecar/control/follow_control_api.py`（follow 控制 helper）
- [√] 1.2 重构 `codex_sidecar/controller_core.py` 调用 helper（行为保持不变）

## 2. 测试
- [√] 2.1 新增 `tests/test_control_follow_control.py` 覆盖 helper
- [√] 2.2 新增 `tests/test_controller_follow.py` 覆盖 controller 调用路径

## 3. 文档更新
- [√] 3.1 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [√] 5.1 将本方案包迁移至 `helloagents/history/2026-01/202601221700_arch_refactor_phase31_controller_follow_control/` 并更新 `helloagents/history/index.md`
