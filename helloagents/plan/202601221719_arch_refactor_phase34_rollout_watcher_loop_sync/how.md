# 技术设计: RolloutWatcher run loop 同步调度逻辑解耦（Phase34）

## 技术方案
- 在 `rollout_watcher_loop.py` 新增：
  - `decide_follow_sync_force(force_switch, now_ts, last_scan_ts, file_scan_interval_s) -> Optional[bool]`
    - 返回 `True`：立即同步（force=True）
    - 返回 `False`：周期性同步（force=False）
    - 返回 `None`：本 tick 不同步
- `RolloutWatcher.run()`：
  - 保持 follow_dirty 的消费语义不变（只消费一次）
  - 根据 helper 返回值决定是否调用 `_sync_follow_targets` 并更新 `self._last_file_scan_ts`

## 测试与部署
- **测试:** 复用/扩展现有 `tests/test_rollout_watcher_loop.py`
- **部署:** 无

