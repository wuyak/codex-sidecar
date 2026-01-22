# 技术设计: TranslationPump 批处理逻辑解耦（Phase18）

## 技术方案
### 核心技术
- Python 标准库（queue/deque）

### 实现要点
- 新增 `codex_sidecar/watch/translation_pump_batching.py`：
  - `collect_batch_from_lo(first_item, lo_queue, pending, batch_size) -> List[Dict[str, Any]]`
  - 行为保持与旧逻辑一致：仅当 first_item 为 batchable 且 key 非空时才从 lo_queue 聚合；不同 key 或不可 batch 的条目放回 pending
- `translation_pump_core.py`：
  - `_worker()` 使用 helper 替换内联 while 循环
- 单测：
  - 用 `queue.Queue` 构造 lo_queue，验证聚合与 pending 回退

## 测试与部署
- **测试:** `python3 -m unittest discover -s tests`
- **部署:** 无额外步骤；仅内部重构
