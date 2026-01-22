# 任务清单: RolloutWatcher follow 同步逻辑拆分（Phase20）

目录: `helloagents/plan/202601221427_arch_refactor_phase20_rollout_follow_sync/`

---

## 1. watch 模块
- [√] 1.1 新增 `codex_sidecar/watch/rollout_follow_sync.py`（抽离 pick + idle 判定 + targets 计算）
- [√] 1.2 重构 `codex_sidecar/watch/rollout_watcher.py` 的 `_sync_follow_targets()` 调用新模块（行为保持不变）

## 2. 测试
- [√] 2.1 新增 `tests/test_rollout_follow_sync.py` 覆盖 idle / pin 补齐关键分支

## 3. 文档更新
- [√] 3.1 更新 `helloagents/wiki/modules/rollout_sidecar.md`（watch 分层补充）
- [√] 3.2 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [√] 5.1 将本方案包迁移至 `helloagents/history/2026-01/202601221427_arch_refactor_phase20_rollout_follow_sync/` 并更新 `helloagents/history/index.md`
