# 任务清单: RolloutWatcher 跟随状态分层（Phase 10）

目录: `helloagents/plan/202601221139_arch_refactor_phase10_rollout_follow_state/`

---

## 1. watch 分层
- [√] 1.1 新增 `codex_sidecar/watch/rollout_follow_state.py`：抽离 targets→cursors/primary 的落地逻辑
- [√] 1.2 重构 `codex_sidecar/watch/rollout_watcher.py`：调用 follow_state，保持行为与输出不变

## 2. 测试
- [√] 2.1 新增 `tests/test_rollout_follow_state.py` 覆盖 cursor 初始化/重复调用/primary 派生

## 3. 安全检查
- [√] 3.1 确认抽离后不引入新的路径穿越/敏感信息输出（按G9）

## 4. 文档更新
- [√] 4.1 更新 `helloagents/modules/rollout_sidecar.md` 记录模块边界变化
- [√] 4.2 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 5. 验证
- [√] 5.1 执行 `python3 -m compileall -q codex_sidecar`
- [√] 5.2 执行 `python3 -m unittest discover -s tests`
