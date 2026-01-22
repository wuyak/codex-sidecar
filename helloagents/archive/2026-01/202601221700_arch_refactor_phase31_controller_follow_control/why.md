# 变更提案: Controller follow 控制逻辑解耦（Phase31）

## 需求背景
`codex_sidecar/controller_core.py` 同时承担：
- 线程生命周期管理（start/stop/status）
- 配置 patch 与持久化
- follow 控制面（pin/auto、excludes）运行态状态维护

其中 follow 控制属于“控制面业务逻辑”，与 controller 的锁/线程管理是不同关注点。继续内联会导致：
- controller_core 继续膨胀
- follow 行为难以独立单测（当前更多是间接覆盖）

## 变更内容
1. 新增 `codex_sidecar/control/follow_control_api.py`：
   - 归一化 follow 请求（mode/thread_id/file）
   - 归一化 excludes 输入（keys/files）
   - best-effort 调用 watcher 的 `set_follow` / `set_follow_excludes`
2. controller_core：
   - 保留锁内更新运行态字段（selection/pin/excludes）
   - 锁外调用 helper 将变更应用到 watcher（行为保持不变）
3. 新增单测覆盖 follow 控制 helper 的关键分支与 controller 的调用路径

## 影响范围
- **模块:** control / controller
- **文件:**
  - `codex_sidecar/control/follow_control_api.py`（新增）
  - `codex_sidecar/controller_core.py`
  - `tests/test_control_follow_control.py`（新增）
  - `tests/test_controller_follow.py`（新增）
- **API:** 无（内部重构）
- **数据:** 无

## 风险评估
- **风险:** follow 归一化逻辑变化导致 pin/excludes 不生效
- **缓解:** helper 保持与现有逻辑等价 + 单测覆盖 + 全量测试回归

