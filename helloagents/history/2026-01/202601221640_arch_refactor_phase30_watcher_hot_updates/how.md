# 技术设计: watcher 热更新逻辑解耦（Phase30）

## 技术方案
- 新增 `codex_sidecar/control/watcher_hot_updates.py`
  - `apply_watcher_hot_updates(...)`：接收 watcher/running/cfg/前后状态与 translator 构建器，按既有规则调用 watcher 的热更新方法
  - 函数内部保持“best-effort + 多段 try/except”结构，确保单点失败不影响其它热更新项（与现状一致）
- controller_core:
  - 保留 `_apply_watcher_hot_updates()` 入口，内部只做状态读取与 helper 调用，减少 controller_core 的耦合与体积

## 测试与部署
- **测试:** 新增 `tests/test_watcher_hot_updates.py`
  - 通过 FakeWatcher 记录调用，验证触发条件与调用次数
- **部署:** 无（结构性重构，行为保持不变）

