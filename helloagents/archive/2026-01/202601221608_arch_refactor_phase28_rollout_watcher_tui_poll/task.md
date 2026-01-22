# 任务清单: RolloutWatcher 的 TUI 轮询节流逻辑解耦（Phase28）

目录: `helloagents/plan/202601221608_arch_refactor_phase28_rollout_watcher_tui_poll/`

---

## 1. watch 模块
- [√] 1.1 新增 `codex_sidecar/watch/rollout_watcher_loop.py`（节流决策 helper）
- [√] 1.2 重构 `codex_sidecar/watch/rollout_watcher.py` 使用 helper（行为保持不变）

## 2. 测试
- [√] 2.1 新增 `tests/test_rollout_watcher_loop.py` 覆盖节流分支

## 3. 文档更新
- [√] 3.1 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [√] 5.1 将本方案包迁移至 `helloagents/archive/2026-01/202601221608_arch_refactor_phase28_rollout_watcher_tui_poll/` 并更新 `helloagents/archive/_index.md`
