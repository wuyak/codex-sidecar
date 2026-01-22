# 任务清单: RolloutWatcher.status payload 抽离（Phase32）

目录: `helloagents/plan/202601221705_arch_refactor_phase32_rollout_watcher_status/`

---

## 1. watch 模块
- [√] 1.1 新增 `codex_sidecar/watch/rollout_watcher_status.py`（status helper）
- [√] 1.2 重构 `codex_sidecar/watch/rollout_watcher.py` 调用 helper（行为保持不变）

## 2. 测试
- [√] 2.1 新增 `tests/test_rollout_watcher_status.py` 覆盖 payload

## 3. 文档更新
- [√] 3.1 更新 `helloagents/CHANGELOG.md` 记录本次重构
- [√] 3.2 更新 `helloagents/wiki/modules/rollout_sidecar.md` 增加模块条目（如适用）

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [√] 5.1 将本方案包迁移至 `helloagents/history/2026-01/202601221705_arch_refactor_phase32_rollout_watcher_status/` 并更新 `helloagents/history/index.md`
