# 技术设计: translator 元信息解析抽离（Phase36）

## 技术方案
- 新增 `control/translator_meta.py`
  - 保持原字段解析顺序与 fallback：
    - error: `WARN:` 前缀剥离
    - model: `_resolved_model` → `model` → provider_fallback
- controller_core：
  - 移除 `_translator_error/_translator_model` 方法
  - translate_api 调用处改为传入纯函数 helper

## 测试与部署
- **测试:** 新增 `tests/test_translator_meta.py`
- **部署:** 无

