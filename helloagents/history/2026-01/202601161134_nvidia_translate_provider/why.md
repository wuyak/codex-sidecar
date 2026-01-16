# 变更提案: NVIDIA 翻译引擎接入（NIM Chat Completions）

## 需求背景
当前 sidecar 的翻译 Provider 仅支持 `http`（通用适配器）与 `openai`（Responses API 兼容）。为了在“准 + 快 + 保留代码/专有名词”场景下获得更稳定的翻译效果，需要接入 NVIDIA 的 NIM 翻译模型（如 `nvidia/riva-translate-4b-instruct-v1.1`）。

## 变更内容
1. 新增翻译 Provider：`nvidia`（Chat Completions 兼容），默认对接 `https://integrate.api.nvidia.com/v1/chat/completions`。
2. 增加请求节流与 429 重试策略，适配低 RPM（如 40 RPM）场景下的稳定运行。
3. UI 增加 NVIDIA 配置区块（Base URL / Model / Auth ENV / Timeout / RPM）。
4. 更新项目文档与知识库，记录配置方式与边界条件。

## 影响范围
- **模块:** 翻译 Provider、UI 配置面板、控制面 translator 构建
- **文件:** `tools/codex_thinking_sidecar/codex_thinking_sidecar/translators/*`、`control/*`、`ui/*`、`README.md`、`helloagents/wiki/*`、`helloagents/CHANGELOG.md`
- **API:** 无新增外部 API；新增内部 provider 配置结构 `translator_config.nvidia`
- **数据:** 用户本机配置文件新增 `translator_config.nvidia`（不强制写入密钥，推荐 env）

## 核心场景

### 需求: Codex 思考内容翻译（EN→ZH）
**模块:** nvidia-translate

#### 场景: 自动翻译/手动翻译
在自动/手动翻译模式下，NVIDIA Provider 能把思考内容翻译成简体中文，同时尽量保持代码块、路径、标识符不被翻译；批量翻译（导入期聚合）不串会话且可正确解包。

## 风险评估
- **风险:** RPM 限制/429 导致翻译变慢或失败
- **缓解:** 全局节流（min interval）+ 429 退避重试（优先 Retry-After）；失败仅回填 `translate_error`，不污染内容区
