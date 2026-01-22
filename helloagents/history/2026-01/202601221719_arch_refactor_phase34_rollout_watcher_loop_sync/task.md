# 任务清单: RolloutWatcher run loop 同步调度逻辑解耦（Phase34）

目录: `helloagents/plan/202601221719_arch_refactor_phase34_rollout_watcher_loop_sync/`

---

## 1. watch 模块
- [√] 1.1 扩展 `codex_sidecar/watch/rollout_watcher_loop.py`（同步决策 helper）
- [√] 1.2 重构 `codex_sidecar/watch/rollout_watcher.py` 使用 helper（行为保持不变）

## 2. 测试
- [√] 2.1 扩展 `tests/test_rollout_watcher_loop.py` 覆盖同步决策分支

## 3. 文档更新
- [√] 3.1 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [√] 5.1 将本方案包迁移至 `helloagents/history/2026-01/202601221719_arch_refactor_phase34_rollout_watcher_loop_sync/` 并更新 `helloagents/history/index.md`
