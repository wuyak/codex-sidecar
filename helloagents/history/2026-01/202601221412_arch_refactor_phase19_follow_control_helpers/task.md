# 任务清单: RolloutWatcher follow 控制逻辑解耦（Phase19）

目录: `helloagents/plan/202601221412_arch_refactor_phase19_follow_control_helpers/`

---

## 1. watch 模块
- [√] 1.1 新增 `codex_sidecar/watch/follow_control_helpers.py`（pin 文件解析 + excludes 清洗）
- [√] 1.2 重构 `codex_sidecar/watch/rollout_watcher.py` 的 set_follow/set_follow_excludes 调用 helper

## 2. 测试
- [√] 2.1 新增 `tests/test_follow_control_helpers.py` 覆盖关键分支

## 3. 文档更新
- [√] 3.1 更新 `helloagents/wiki/modules/rollout_sidecar.md`（watch 分层补充）
- [√] 3.2 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [√] 5.1 将本方案包迁移至 `helloagents/history/2026-01/202601221412_arch_refactor_phase19_follow_control_helpers/` 并更新 `helloagents/history/index.md`
