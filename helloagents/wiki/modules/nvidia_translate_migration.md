# nvidia_translate_migration

> 目标：把本项目的 NVIDIA（NIM Chat Completions）翻译接入“按原样迁移”到其他项目（含配置结构、HTTP 请求/响应与提示词策略）。
>
> 本文以代码为准：`codex_sidecar/translators/nvidia_chat.py`。

## 1. 本项目实现概览

- **协议类型**：OpenAI 兼容 `Chat Completions`
- **默认 Base URL**：`https://integrate.api.nvidia.com/v1`
- **Endpoint**：`POST {base_url}/chat/completions`
- **认证**：`Authorization: Bearer <token>`
- **Content-Type**：`application/json`（注意：本项目显式写成不带 `charset` 的形式）
- **模型选择**：通过请求体 `model` 字段指定；UI 固定 4 个候选（见“内置模型”）

本项目不会让你手工填“完整 endpoint”：`base_url` 末尾若不是 `/chat/completions`，会自动拼接该路径。

## 2. 配置（config.json）

### 2.1 配置文件路径

默认落盘：
- `./config/sidecar/config.json`

启动参数可覆盖配置目录：
- `--config-home /path/to/dir`（最终文件为 `{config_home}/config.json`）

相关代码：
- `codex_sidecar/config.py`
- `scripts/run.sh`
- `scripts/ui.sh`

### 2.2 关键字段（NVIDIA Provider）

最小可用字段：
- `translator_provider`: `"nvidia"`
- `translator_config.nvidia.base_url`
- `translator_config.nvidia.model`
- `translator_config.nvidia.api_key`（或环境变量 `NVIDIA_API_KEY`）

可选字段（本项目实现支持）：
- `translator_config.nvidia.timeout_s`（默认 `60`）
- `translator_config.nvidia.rpm`（默认 `0`，不节流）
- `translator_config.nvidia.max_tokens`（默认 `8192`；设为 `0` 表示“不传该字段”）
- `translator_config.nvidia.max_retries`（默认 `3`）

示例（节选）：

```json
{
  "translator_provider": "nvidia",
  "translator_config": {
    "nvidia": {
      "base_url": "https://integrate.api.nvidia.com/v1",
      "model": "moonshotai/kimi-k2-instruct",
      "api_key": "nvapi-***",
      "timeout_s": 60,
      "rpm": 0,
      "max_tokens": 8192,
      "max_retries": 3
    }
  }
}
```

说明：
- UI 里填的 `API Key` 会写入 `config.json`（输入框是密码样式，但本质仍会持久化）；如你不希望落盘，可不填 `api_key`，改用环境变量 `NVIDIA_API_KEY` 注入。
- 本项目启动时会把 `translator_config.nvidia.model` 强制纠正到允许列表（仅 4 个内置模型），避免历史遗留/无权限 model id 导致 404/空译文。

相关代码：
- 配置纠正：`codex_sidecar/config.py`
- 翻译器构建：`codex_sidecar/control/translator_build.py`
- UI 保存配置：`ui/app/control/config.js`

## 3. 内置模型（固定 4 个）

UI 下拉与代码允许列表固定为以下 4 个：
- `moonshotai/kimi-k2-instruct`（默认）
- `google/gemma-3-1b-it`
- `mistralai/mistral-7b-instruct-v0.3`
- `mistralai/ministral-14b-instruct-2512`

来源（本项目）：
- UI 下拉固定：`ui/index.html`
- 运行时纠正：`codex_sidecar/config.py`
- 翻译器常量：`codex_sidecar/translators/nvidia_chat.py`

## 4. HTTP 请求（你要迁移的“关键协议”）

### 4.1 Endpoint 规则

最终请求地址：
- 若 `base_url` 以 `/chat/completions` 结尾：直接使用该 URL
- 否则：拼接 `base_url.rstrip("/") + "/chat/completions"`

### 4.2 Headers

本项目显式设置以下请求头（不随模型变化）：
- `Content-Type: application/json`
- `Authorization: Bearer <token>`

`token` 读取优先级：
1. `translator_config.nvidia.api_key`
2. 环境变量 `NVIDIA_API_KEY`

### 4.3 Body（本项目最小字段）

本项目请求体（最小集合）：
- `model`: string
- `messages`: `[{ "role": "user", "content": "<prompt>" }]`
- `temperature`: `0`
- `stream`: `false`
- `max_tokens`: 可选（仅当 > 0 时才会传）

## 5. 最小 curl（用于外部项目/CI 自检）

```bash
curl -sS -X POST "https://integrate.api.nvidia.com/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <NVIDIA_API_KEY>' \
  -d '{
    "model": "moonshotai/kimi-k2-instruct",
    "temperature": 0,
    "stream": false,
    "messages": [
      {
        "role": "user",
        "content": "把下面英文翻译成中文，保留 Markdown/代码块：\n\nHello, world!"
      }
    ]
  }'
```

