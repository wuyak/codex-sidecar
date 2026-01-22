# 变更提案: Controller follow_excludes 清洗复用（Phase24）

## 需求背景
目前 follow_excludes 的输入清洗逻辑存在重复：
- `SidecarController.set_follow_excludes()` 内部手写清洗（截断/去空/限量）
- `RolloutWatcher.set_follow_excludes()` 已在 watcher 侧再次进行更严格的清洗与路径约束

重复实现的风险：
- 两侧清洗规则可能逐步分叉，导致 UI “关闭监听”状态难以预测
- controller_core 体积增大、职责边界不清晰

## 变更内容
1. controller 侧 follow_excludes 清洗复用 `watch/follow_control_helpers.clean_exclude_keys`
2. 新增单测覆盖 controller 的 keys/files 清洗与截断规则

## 影响范围
- **模块:** control/watch
- **文件:**
  - `codex_sidecar/controller_core.py`
  - `tests/test_controller_follow_excludes.py`
- **API:** 无
- **数据:** 无

## 核心场景

### 需求: “关闭监听”输入清洗一致性
**模块:** control/watch
保持现有语义：
- 去空/去空白
- keys 截断到 256
- files 截断到 2048
- 最大项数 1000

## 风险评估
- **风险:** 清洗细节变化导致 UI excludes 列表排序/内容差异
- **缓解:** 单测覆盖截断/去空规则，并运行全量测试集回归

