# 变更提案: RolloutWatcher follow 同步逻辑拆分（Phase20）

## 需求背景
当前 `codex_sidecar/watch/rollout_watcher.py` 的 `_sync_follow_targets()` 同时承担了：

1. 读取 follow 控制面状态（auto/pin + excludes）
2. 调用 `FollowPicker` 选择 primary / 进程信息并写回状态
3. 处理 `idle/wait_*` 模式下的早退清理
4. 计算 targets 并落地到 cursors/primary

该方法职责过多，阅读与测试成本高，后续迭代容易把“结构调整”误变成“行为变化”。

## 变更内容
1. 抽离“pick + pin 补齐 + idle 判定 + targets 计算”为纯逻辑模块 `codex_sidecar/watch/rollout_follow_sync.py`
2. `RolloutWatcher._sync_follow_targets()` 仅保留：状态写回、idle 清理、`apply_follow_targets()` 调用

## 影响范围
- **模块:** watch
- **文件:**
  - `codex_sidecar/watch/rollout_follow_sync.py`
  - `codex_sidecar/watch/rollout_watcher.py`
  - `tests/test_rollout_follow_sync.py`
- **API:** 无
- **数据:** 无

## 核心场景

### 需求: follow targets 同步（结构性重构）
**模块:** watch
保持现有行为，仅做代码结构拆分。

#### 场景: 进程未检测到（wait 模式）
- 不计算 targets、不跟随任何文件
- 如之前正在跟随则清空并标记 cursor inactive

#### 场景: pin 仅提供 thread_id（未提供 file）
- 当 pick 得到具体文件后补齐 pinned_file/pinned_thread_id（仅当缺失时）

## 风险评估
- **风险:** 拆分过程中引入细微行为差异
- **缓解:** 新增单测覆盖 idle/ pin 补齐关键分支，并全量运行现有测试集

