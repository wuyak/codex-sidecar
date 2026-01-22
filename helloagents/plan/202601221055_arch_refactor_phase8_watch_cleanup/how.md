# 技术设计: Watcher 清理遗留死代码（Phase 8）

## 技术方案
- 直接删除 `RolloutWatcher._replay_tail()`，确保 `rollout_watcher.py` 不再包含调用已移除方法的失效分支。

## 验证
- `python3 -m compileall -q codex_sidecar`
- `python3 -m unittest discover -s tests`

