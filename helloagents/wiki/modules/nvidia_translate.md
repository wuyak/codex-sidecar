# nvidia_translate

## 职责
提供 NVIDIA NIM（build.nvidia.com / integrate.api.nvidia.com）翻译引擎接入，用于 sidecar 的思考内容翻译（EN→ZH），并尽量保留代码块、命令、路径、标识符与专有名词不被翻译。

## 对接方式（HTTP / Chat Completions）
- **Base URL:** `https://integrate.api.nvidia.com/v1`
- **Endpoint:** `POST /chat/completions`
- **鉴权:** `Authorization: Bearer <API Key>`
- **Content-Type:** `application/json`
- **推荐模型（默认值）:** `moonshotai/kimi-k2-instruct`

说明：
- 部分旧文档/示例里的 `nvidia/riva-translate-*` 可能不在你的 `/models` 列表里；此时调用 `/chat/completions` 可能表现为 `404 page not found`。
- sidecar **默认不做自动回退模型**（避免运行中静默换模导致“同配置但输出忽好忽坏”）；需要切换时请在 UI 下拉中手动选择。
- 为减少“重排/合并段落/把原文改成列表/漏掉 `#` 标题前缀”等格式问题，sidecar 的单条与批量翻译提示词均要求尽量逐行保留原结构。

补充：
- **不同 model 的请求头不需要分别配置**：在 NVIDIA integrate 的 OpenAI 兼容网关下，绝大多数模型都使用同一套 `Authorization` + `Content-Type`，主要差异在请求体的 `model` 字段与模型能力/限额。

## 配置（UI）
在 UI 中选择 Provider：`NVIDIA（NIM Chat Completions）`，并填写：
- `Base URL`
- `Model`：下拉固定 4 个模型（见下方“内置模型”）
- `API Key`：写入本机配置文件（UI 已改为密码输入框，不再明文展示）
- `Max Tokens`（默认 8192，输出上限；可设为 0 表示“不传该字段，交给服务端默认值”）
- `RPM`（默认 0，不主动节流；如遇 429 可再调低/开启节流）
- `超时（秒）`（默认 60；sidecar 会对长文本/大模型自动提高一次请求的有效超时，减少 `timeout_s=12` 这类空译文）
- `保存`：保存后立即生效，无需重启进程/会话
  - 保存后 sidecar 会自动做一次“小样例翻译自检”，并以 toast 提示成功/失败（失败会带原因，便于排查 Key/模型/权限/超时）。

入口提示：
- 右侧“翻译”按钮：**单击**切换自动翻译（`auto/manual`）；**长按**打开“翻译设置”抽屉（其中也可设置自动翻译开关与 NVIDIA 配置）。

配置会写入本机 `config.json` 的 `translator_config.nvidia` 分区；切换 Provider 不会覆盖其他 Provider 的配置。

## 内置模型（仅 4 个）
以下为 UI 固定提供的 4 个候选（用于翻译切换）：
- `moonshotai/kimi-k2-instruct`
- `google/gemma-3-1b-it`
- `mistralai/mistral-7b-instruct-v0.3`
- `mistralai/ministral-14b-instruct-2512`

提示：
- `/models` 列表里出现的模型不一定对你的账号可用；若出现 `404 ... Not found for account`，请在上述 4 个模型中手动切换到可用项。
- 部分模型会把 prompt 分隔标记（如 `<<<SIDE_CAR_TEXT>>>`）回显在输出中；sidecar 会自动清理，避免污染 UI。
- 若输出未按规则保留标题 `#` 或代码围栏 ```（输入中存在时），sidecar 会判定为“格式不保真”并返回错误（建议换模型）。
- 如果你本机 `config.json` 仍包含历史遗留 model id（例如 `nvidia/riva-translate-4b-instruct-v1_1`），sidecar 会在加载配置时直接重置为默认模型，避免反复 404/空译文。
- `max_tokens` 是“输出上限”，不是“模型上下文长度”。实际必须满足：`输入 tokens + max_tokens <= 模型最大上下文`；否则会返回 400（常见提示含 “maximum context length ...”）。sidecar 会在该类 400 错误下自动降低 `max_tokens` 并重试一次，避免直接空译文。

## 模型差异（简要）
- **专用翻译模型（riva/translate 相关）**：理论上更贴近“翻译”任务，但在 integrate 网关里经常受账号权限限制，且在“严格保留 Markdown/逐行输出”上不一定稳定。
- **通用指令模型（llama/mistral/qwen/deepseek 等 instruct）**：通常更擅长遵循“逐行/保留结构”指令，翻译质量与格式一致性往往更好，但成本/速度随模型大小变化明显。

## 运行策略（限流/重试）
- **固定节流（RPM）**：按 `min_interval = 60 / RPM` 做全局节流，默认 `RPM=0`（不主动节流）。
- **429 重试**：优先使用 `Retry-After`，否则指数退避（带上限），避免持续触发 429。
- **输出上限（Max Tokens）**：用于降低长文本被服务端默认上限截断的概率（不同模型/网关上限不同）。

## 批量翻译（导入期聚合）
sidecar 的导入期批量翻译会使用 `<<<SIDECAR_TRANSLATE_BATCH_V1>>>` marker 协议打包/解包。NVIDIA Provider 会在检测到该协议时避免二次包裹 prompt，以降低 marker 被改写导致解包失败的概率。

为避免“模型只输出 `<<<SIDECAR_END>>>` / 丢失 `<<<SIDECAR_ITEM:...>>>` 导致解包缺失”，sidecar 的批量提示词已加严；同时当解包缺失时会对缺失项回退为单条翻译，避免 UI 出现漏段。
