# 变更提案: Controller retranslate 逻辑解耦（Phase27）

## 需求背景
`SidecarController.retranslate()` 当前在 `controller_core.py` 内直接实现了：
- 从 `SidecarState` 读取 message 并校验 kind/text
- 组装 thread_key、调用 watcher.retranslate 入队
- 回写 state 清理 translate_error

这段逻辑与 controller 的“线程/锁/生命周期管理”是不同关注点，继续内联会导致：
- controller_core 体积膨胀
- 逻辑难以独立单测（目前缺少 retranslate 覆盖）

## 变更内容
1. 抽离 retranslate 纯逻辑到 `codex_sidecar/control/retranslate_api.py`
2. controller_core 仅负责拿到 state/watcher/running，再调用 helper（行为保持不变）
3. 新增单测覆盖 retranslate 的关键分支（not_running/not_found/not_thinking/queued/failed）

## 影响范围
- **模块:** control
- **文件:**
  - `codex_sidecar/control/retranslate_api.py`
  - `codex_sidecar/controller_core.py`
  - `tests/test_controller_retranslate.py`
- **API:** 无
- **数据:** 无

## 风险评估
- **风险:** 抽离后对 state/watcher 的调用顺序变化
- **缓解:** 单测覆盖 + 全量测试回归，确保返回 payload 与状态更新保持一致

