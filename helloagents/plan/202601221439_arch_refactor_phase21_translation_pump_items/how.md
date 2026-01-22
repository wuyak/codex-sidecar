# 技术设计: TranslationPump item 解析逻辑解耦（Phase21）

## 技术方案

### 核心技术
- Python 3.8
- 以“纯函数 helper + 单测”方式从 worker 中抽离数据处理逻辑

### 实现要点
- 新增 `codex_sidecar/watch/translation_pump_items.py`
  - `collect_pairs(batch)`：从 batch items 提取可翻译 pairs（`(id, text)`）
  - `collect_ids(batch)`：从 batch items 提取可用于清理 inflight 的 ids
- `translation_pump_core.py`
  - 使用 `collect_pairs/collect_ids` 替换内联循环
  - 移除未使用的中间集合变量，降低 worker 内部噪音（行为保持不变）

## 安全与性能
- **安全:** 不涉及外部 IO/网络；仅调整内存内数据处理
- **性能:** helper 为 O(n) 扫描，等价于原实现；并避免无用集合构造

## 测试与部署
- **测试:** 新增 `tests/test_translation_pump_items.py` 覆盖过滤规则
- **部署:** 无（结构性重构，行为不变）

