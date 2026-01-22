# 任务清单: Controller retranslate 逻辑解耦（Phase27）

目录: `helloagents/plan/202601221537_arch_refactor_phase27_controller_retranslate/`

---

## 1. control 模块
- [√] 1.1 新增 `codex_sidecar/control/retranslate_api.py`（retranslate 逻辑抽离）
- [√] 1.2 重构 `codex_sidecar/controller_core.py` 调用 helper（行为保持不变）

## 2. 测试
- [√] 2.1 新增 `tests/test_controller_retranslate.py` 覆盖关键分支

## 3. 文档更新
- [√] 3.1 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [√] 5.1 将本方案包迁移至 `helloagents/archive/2026-01/202601221537_arch_refactor_phase27_controller_retranslate/` 并更新 `helloagents/archive/_index.md`
