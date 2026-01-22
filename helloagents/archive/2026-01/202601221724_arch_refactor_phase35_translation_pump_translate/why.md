# 变更提案: TranslationPump 单条翻译/错误归一化逻辑抽离（Phase35）

## 需求背景
`codex_sidecar/watch/translation_pump_core.py` 内包含两段纯逻辑：
- `_translate_one()`：调用 translator.translate 并按约定返回 `(zh, error)`
- `_normalize_err()`：从 translator.last_error 中提取可展示的错误文本，并做截断/回退

这两段逻辑属于可复用的纯函数，不应与队列/线程 worker 混在一起。抽离后收益：
- 降低 `translation_pump_core.py` 体积与复杂度
- 逻辑可被 `translation_batch_worker` 与 TranslationPump 共享/单测覆盖

## 变更内容
1. 新增 `codex_sidecar/watch/translation_pump_translate.py`
   - `normalize_translate_error(translator, fallback) -> str`
   - `translate_one(translator, text) -> (zh, err)`
2. `TranslationPump` 复用 helper；`emit_translate_batch` 的 `translate_one/normalize_err` 也复用 helper（通过闭包绑定 translator）
3. 新增单测覆盖关键分支（异常/空译文/WARN 前缀/截断）

## 影响范围
- **模块:** watch
- **文件:**
  - `codex_sidecar/watch/translation_pump_translate.py`（新增）
  - `codex_sidecar/watch/translation_pump_core.py`
  - `tests/test_translation_pump_translate.py`（新增）
- **API:** 无（内部重构）
- **数据:** 无

## 风险评估
- **风险:** 错误文案/截断规则变化导致 UI 状态展示差异
- **缓解:** helper 与原逻辑等价 + 单测覆盖 + 全量测试回归

