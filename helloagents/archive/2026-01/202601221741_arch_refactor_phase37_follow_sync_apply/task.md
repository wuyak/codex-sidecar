# 任务清单: follow sync plan 应用逻辑解耦（Phase37）

目录: `helloagents/plan/202601221741_arch_refactor_phase37_follow_sync_apply/`

---

## 1. watch 模块
- [√] 1.1 扩展 `codex_sidecar/watch/rollout_follow_state.py`（targets 应用 helper）
- [√] 1.2 重构 `codex_sidecar/watch/rollout_watcher.py` 使用 helper（行为保持不变）

## 2. 测试
- [√] 2.1 扩展 `tests/test_rollout_follow_state.py` 覆盖关键分支

## 3. 文档更新
- [√] 3.1 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [√] 5.1 将本方案包迁移至 `helloagents/archive/2026-01/202601221741_arch_refactor_phase37_follow_sync_apply/` 并更新 `helloagents/archive/_index.md`
