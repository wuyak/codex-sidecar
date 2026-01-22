# 变更提案: RolloutWatcher 的 TUI 轮询节流逻辑解耦（Phase28）

## 需求背景
`codex_sidecar/watch/rollout_watcher.py` 的 `RolloutWatcher.run()` 内包含一段“是否需要轮询 codex-tui.log”的节流判断：
- 当 follow 处于 `idle/wait_codex` 且未检测到 Codex 进程时，按 `file_scan_interval_s` 降频轮询
- 其他情况下，按正常 `poll_interval_s` 轮询

该逻辑与 watcher 的“读会话文件/切换 follow targets”不同关注点，继续内联会导致：
- run loop 代码膨胀、可读性下降
- 节流条件难以独立单测，后续微调容易引入回归

## 变更内容
1. 抽离“是否轮询 TUI”的纯判断为 helper（无 IO、无副作用）
2. `RolloutWatcher.run()` 仅负责读取状态并调用 helper
3. 新增单测覆盖主要分支（idle 降频 / 非 idle 正常轮询 / codex_detected 覆盖）

## 影响范围
- **模块:** watch
- **文件:**
  - `codex_sidecar/watch/rollout_watcher.py`
  - `codex_sidecar/watch/rollout_watcher_loop.py`（新增）
  - `tests/test_rollout_watcher_loop.py`（新增）
- **API:** 无（内部重构）
- **数据:** 无

## 风险评估
- **风险:** 节流判断条件变化导致 TUI 状态刷新频率异常
- **缓解:** helper 保持与现有逻辑等价 + 单测覆盖关键分支 + 全量测试回归

