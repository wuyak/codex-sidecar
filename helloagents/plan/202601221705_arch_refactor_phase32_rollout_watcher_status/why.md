# 变更提案: RolloutWatcher.status payload 抽离（Phase32）

## 需求背景
`codex_sidecar/watch/rollout_watcher.py` 的 `RolloutWatcher.status()` 负责组装面向 UI 的状态字典，包含：
- primary 会话文件与 offset/line_no
- follow/进程定位调试信息（pid、process_file 等）
- translate 队列状态（best-effort）

该方法属于“数据展示/序列化”关注点，与 watcher 的核心调度逻辑不同。继续内联会导致：
- `rollout_watcher.py` 持续膨胀
- status 结构难以独立测试/回归（UI 依赖字段名与 shape）

## 变更内容
1. 新增 `codex_sidecar/watch/rollout_watcher_status.py`：
   - 提供 `build_watcher_status(...)` 仅负责字段组装与类型归一化
2. `RolloutWatcher.status()` 保留对内部状态（锁/游标）的读取，随后调用 helper
3. 新增单测覆盖 payload 字段结构与关键格式化（行为保持不变）

## 影响范围
- **模块:** watch
- **文件:**
  - `codex_sidecar/watch/rollout_watcher_status.py`（新增）
  - `codex_sidecar/watch/rollout_watcher.py`
  - `tests/test_rollout_watcher_status.py`（新增）
- **API:** 无（内部重构）
- **数据:** 无

## 风险评估
- **风险:** status 字段缺失/类型变化导致 UI 状态展示异常
- **缓解:** helper 保持与现有字段完全一致 + 单测覆盖关键字段 + 全量测试回归

