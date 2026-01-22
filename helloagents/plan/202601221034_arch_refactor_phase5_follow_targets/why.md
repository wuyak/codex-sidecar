# 变更提案: Watch Follow 目标计算解耦（Phase 5）

## 需求背景
`codex_sidecar/watch/rollout_watcher.py` 仍然是当前后端最大文件，核心原因之一是 `_sync_follow_targets()` 同时承担：
- 读取 UI runtime follow 配置（auto/pin、排除列表）
- 调用 `FollowPicker` 获取 picked/process-files 等
- 计算最终应跟随的 targets（包含多分支策略）
- 同步 cursor/offset/replay 等运行态

其中“**targets 计算**”是相对纯粹、可独立测试的逻辑，但目前与 watcher 状态强耦合，后续调整容易引入回归。

本轮目标：在**不改动对外行为**的前提下，把“follow targets 计算”抽离为独立模块与可单测函数，让 watcher 更聚焦于调度与状态同步。

## 变更内容
1. 新增 `codex_sidecar/watch/follow_targets.py`：封装 `is_excluded()` 与 `compute_follow_targets()`。
2. `RolloutWatcher._sync_follow_targets()` 改为调用 `compute_follow_targets()`，减少内联分支与耦合。
3. 新增最小单测覆盖 targets 计算的关键分支（process/pin/auto + excludes）。

## 影响范围
- **模块:** `codex_sidecar/watch/*`
- **API:** 无（保持兼容）
- **数据:** 无

## 风险评估
- **风险:** targets 计算属于核心行为，抽离时可能发生顺序/排除规则/回退策略偏差。
- **缓解:** 严格保持逻辑等价；增加单测覆盖；完整跑现有测试套件。

