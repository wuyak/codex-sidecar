# 技术设计: RolloutWatcher follow 控制逻辑解耦（Phase19）

## 技术方案
### 核心技术
- Python 标准库（pathlib）

### 实现要点
- 新增 `codex_sidecar/watch/follow_control_helpers.py`：
  - `resolve_pinned_rollout_file()`：复用原 set_follow 的路径归一化与 sessions_root 约束，必要时回退到 thread_id 查找
  - `clean_exclude_keys()`：按 max_items/max_len 清洗
  - `clean_exclude_files()`：按 sessions_root + rollout 文件名校验清洗
- `rollout_watcher.py`：
  - set_follow/set_follow_excludes 调用 helper 并仅在锁内写入状态
- 单测：
  - 覆盖绝对/相对路径、越界路径、fallback、截断与过滤规则

## 测试与部署
- **测试:** `python3 -m unittest discover -s tests`
- **部署:** 无额外步骤；内部重构
