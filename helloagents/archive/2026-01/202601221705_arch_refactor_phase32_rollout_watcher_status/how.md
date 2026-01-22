# 技术设计: RolloutWatcher.status payload 抽离（Phase32）

## 技术方案
- 新增 `codex_sidecar/watch/rollout_watcher_status.py`
  - `build_watcher_status(...) -> Dict[str, object]`
  - 输入为已读取的原始状态（Path/list/数值/bool 等），函数内部只做：
    - `str()` 化与列表截断（与现状一致）
    - translate stats 的 best-effort 合并
- `RolloutWatcher.status()`：
  - 继续在方法内部完成：
    - selection/pin 的锁内读取
    - primary offset/line_no 从 cursor 读取
  - 然后调用 helper 返回 dict

## 测试与部署
- **测试:** 新增 `tests/test_rollout_watcher_status.py` 校验字段/截断规则
- **部署:** 无

