# 技术设计: RolloutWatcher 的 TUI 轮询节流逻辑解耦（Phase28）

## 技术方案
- 新增 `codex_sidecar/watch/rollout_watcher_loop.py`
  - `should_poll_tui(follow_mode, codex_detected, now_ts, last_poll_ts, file_scan_interval_s) -> bool`
  - 只做“节流决策”，不读文件、不访问全局时间，便于单测
- `RolloutWatcher.run()`：
  - 仍然在 run loop 内维护 `self._last_tui_poll_ts`
  - 仅将当前状态（follow_mode/codex_detected/last_ts/now/scan_interval）传给 helper

## 测试与部署
- **测试:** 新增 `tests/test_rollout_watcher_loop.py` 覆盖节流分支
- **部署:** 无（结构性重构，行为不变）

