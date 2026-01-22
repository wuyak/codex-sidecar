# 变更提案: RolloutWatcher follow 控制逻辑解耦（Phase19）

## 需求背景
`codex_sidecar/watch/rollout_watcher.py` 内的以下逻辑偏“纯规则/纯函数”，但目前内联在 watcher 类方法中：
- pin 模式下的 rollout 文件解析与校验（路径归一化 + sessions_root 约束）
- “关闭监听” excludes 的 keys/files 清洗与约束（长度/数量限制 + 路径校验）

这些逻辑：
- 与 IO/poll/状态机无关
- 适合抽离后单测覆盖
- 能显著降低 `rollout_watcher.py` 的方法复杂度与耦合

## 变更内容
在不改变行为的前提下：
1. 抽离 pin 文件解析与 excludes 清洗到 `watch/follow_control_helpers.py`
2. `RolloutWatcher.set_follow()` 与 `set_follow_excludes()` 仅保留锁内状态更新
3. 新增单测覆盖路径校验、sessions_root 约束、fallback 行为与边界限制

## 影响范围
- **模块:** watch
- **文件:** `codex_sidecar/watch/rollout_watcher.py`（重构）、新增 `codex_sidecar/watch/follow_control_helpers.py`、新增 tests
- **API:** 无变更
- **数据:** 无变更

## 核心场景
### 需求: pin 仅允许 sessions 内 rollout 文件
**模块:** watch
UI 传入 file path 时必须限制在 `CODEX_HOME/sessions/**/rollout-*.jsonl` 内，避免越权读取。

#### 场景: 传入绝对路径但不在 sessions_root
- 预期结果：忽略 file 参数；若 thread_id 存在则回退到 thread_id 解析

### 需求: 关闭监听 excludes 要有上限
**模块:** watch
避免不受信任的 UI 输入导致 keys/files 无限增长。

#### 场景: keys/files 数量过大或值超长
- 预期结果：按上限截断并进行裁剪

## 风险评估
- **风险:** 抽离时改变了 path resolve/relative_to 行为，造成 pin/excludes 行为变化
- **缓解:** helper 逐行保持与原实现一致；新增单测覆盖关键分支
