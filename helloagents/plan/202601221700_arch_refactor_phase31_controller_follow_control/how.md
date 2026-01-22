# 技术设计: Controller follow 控制逻辑解耦（Phase31）

## 技术方案
- 新增 `codex_sidecar/control/follow_control_api.py`
  - `normalize_follow_mode()`：仅允许 `auto|pin`，其余回退 `auto`
  - `normalize_follow_fields()`：trim thread_id/file
  - `clean_exclude_keys_like()`：复用“去空/trim/限长/限量”语义（与现状一致）
  - `apply_follow_to_watcher()`：best-effort 调用 watcher.set_follow
  - `apply_follow_excludes_to_watcher()`：best-effort 调用 watcher.set_follow_excludes
- controller_core：
  - `set_follow()`：锁内更新字段，锁外用 helper 应用到 watcher
  - `set_follow_excludes()`：清洗逻辑迁移到 helper，锁策略保持不变

## 测试与部署
- **测试:** 新增 2 个测试文件：
  - `tests/test_control_follow_control.py`：覆盖 helper 的归一化与 apply 行为
  - `tests/test_controller_follow.py`：覆盖 controller set_follow 对 watcher 的调用
- **部署:** 无

