# 变更提案: FollowPicker 进程扫描逻辑解耦（Phase14）

## 需求背景
`codex_sidecar/watch/follow_picker.py` 目前同时承担：
1) Codex 进程强匹配扫描（/proc 全量刷新候选 PID）
2) 进程树收集（PPID→children）
3) 从 `/proc/<pid>/fd` 解析并筛选“正在写入”的 `rollout-*.jsonl`

这使得 follow picker 的职责偏重、单测颗粒度偏粗，后续优化（例如更换进程扫描策略、增强 fd 过滤规则）更容易引入回归。

## 变更内容
在不改变外部行为（选择策略/返回字段/日志语义/默认配置）的前提下：
1. 抽离“进程扫描 + rollout fd 解析”的纯逻辑到独立模块
2. `FollowPicker` 保持对外接口与行为不变，仅作为 orchestration/策略入口
3. 补充单测覆盖新抽离模块的关键分支

## 影响范围
- **模块:** watch
- **文件:** `codex_sidecar/watch/follow_picker.py`（重构）、新增 `codex_sidecar/watch/process_follow_scan.py`、新增/更新 tests
- **API:** 无变更
- **数据:** 无变更

## 核心场景
### 需求: 自动发现新增 Codex 进程
**模块:** watch
强匹配 `/proc/<pid>/exe` basename 与 argv0 basename，按 scan cadence 刷新候选 PID，确保新启动的 Codex CLI 会话能够进入监听范围。

#### 场景: 新开一个 codex 进程
- 预期结果：下一个 scan 周期能发现新 PID 并纳入候选列表（不被缓存冻结）

### 需求: 仅跟随进程正在写入的 rollout 文件
**模块:** watch
从 fd flags 判定写入（WRONLY/RDWR），避免把历史只读打开的 rollout 误当作“当前会话”。

#### 场景: 进程打开历史 rollout 为只读
- 预期结果：不会被纳入 process-follow 的候选目标

## 风险评估
- **风险:** 重构导致分支条件/异常吞掉行为变化，引入 “漏发现/误跟随” 回归
- **缓解:** 保持原函数签名与异常策略一致；新增单测覆盖强匹配与 fd flags 过滤的关键路径
