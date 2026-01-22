# 技术设计: Controller retranslate 逻辑解耦（Phase27）

## 技术方案
- 新增 `codex_sidecar/control/retranslate_api.py`：
  - `retranslate_one(state, watcher, running, mid)`：返回与现有 controller.retranslate 相同的 dict shape
- controller_core:
  - 保持锁策略：在锁内读取 watcher/running，锁外执行 helper（避免扩大锁持有范围）

## 测试与部署
- **测试:** 新增 `tests/test_controller_retranslate.py` 覆盖关键返回分支
- **部署:** 无（结构性重构，行为不变）

