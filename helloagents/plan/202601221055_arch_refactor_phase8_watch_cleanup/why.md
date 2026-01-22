# 变更提案: Watcher 清理遗留死代码（Phase 8）

## 需求背景
在 watch 模块的分层拆分过程中，`rollout_watcher.py` 内曾经的 `_replay_tail/_handle_line` 等逻辑被迁移到独立模块（`rollout_tailer.py`、`rollout_ingest.py`）。目前文件里残留了一个未再使用的 `_replay_tail()` 方法，并且其内部调用了已不存在的 `_handle_line()`。

虽然该方法当前不会被调用，但属于“潜在炸点”：
- 未来若误用/回滚某段逻辑，可能触发运行时报错
- 影响代码可读性与维护信心（不清楚哪些路径仍有效）

本轮目标：在不改动任何对外行为的前提下，清理这类遗留死代码，保持 watch 主链路更干净。

## 变更内容
1. 删除 `codex_sidecar/watch/rollout_watcher.py` 中未使用且已失效的 `_replay_tail()`。
2. 保持现有 replay 行为继续由 `rollout_tailer.replay_tail()` 承担，不改变功能。

## 风险评估
- **风险:** 极低（删除未引用方法）。
- **缓解:** 跑单测与 `compileall` 验证无回归。

