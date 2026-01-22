# 变更提案: follow sync plan 应用逻辑解耦（Phase37）

## 需求背景
`codex_sidecar/watch/rollout_watcher.py` 的 `_sync_follow_targets()` 同时做了多件事：
- 读取 selection/pin/excludes（锁）
- 调用 `build_follow_sync_plan()` 生成 plan
- 应用 plan 的元信息（process_file/pids/follow_mode）
- 应用 targets 到 runtime state（idle 清空、diff 判断、cursor 初始化、primary 计算）

其中“targets 应用”逻辑属于可测试的状态变换，不应与 watcher 本体方法耦合在一起。抽离后收益：
- `_sync_follow_targets()` 更聚焦“读取控制 + 生成 plan + 应用结果”
- targets 应用逻辑可独立单测（不依赖 RolloutWatcher 类）

## 变更内容
1. 扩展 `codex_sidecar/watch/rollout_follow_state.py` 新增 `apply_follow_sync_targets()`：
   - 处理 idle 清空 + targets diff + 调用 `apply_follow_targets()`
2. `RolloutWatcher._sync_follow_targets()` 调用 helper（行为保持不变）
3. 新增单测覆盖 idle 清空与 diff 判定关键分支

## 影响范围
- **模块:** watch
- **文件:**
  - `codex_sidecar/watch/rollout_follow_state.py`
  - `codex_sidecar/watch/rollout_watcher.py`
  - `tests/test_rollout_follow_state.py`
- **API:** 无（内部重构）
- **数据:** 无

## 风险评估
- **风险:** idle/diff 逻辑变化导致 follow targets 不更新或不清空
- **缓解:** helper 与旧逻辑等价 + 单测覆盖 + 全量测试回归

