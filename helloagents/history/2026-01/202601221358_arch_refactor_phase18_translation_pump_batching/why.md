# 变更提案: TranslationPump 批处理逻辑解耦（Phase18）

## 需求背景
`codex_sidecar/watch/translation_pump_core.py` 的 `_worker()` 仍包含较多“从队列拼 batch / 不同 key 回退到 pending / 构造 pairs”等细节逻辑。

这些逻辑本质上是可复用、可单测的“批处理组包”规则，但当前被内联在 worker 循环里：
- 可读性较差，未来改动更容易引入回归
- 单测难以覆盖关键边界（不同 key 的回退、空文本过滤、batch_size 上限）

## 变更内容
在不改变翻译队列行为的前提下：
1. 抽离“从 lo 队列聚合 batch”的逻辑到独立模块（纯函数/小函数）
2. `TranslationPump._worker()` 调用新模块，减少内联分支与重复代码
3. 新增单测覆盖 batch 聚合与 pending 回退的关键分支

## 影响范围
- **模块:** watch
- **文件:** `codex_sidecar/watch/translation_pump_core.py`（重构）、新增 helper 模块、新增 tests
- **API:** 无变更
- **数据:** 无变更

## 核心场景
### 需求: 导入回放批量翻译不串会话
**模块:** watch
同一 thread_key 内最多批量翻译 N 条；不同 key 的条目应被回退到 pending，避免跨会话串流。

#### 场景: lo 队列混入不同 key
- 预期结果：不同 key 的条目被放回 pending，并在后续循环继续处理

## 风险评估
- **风险:** 抽离时改变了队列消费顺序/回退策略
- **缓解:** 保持函数签名与原实现等价；新增单测覆盖“不同 key 回退”与“batch_size 截断”