如果你的返回是标准 OpenAI 结构，译文通常在：
- `choices[0].message.content`

## 6. 提示词策略（为什么不是“直接发原文”）

本项目不会直接把“待翻译文本”裸发给模型，而是将其包在一段**翻译指令**里，确保：
- 只翻译英文，中文原样保留
- 逐行/不重排，尽量保持 Markdown 结构
- 代码块/命令/路径/变量名/JSON 不翻译

实现要点：
- 使用哨兵标记包裹输入，降低模型“把规则/输入混在一起重写”的概率：
  - `<<<SIDE_CAR_TEXT>>>`
  - `<<<END_SIDE_CAR_TEXT>>>`
- 部分模型会回显哨兵，本项目会在解析后剥离，避免污染 UI 输出。

本项目使用的 Prompt 模板（可直接迁移/复用）：

```text
把下面内容翻译成【简体中文】，只输出译文。
格式要求：逐行翻译并保持原有行序/分段/空行；不要合并或拆分段落；不要新增列表/标题/解释；保留原有 Markdown 标记（如 `#` 标题前缀、列表符号、缩进、``` 围栏）。
标题规则：对以 `#` 开头的标题行，必须保留 `#` 前缀与后续空格，并翻译其后的标题文字（不要删除 `#`）。
内容要求：中文原样保留、仅翻译英文；代码块/命令/路径/变量名/JSON 原样不翻译；专有名词（API/HTTP/JSON/Codex/Sidecar/NVIDIA 等）原样保留；原文中文为主则原样返回。

<<<SIDE_CAR_TEXT>>>
{text}
<<<END_SIDE_CAR_TEXT>>>
```

相关代码：
- Prompt 构造：`codex_sidecar/translators/nvidia_chat.py`

## 7. 响应解析（接收输出）

本项目对返回结构做了多路兼容提取，优先级为：
1. `choices[].message.content`
2. `choices[].delta.content`（部分网关会返回类似 streaming 的 delta 结构）
3. `choices[].text`
4. 顶层兜底字段：`text/result/output/translation`

另外还做了：
- `message.content` 兼容：既支持字符串，也支持 `[{type:"text",text:"..."}]` 这类列表形态
- 哨兵剥离（模型回显时）

相关代码：
- 解析与剥离：`codex_sidecar/translators/nvidia_chat.py`

## 8. 错误处理与重试（建议你迁移时一并带走）

本项目的稳健性策略（可直接复刻）：
- **缺少 token**：直接返回空字符串，并记录 `last_error`（不抛异常影响主流程）
- **429**：优先读取 `Retry-After`；否则指数退避（上限 30 秒）；最多重试 `max_retries` 次
- **400（上下文超限）**：若错误信息包含 “maximum context length ...”，会自动降低 `max_tokens` 并重试一次
- **timeout / URLError**：指数退避重试

说明：
- 本项目默认 **不启用** “自动换模型回退”（`allow_fallback=False`）；如需要可在移植时提供一个开关，但建议优先手工切换模型以避免行为不稳定。

## 9. 批量翻译协议（可选）

如果你的目标项目也有“导入期/积压期的批量翻译”需求，本项目实现了一个**标记协议**来把多条文本打包成一次请求，并在返回中解包：
- Magic：`<<<SIDECAR_TRANSLATE_BATCH_V1>>>`
- 条目：`<<<SIDECAR_ITEM:<id>>>`
- 结束：`<<<SIDECAR_END>>>`

要点：
- 批量 prompt 自带严格的“标记行必须原样输出”的约束。
- NVIDIA Translator 会检测到该协议后**不再二次包裹**通用翻译 prompt，避免标记被翻译/改写导致解包失败。

相关代码：
- 打包/解包：`codex_sidecar/watch/translate_batch.py`
- 协议检测（避免二次包裹）：`codex_sidecar/translators/nvidia_chat.py`

## 10. 迁移清单（落地到你的项目）

- [ ] 定义配置结构（`base_url/model/api_key/timeout_s/rpm/max_tokens/max_retries`）
- [ ] 实现 Prompt 构造（翻译规则 + 哨兵包裹）
- [ ] 实现请求：`POST /chat/completions` + 固定 headers + JSON body
- [ ] 实现响应提取：优先 `choices[0].message.content`，并兼容常见变体
- [ ] 实现哨兵剥离（防止模型回显污染）
- [ ] 实现 429/timeout/URLError 重试策略（强烈建议）
- [ ] 实现 context-length 下的 `max_tokens` clamp（建议）
- [ ] 增加一个 `curl`/小脚本自检（建议）
