# 技术设计: NVIDIA 翻译模块分层重构（Phase 9）

## 技术方案

### 核心技术
- Python 3.8
- 以“facade（保持原入口）+ helpers（纯逻辑）”方式拆分模块

### 实现要点
- 新增 `codex_sidecar/translators/nvidia_chat_helpers.py`，承载与网络请求无关的辅助逻辑（解析/门禁/启发式等）
- `codex_sidecar/translators/nvidia_chat_core.py` 保持 `NvidiaChatTranslator` 的对外实现入口不变，仅将内部调用切换为 helpers
- 关键策略：不改变任何常量值、提示词文本、回退判断条件与日志文案（仅移动与复用）

## 安全与性能
- **安全:** helpers 内不引入新的敏感信息输出；错误详情抽取保持“尽量不泄漏 secrets”的现有约束
- **性能:** 拆分仅影响 import 结构；运行时逻辑保持一致

## 测试与部署
- **测试:** 新增单测覆盖 helpers 中关键纯函数；跑现有 `unittest` 套件与 `compileall`
- **部署:** 无（本次为内部重构）
