# 任务清单: watcher 热更新逻辑解耦（Phase30）

目录: `helloagents/plan/202601221640_arch_refactor_phase30_watcher_hot_updates/`

---

## 1. control 模块
- [√] 1.1 新增 `codex_sidecar/control/watcher_hot_updates.py`（热更新 helper）
- [√] 1.2 重构 `codex_sidecar/controller_core.py` 调用 helper（行为保持不变）

## 2. 测试
- [√] 2.1 新增 `tests/test_watcher_hot_updates.py` 覆盖关键分支

## 3. 文档更新
- [√] 3.1 更新 `helloagents/CHANGELOG.md` 记录本次重构
- [√] 3.2 更新 `helloagents/wiki/modules/rollout_sidecar.md` 补充 control 分层条目（如适用）

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [ ] 5.1 将本方案包迁移至 `helloagents/history/2026-01/202601221640_arch_refactor_phase30_watcher_hot_updates/` 并更新 `helloagents/history/index.md`
