# 变更提案: TranslationPump 队列/去重解耦（Phase 7）

## 需求背景
`codex_sidecar/watch/translation_pump_core.py` 负责后台翻译队列的调度与回填。当前实现已较稳定，但内部同时承担：
- 两级队列（hi/lo）背压与丢弃策略
- message id 的去重与 in-flight 防抖
- manual force 重译的“合并一次后续执行”逻辑（force_after）

这些属于“队列与状态机”范畴，若继续演进（例如更多优先级、更多统计指标）会进一步放大单文件复杂度，也不利于单元测试覆盖。

本轮目标是在**不改动对外行为**的前提下，把“队列/去重/inflight/force_after”抽为独立模块，提高可测试性与可维护性。

## 变更内容
1. 新增 `codex_sidecar/watch/translation_queue.py`：封装去重/inflight/force_after 与 drop-oldest 入队策略。
2. `translation_pump_core.py` 使用新模块，保留现有 public API 与统计字段含义。
3. 新增单测覆盖关键队列行为（去重、force 合并、背压丢弃的 inflight 清理）。

## 影响范围
- **模块:** `codex_sidecar/watch/*`
- **API:** 无（保持兼容）
- **数据:** 无

## 风险评估
- **风险:** 队列行为细节改变会影响“翻译是否入队/何时重试”。
- **缓解:** 保持逻辑等价；新增单测覆盖；完整跑现有测试套件。

