# 技术设计: controller.stop 线程停止逻辑解耦（Phase33）

## 技术方案
- 新增 `codex_sidecar/control/watcher_lifecycle.py`
  - `request_stop_and_join(stop_event, thread, join_timeout_s) -> bool`：
    - `stop_event.set()`（如存在）
    - 对存活线程执行 `join(timeout=...)`
    - 返回 `still_running`（bool）
- controller_core.stop()
  - 仍保留“仅在确认线程退出后才清理引用”的策略（避免重复 watcher）
  - stop_timeout 语义与返回 payload 保持不变

## 测试与部署
- **测试:** 新增 `tests/test_control_watcher_lifecycle.py`
- **部署:** 无

