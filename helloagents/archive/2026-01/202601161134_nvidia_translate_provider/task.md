# 任务清单: NVIDIA 翻译引擎接入（NIM Chat Completions）

目录: `helloagents/plan/202601161134_nvidia_translate_provider/`

---

## 1. 翻译 Provider（NVIDIA）
- [√] 1.1 新增 `NvidiaChatTranslator`（HTTP Chat Completions + 解析返回），验证 why.md#需求-codex-思考内容翻译（en→zh）-场景-自动翻译/手动翻译
- [√] 1.2 增加 RPM 节流 + 429 退避重试（优先 Retry-After），验证 why.md#需求-codex-思考内容翻译（en→zh）-场景-自动翻译/手动翻译
- [√] 1.3 批量翻译兼容：检测 `<<<SIDECAR_TRANSLATE_BATCH_V1>>>` 时不二次包裹，确保可解包，验证 why.md#需求-codex-思考内容翻译（en→zh）-场景-自动翻译/手动翻译

## 2. 控制面接入
- [√] 2.1 `translator_specs` 增加 `nvidia`，`translator_build` 支持 provider 构建（读取 `translator_config.nvidia`）
- [√] 2.2 `status` 增加 NVIDIA `auth_env` 检测提示（不泄露密钥）

## 3. UI 配置面板
- [√] 3.1 新增 `nvidia` 配置区块（Base URL / Model / Auth ENV / Timeout / RPM），并在保存/加载时读写 `translator_config.nvidia`
- [√] 3.2 Provider 切换时正确显示/隐藏各自区块，并提供合理默认值

## 4. 安全检查
- [√] 4.1 检查不回显密钥；错误信息脱敏；不把告警写入 `zh` 内容区

## 5. 文档更新
- [√] 5.1 更新 `README.md` 与知识库模块文档（新增 NVIDIA Provider 配置说明）
- [√] 5.2 更新 `helloagents/CHANGELOG.md`

## 6. 测试
- [√] 6.1 `python3 -m py_compile` 通过
- [√] 6.2 `node --check`（相关 UI 模块）通过
