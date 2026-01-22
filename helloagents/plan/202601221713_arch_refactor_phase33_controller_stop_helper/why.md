# 变更提案: controller.stop 线程停止逻辑解耦（Phase33）

## 需求背景
`codex_sidecar/controller_core.py` 的 `SidecarController.stop()` 负责：
- 设置 stop_event
- join watcher 线程（带超时）
- 根据线程是否退出决定是否清理引用/设置 stop_timeout 错误

该逻辑属于通用的“线程生命周期控制”，与 controller 的业务方法无关。继续内联会导致：
- controller_core 体积与复杂度增加
- stop 超时行为难以独立单测

## 变更内容
1. 新增 `codex_sidecar/control/watcher_lifecycle.py`：
   - 抽离 `request_stop_and_join()`：设置 event + join + 返回 still_running
2. controller_core.stop() 复用 helper（行为保持不变）
3. 新增单测覆盖“立即退出/超时仍在运行”分支

## 影响范围
- **模块:** control / controller
- **文件:**
  - `codex_sidecar/control/watcher_lifecycle.py`（新增）
  - `codex_sidecar/controller_core.py`
  - `tests/test_control_watcher_lifecycle.py`（新增）
- **API:** 无（内部重构）
- **数据:** 无

## 风险评估
- **风险:** stop_timeout 判断条件变化导致 UI 状态异常
- **缓解:** helper 与原逻辑等价 + 单测覆盖 + 全量测试回归

