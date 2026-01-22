# 技术设计: TranslationPump 单条翻译/错误归一化逻辑抽离（Phase35）

## 技术方案
- 新增 `translation_pump_translate.py`：
  - 保持与旧实现完全一致的语义：
    - 翻译失败不把告警写进 `zh`
    - 异常返回 `翻译异常：<ExcName>`
    - WARN 前缀去除、空错误回退、最长 240 字符截断并补 `…`
- `translation_pump_core.py`：
  - `_translate_one`/`_normalize_err` 退化为 wrapper 或直接移除
  - 调用 `emit_translate_batch` 时改用闭包 `lambda` 绑定 translator

## 测试与部署
- **测试:** 新增 `tests/test_translation_pump_translate.py`
- **部署:** 无

