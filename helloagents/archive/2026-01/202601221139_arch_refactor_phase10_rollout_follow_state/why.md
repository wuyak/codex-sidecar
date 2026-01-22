# 变更提案: RolloutWatcher 跟随状态分层（Phase 10）

## 需求背景
`codex_sidecar/watch/rollout_watcher.py` 仍然同时承担“跟随目标选择结果落地（cursor 初始化/active 标记/primary 更新）”与“调度循环”等职责，导致单文件偏大、核心逻辑阅读成本高，并且不易做定向单测。

## 变更内容
1. 抽离“follow targets 落地/游标初始化/primary 状态派生”的逻辑到独立模块（纯逻辑 + 少量文件元信息读取）
2. 保持行为不变：跟随文件选择顺序、offset/line_no 更新、replay 行为、stderr debug 输出格式保持一致
3. 增补单元测试覆盖抽离模块的关键语义（新 cursor 初始化、重复调用不重放、primary 派生）

## 影响范围
- **模块:** watch（rollout watcher 跟随状态管理）
- **文件:**
  - `codex_sidecar/watch/rollout_watcher.py`
  - `codex_sidecar/watch/rollout_follow_state.py`（新增）
  - `tests/test_rollout_follow_state.py`（新增）
  - `helloagents/modules/rollout_sidecar.md`
  - `helloagents/CHANGELOG.md`

## 核心场景

### 需求: 降低耦合但不改行为
**模块:** watch
在不改变 follow 策略输出与文件 tail 行为的前提下，把“targets→cursors/primary”的落地过程独立出来，便于复用与测试。

#### 场景: 新会话文件首次加入 follow 列表
- 预期结果：新 cursor 标记 `inited=True`，offset seek 到文件末尾；如配置 `replay_last_lines>0` 则回放最后 N 行
- 预期结果：primary 的 offset/line_no 与历史行为一致

#### 场景: targets 未变化/重复调用
- 预期结果：不重复 replay；cursor 的 offset/line_no 不被重置

## 风险评估
- **风险:** 抽离函数参数遗漏导致行为微变（例如 line_no/offset 的更新时序）
- **缓解:** 仅移动代码并保持调用顺序；补单测覆盖关键分支；运行 `compileall` + 全量 `unittest`
