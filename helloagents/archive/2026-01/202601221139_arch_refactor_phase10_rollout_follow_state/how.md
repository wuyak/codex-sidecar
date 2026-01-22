# 技术设计: RolloutWatcher 跟随状态分层（Phase 10）

## 技术方案

### 核心技术
- Python 3.8
- “watcher（调度） + follow_state（落地）”分层

### 实现要点
- 新增 `codex_sidecar/watch/rollout_follow_state.py`
  - 承载将 `targets: list[Path]` 落地到 `cursors` 的逻辑：active 标记、cursor 初始化、replay 调用、primary 派生
  - 以“就地更新（in-place）”方式工作，减少对象复制与分叉
- `rollout_watcher._sync_follow_targets()` 保留：
  - follow picker 的调用与 process 信息回写
  - “idle/wait”模式下的清空策略
  - stderr debug 输出（仍由 watcher 负责）

## 安全与性能
- **安全:** 不新增外部 IO；仅复用现有 `Path.stat()` 与 tail 逻辑
- **性能:** 拆分不改变复杂度；减少 watcher 单文件复杂度，便于后续优化

## 测试与部署
- **测试:** 新增 follow_state 单测；跑现有 `unittest` 与 `compileall`
- **部署:** 无（内部重构）
