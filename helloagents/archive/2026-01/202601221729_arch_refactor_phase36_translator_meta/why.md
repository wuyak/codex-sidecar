# 变更提案: translator 元信息解析抽离（Phase36）

## 需求背景
`codex_sidecar/controller_core.py` 内有两段与 controller 无关的纯逻辑：
- `_translator_error(tr)`：从 translator.last_error 取出可展示错误（去掉 WARN 前缀）
- `_translator_model(tr, provider_fallback)`：用于 status/translate endpoints 展示 model（优先 resolved_model）

这些逻辑属于 translator 控制面公共能力，放在 controller_core 会：
- 增加 controller_core 体积
- 造成未来其它模块复用困难

## 变更内容
1. 新增 `codex_sidecar/control/translator_meta.py`：
   - `translator_error(tr)` / `translator_model(tr, provider_fallback)`
2. controller_core 改为直接引用 helper（行为保持不变）
3. 新增单测覆盖 WARN 前缀剥离与 model fallback 规则

## 影响范围
- **模块:** control / controller
- **文件:**
  - `codex_sidecar/control/translator_meta.py`（新增）
  - `codex_sidecar/controller_core.py`
  - `tests/test_translator_meta.py`（新增）
- **API:** 无（内部重构）
- **数据:** 无

## 风险评估
- **风险:** translate/status 的 error/model 字段展示差异
- **缓解:** helper 与原逻辑等价 + 单测覆盖 + 全量测试回归

