# 变更提案: Controller Watcher 构建解耦（Phase 6）

## 需求背景
`codex_sidecar/controller_core.py` 作为控制面聚合点，既要负责配置读写/热更新，又要负责 watcher 线程生命周期与 watcher 实例创建。当前 `start()` 中包含 watcher 构建与 runtime follow 状态注入逻辑，属于可独立复用的“组装代码”，但与 controller 锁/状态混在一起会：
- 增加 controller_core 的耦合与体积
- 让后续 watcher 参数演进更难测试（只能通过 controller 端到端路径）

本轮目标是在**不改动对外行为**的前提下，抽离 watcher 组装逻辑到 `control/*`，让 controller 只负责线程/锁/状态管理。

## 变更内容
1. 新增 `codex_sidecar/control/watcher_factory.py`：封装 RolloutWatcher + HttpIngestClient 的构建与 runtime follow 注入。
2. `controller_core.start()` 使用 factory 创建 watcher（逻辑等价）。
3. 保持现有测试与运行行为不变。

## 影响范围
- **模块:** `codex_sidecar/controller_core.py`、`codex_sidecar/control/*`
- **API:** 无（保持兼容）
- **数据:** 无

## 风险评估
- **风险:** 构造参数迁移时遗漏某个配置字段导致行为变化。
- **缓解:** 采用机械迁移（参数逐项对照）；跑单测与 `compileall`；必要时补最小回归测试（关注 watcher 参数透传）。

