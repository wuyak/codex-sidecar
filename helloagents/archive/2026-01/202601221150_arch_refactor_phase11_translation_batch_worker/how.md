# 技术设计: TranslationPump 批量翻译执行解耦（Phase 11）

## 技术方案

### 核心技术
- Python 3.8
- “pump（调度） + batch_worker（执行）”分层

### 实现要点
- 新增 `codex_sidecar/watch/translation_batch_worker.py`
  - 通过回调注入（emit/done/translate_one/normalize_err/stop_requested）保持可测试与低耦合
  - 完整承载批量翻译执行路径：pack → translate → unpack → per-item 回退 → emit/done
- `translation_pump_core.TranslationPump._worker()` 仅保留：
  - 队列取 item + batch 组装
  - 单条翻译路径（含 fallback_zh）
  - 统计字段更新（done_batches/last_batch_n/latency 等）

## 安全与性能
- **安全:** 不新增外部请求点；批量失败依旧不做逐条回退（避免请求风暴）
- **性能:** 逻辑拆分不改变复杂度；便于后续对 batch 策略做更细粒度调优

## 测试与部署
- **测试:** 新增 batch_worker 单测；跑全量 `unittest` + `compileall`
- **部署:** 无（内部重构）
