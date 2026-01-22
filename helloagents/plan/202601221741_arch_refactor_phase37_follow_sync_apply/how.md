# 技术设计: follow sync plan 应用逻辑解耦（Phase37）

## 技术方案
- 在 `rollout_follow_state.py` 新增：
  - `FollowApplyResult`（dataclass）
  - `apply_follow_sync_targets(...) -> Optional[FollowApplyResult]`
    - idle 时仅在 `force or prev_follow_files` 时清空并 deactivate cursors
    - 非 idle 时仅在 `force or targets!=prev_follow_files` 时调用 `apply_follow_targets`
- `rollout_watcher.py`：
  - `_sync_follow_targets()` 中 targets 应用部分改为调用 helper，减少内联分支

## 测试与部署
- **测试:** 在 `tests/test_rollout_follow_state.py` 补充 idle/diff 分支覆盖（使用轻量 cursor stub）
- **部署:** 无

