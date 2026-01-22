# 技术设计: TranslationPump 队列/去重解耦（Phase 7）

## 技术方案
- 抽出一个小的状态管理类 `TranslationQueueState`：
  - 管理 `_seen/_seen_order/_inflight/_force_after`
  - 提供 `mark_seen_if_needed()`、`mark_inflight()`、`done_id()`、`queue_force_after()` 等方法
- 抽出 `put_drop_oldest(queue, item, ...)` 的通用策略到该模块或保持在 pump 中（以最小变更为准）。

## 测试
- 新增 `tests/test_translation_pump_queue.py`：
  - 普通 enqueue 去重（同 id 第二次应拒绝）
  - force 在 inflight 时不直接入队，但会记录 follow-up
  - done_id 后 follow-up 会重新入队（并重新标记 inflight）
  - 队列满时 drop-oldest 会正确清理 inflight

## 验证
- `python3 -m compileall -q codex_sidecar`
- `python3 -m unittest discover -s tests`

