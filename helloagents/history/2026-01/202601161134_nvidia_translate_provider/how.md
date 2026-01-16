# 技术设计: NVIDIA 翻译引擎接入（NIM Chat Completions）

## 技术方案
### 核心技术
- Python `urllib.request` 调用 NVIDIA `POST /chat/completions`（OpenAI Chat Completions 兼容）
- UI 纯静态（无构建）新增配置输入框

### 实现要点
- 新增 `NvidiaChatTranslator`：
  - 端点：`{base_url}/chat/completions`（base_url 允许传到 `/v1` 或完整路径）
  - 鉴权：`Authorization: Bearer <token>`；优先从 `auth_env` 读取（默认 `NVIDIA_API_KEY`）
  - Prompt：
    - 普通单条：使用“翻译成简体中文 + 保留代码/标识符”指令（放在 user 内容，减少对 system 依赖）
    - 批量：检测 `<<<SIDECAR_TRANSLATE_BATCH_V1>>>`，不二次包裹，避免 marker 被改写导致解包失败
  - 限流：按 `rpm` 计算最小间隔（`60/rpm`），全局串行节流
  - 429 重试：优先 `Retry-After`，否则指数退避（带上限）
- 控制面：
  - `translator_specs` 增加 `nvidia` 选项
  - `translator_build` 支持 `translator_provider=nvidia`，读取 `translator_config.nvidia`
- UI：
  - 增加 NVIDIA 配置区块 `nvidiaBlock`
  - 保存/加载时写入/读取 `translator_config.nvidia`

## 安全与性能
- **安全:** UI/日志不回显 token；建议仅用环境变量保存密钥
- **性能:** 维持翻译“异步回填”架构不变；导入期批量仍按会话 key 聚合，实时请求保持单条优先

## 测试与部署
- **测试:** `python3 -m py_compile`；`node --check`（相关 UI 模块）
- **部署:** 无额外依赖；重启 sidecar 生效

