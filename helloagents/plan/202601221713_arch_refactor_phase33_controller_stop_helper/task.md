# 任务清单: controller.stop 线程停止逻辑解耦（Phase33）

目录: `helloagents/plan/202601221713_arch_refactor_phase33_controller_stop_helper/`

---

## 1. control 模块
- [√] 1.1 新增 `codex_sidecar/control/watcher_lifecycle.py`（stop/join helper）
- [√] 1.2 重构 `codex_sidecar/controller_core.py` 复用 helper（行为保持不变）

## 2. 测试
- [√] 2.1 新增 `tests/test_control_watcher_lifecycle.py` 覆盖关键分支

## 3. 文档更新
- [√] 3.1 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [ ] 5.1 将本方案包迁移至 `helloagents/history/2026-01/202601221713_arch_refactor_phase33_controller_stop_helper/` 并更新 `helloagents/history/index.md`
