# 变更提案: RolloutWatcher run loop 同步调度逻辑解耦（Phase34）

## 需求背景
`codex_sidecar/watch/rollout_watcher.py` 的 `RolloutWatcher.run()` 内包含“何时触发 follow targets 同步”的判断：
- UI 触发 follow_dirty 时应立即强制同步（force=True）
- 否则按 scan cadence（file_scan_interval_s）周期性同步（force=False）

该判断属于纯逻辑，不应与 IO/线程循环混在一起。抽离后收益：
- run loop 更直观，减少未来微调引入回归的概率
- 逻辑可独立单测（不依赖真实线程/文件）

## 变更内容
1. 扩展 `codex_sidecar/watch/rollout_watcher_loop.py` 新增同步决策 helper
2. `RolloutWatcher.run()` 调用 helper 决定是否执行 `_sync_follow_targets`
3. 补充单测覆盖（与现状等价）

## 影响范围
- **模块:** watch
- **文件:**
  - `codex_sidecar/watch/rollout_watcher_loop.py`
  - `codex_sidecar/watch/rollout_watcher.py`
  - `tests/test_rollout_watcher_loop.py`
- **API:** 无（内部重构）
- **数据:** 无

## 风险评估
- **风险:** 同步触发条件变化导致新会话发现延迟/漏发现
- **缓解:** helper 保持与现有逻辑等价 + 单测覆盖 + 全量测试回归

