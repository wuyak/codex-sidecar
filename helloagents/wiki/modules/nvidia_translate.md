# nvidia_translate

## 职责
提供 NVIDIA NIM（build.nvidia.com / integrate.api.nvidia.com）翻译引擎接入，用于 sidecar 的思考内容翻译（EN→ZH），并尽量保留代码块、命令、路径、标识符与专有名词不被翻译。

## 对接方式（HTTP / Chat Completions）
- **Base URL:** `https://integrate.api.nvidia.com/v1`
- **Endpoint:** `POST /chat/completions`
- **鉴权:** `Authorization: Bearer $NVIDIA_API_KEY`
- **推荐模型:** `nvidia/riva-translate-4b-instruct-v1_1`

## 配置（UI）
在 UI 中选择 Provider：`NVIDIA（NIM Chat Completions）`，并填写：
- `Base URL`
- `Model`
- `Auth ENV`（推荐：`NVIDIA_API_KEY`，避免把密钥写入本机配置文件）
- `RPM`（默认 40，用于节流）
- `超时（秒）`

配置会写入本机 `config.json` 的 `translator_config.nvidia` 分区；切换 Provider 不会覆盖其他 Provider 的配置。

## 运行策略（限流/重试）
- **固定节流（RPM）**：按 `min_interval = 60 / RPM` 做全局节流，默认 `RPM=40`（约 1.5s/次）。
- **429 重试**：优先使用 `Retry-After`，否则指数退避（带上限），避免持续触发 429。

## 批量翻译（导入期聚合）
sidecar 的导入期批量翻译会使用 `<<<SIDECAR_TRANSLATE_BATCH_V1>>>` marker 协议打包/解包。NVIDIA Provider 会在检测到该协议时避免二次包裹 prompt，以降低 marker 被改写导致解包失败的概率。

