# 技术设计: RolloutWatcher follow 同步逻辑拆分（Phase20）

## 技术方案

### 核心技术
- Python 3.8
- 以“纯逻辑模块 + 单测”方式拆分 watcher 内联分支

### 实现要点
- 新增 `codex_sidecar/watch/rollout_follow_sync.py`
  - `FollowControls`: follow 控制面快照（selection/pin/excludes/watch_max_sessions）
  - `FollowSyncPlan`: pick 结果 + patched pin + targets + idle 标记
  - `build_follow_sync_plan()`: side-effect free 的“同步决策”函数
- `RolloutWatcher._sync_follow_targets()`
  - 继续由 watcher 自己负责：写回 status 字段、idle 清理、调用 `apply_follow_targets()`
  - targets 计算交由 `build_follow_sync_plan()`，降低 `_sync_follow_targets()` 的内联复杂度

## 安全与性能
- **安全:** 不引入新的 IO/外部依赖；输入仍由原逻辑清洗/约束
- **性能:** `idle/wait_*` 时保持不计算 targets（不触发 sessions 扫描），避免退化

## 测试与部署
- **测试:** 新增 `tests/test_rollout_follow_sync.py`，覆盖：
  - `idle` 时不调用 `compute_follow_targets`
  - `pin` 时缺失 file/thread_id 的补齐行为
- **部署:** 无（结构性重构，行为不变）

