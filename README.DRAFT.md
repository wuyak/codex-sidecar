# codex-sidecar（README.DRAFT：全量信息挖掘版）

> 本文件是“信息要大而全、还能回溯到代码”的挖掘版 README：主干章节（A1–A15）+ 三张附录表（附录 A/B/C）+ 完整性自检清单（D）。
>
> 写作口径（强制）：
> - **以代码为准**：文档描述与运行时行为不一致时，以代码为准，并在文档中写清差异。
> - **不引入敏感信息**：任何 token/api_key/secret 不写入本文（只描述字段、脱敏与 reveal 行为）。
> - **可回溯**：关键行为给出“前端/后端代码锚点”（文件路径 + 关键函数/入口）。

## A1 一眼看懂（1 屏内）

### 一句话定位

`codex-sidecar` 是一个**不修改 Codex** 的旁路 viewer：读取本机 `CODEX_HOME/sessions/**/rollout-*.jsonl`（以及 `CODEX_HOME/log/codex-tui.log`），把对话中的**回答/思考/工具调用与输出/终端确认**等“消息块”在本地 Web UI 里更好地展示，并可选把思考译成中文后**原位回填**。

代码锚点：`codex_sidecar/watch/rollout_extract.py`、`codex_sidecar/watch/rollout_ingest.py`、`codex_sidecar/http/state.py`

### 你会用到它的场景（3–5）

- 看懂思考：`reasoning_summary` 自动/手动翻译，支持 EN/ZH 切换与“翻译/重译”
- 读长输出：`tool_output`（含 `apply_patch` diff）整理为摘要/详情可折叠
- 多会话回看：会话标签 + 会话管理抽屉定位/重命名/导出
- 看历史文件：离线导入历史 rollout 文件（不影响当前监听）
- 长跑提醒：终端需要确认（tool gate）时，UI 贴着会话标签提示并可响铃

### 它刻意不做什么（边界）

- 不接管/不注入 Codex 输入：UI 不提供“驱动 Codex 执行”的输入框（旁路只读）
- 不修改 Codex 产物：只读 `sessions/**/rollout-*.jsonl` 与日志；不会写回这些文件

### 快速开始（2 行）

```bash
./run.sh
# 或：只启动 UI/服务端（不自动开始监听，需要在 UI 点 ▶）
./run.sh --ui
```

打开：`http://127.0.0.1:8787/ui`

代码锚点：`run.sh`、`scripts/run.sh`、`codex_sidecar/cli.py`、`ui/index.html`

---

## A2 快速开始（用户向）

### 环境要求

- Python 3（后端以标准库为主；无需额外 pip install）
- Bash（使用 `./run.sh`；Windows 可用 Git Bash/WSL，或直接 `python3 -m codex_sidecar`）

### 启动方式与访问路径

- 默认：`./run.sh`
  - 启动本地 HTTP 服务 + watcher（自动开始监听与采集）
  - 启动后会尽力自动打开浏览器到 `/ui`
- 仅 UI 模式：`./run.sh --ui`
  - 只启动本地 HTTP 服务（含 UI 静态资源与 SSE）
  - watcher 不会自动开始；需要在 UI 点击右侧 `▶`（`watchToggleBtn`）

访问路径（默认 host/port）：
- UI：`/ui`（`GET /ui` 或 `GET /ui/*`）
- 健康检查：`GET /health`
- SSE：`GET /events`

代码锚点：`scripts/run.sh`、`codex_sidecar/http/routes_get.py`、`codex_sidecar/http/handler.py`

### 常用参数与环境变量

启动脚本支持（等价透传给 `python3 -m codex_sidecar`）：
- `--host`（或环境变量 `HOST`）：默认 `127.0.0.1`
- `--port`（或环境变量 `PORT`）：默认 `8787`
- `--config-home`：Sidecar 配置目录（默认 `./config/sidecar`）
- `--codex-home`（或环境变量 `CODEX_HOME`）：要监听的 Codex 数据目录（默认 `$CODEX_HOME` 或 `~/.codex`）
- `--ui`：只起 UI/服务端，不自动开始监听
- `--no-server` + `--server-url`：只跑 watcher，把事件推送到已有服务端（高级用法）

脚本默认行为（重要）：
- 若未显式传 `--config-home`，脚本会自动追加 `--config-home ./config/sidecar`（项目内）
- 若未显式传 `--codex-home`，脚本会自动追加 `--codex-home $CODEX_HOME 或 ~/.codex`

代码锚点：`scripts/run.sh`、`codex_sidecar/cli.py`

### 我应该选 `./run.sh` 还是 `./run.sh --ui`？

- 想要“开箱即用、自动开始监听”：用 `./run.sh`
- 想要“先调好设置再开始监听/不采集只浏览”：用 `./run.sh --ui`，然后在 UI 点 `▶`

---

## A3 核心工作方式（数据流与边界）

### 数据从哪里来

- rollout：`{watch_codex_home}/sessions/**/rollout-*.jsonl`
- TUI 日志（用于 tool gate）：`{watch_codex_home}/log/codex-tui.log`

`watch_codex_home` 来源优先级：
1. 启动参数 `--codex-home`（`scripts/run.sh` 默认会补齐）
2. 环境变量 `CODEX_HOME`
3. 兜底 `~/.codex`

代码锚点：`codex_sidecar/cli.py:_default_codex_home`、`codex_sidecar/config.py:_default_watch_codex_home`

### 数据流（从文件到 UI）

1. watcher 选取/跟随若干会话文件（可并行 N 个）
2. 读取新增 JSONL 行（启动时可回放末尾 N 行）
3. 解析每行，抽取 UI 需要的消息块（可能 1 行 → 多块）
4. 去重并赋予稳定消息 id（sha1 截断）
5. 推送到本地服务端 `/ingest` 入库并广播 SSE
6. 翻译解耦：先推英文原文；后台翻译完成后以 `op=update` 回填 `zh`（不改变时间线位置）

核心代码路径：
- 解析抽取：`codex_sidecar/watch/rollout_extract.py:extract_rollout_items`
- 生成消息与入队翻译：`codex_sidecar/watch/rollout_ingest.py:RolloutLineIngestor.handle_line`
- 入库与 SSE 广播：`codex_sidecar/http/state.py:SidecarState.add/update`
- SSE 协议与断线补齐：`codex_sidecar/http/handler.py:_handle_sse`
- UI 侧事件流：`ui/app/events/stream.js`（`EventSource("/events")`）
- UI 侧全量回源：`ui/app/list/refresh.js`（`GET /api/messages` / `GET /api/offline/messages`）

### sidecar 不做什么（边界）

- 不写入/修改 `rollout-*.jsonl`，不向 Codex 注入输入
- UI 不提供“终端输入代理/远程执行面板”（只读旁路）

### 消息 schema（你看到的每一条消息从哪来）

在线（watcher ingest）消息基础字段：
- `id`：稳定 16 hex（`sha1(file_path:kind:ts:text)[:16]`）
- `ts`：rollout 的 `timestamp`
- `kind`：见 A6
- `text`：正文（英文原文/工具输出等）
- `zh`：译文（默认空；翻译回填时更新）
- `translate_error`：翻译失败原因（默认空；回填）
- `replay`：是否来自回放阶段（启动/新文件发现时）
- `thread_id`：从文件名解析（若可得）
- `file`：rollout 文件完整路径
- `line`：行号（回放/实时的当前行号）

离线（`GET /api/offline/messages`）消息额外字段：
- `key`：`offline:${encodeURIComponent(rel)}`（前后端一致）
- `seq`：离线会话内自增序号
- `rel`：相对路径 `sessions/.../rollout-*.jsonl`（接口返回里也会给）
- `file`：解析到的绝对路径
- `line`：tail 后的行序号（不是原文件绝对行号）

代码锚点：`codex_sidecar/watch/rollout_ingest.py`、`codex_sidecar/offline.py`、`ui/app/utils/id.js:keyOf`

---

## A4 UI 总览（页面结构地图）

### 页面区域（静态结构）

- 双标签栏：
  - `#offlineBookmarks`：离线“展示标签栏”（仅用于回看/导出，不影响监听）
  - `#bookmarks`：监听会话标签栏（未读徽标、tool_gate 提示锚点）
- 主体：
  - `#topbar`：标题栏（精简显示模式下强制可见）
  - `#list`：时间线（消息块列表）
- 右侧 Dock（`#rightbar`）：
  - 设置、导入对话、精简显示、翻译、开始/停止监听、清空、退出/重启
- 抽屉与弹窗：
  - 设置抽屉：`#drawer`
  - 翻译抽屉：`#translateDrawer`
  - 会话管理抽屉：`#bookmarkDrawer`
  - 导入对话弹窗：`#importDialog`
  - 精简显示设置弹窗：`#quickViewDialog`
  - 导出设置弹窗：`#exportPrefsDialog`
  - 通用确认弹窗：`#confirmDialog`

代码锚点：`ui/index.html`、`ui/styles.css`、`ui/app/dom.js`

### 交互约定（click/长按/键盘）

右侧 Dock：
- `quickViewBtn`：click 切换精简/全量；长按打开“精简显示设置”
- `translateToggleBtn`：click 切换自动翻译开/关；长按打开“翻译设置”
- `powerBtn`：click 退出 sidecar；长按跳过确认直接重启 sidecar

时间线（消息块）：
- 思考块（`reasoning_summary`）：点击内容区在 EN/ZH 间切换；点击右侧按钮触发“翻译/重译”
- 工具输出（`tool_output`）：“详情”按钮展开/收起

会话标签：
- 点击会话标签切换当前视图；未读徽标支持“逐条跳转到未读”
- 终端确认（tool_gate）会显示“贴着会话标签”的通知条，并可点击跳转/回源刷新

代码锚点：`ui/app/control/wire.js`、`ui/app/interactions/thinking_rows.js`、`ui/app/render/tool/output.js`、`ui/app/events/stream.js`

---

## A5 UI 控件与按钮全索引（重点：到“代码/接口”粒度）

- 主索引表见：**附录 A：UI 控件映射表**（覆盖 `ui/index.html` 全部 `id=` + `ui/app/dom.js` 全部 `byId(...)`）
- 若需要从 UI 反查代码：优先从 `ui/app/dom.js` 的字段名入手，再跟到 `ui/app/control/wire*.js` / `ui/app/list/*` / `ui/app/interactions/*`

---

## A6 信息展示块（消息 kind）说明（每种块一个小节）

> SSOT：后端实际产出 kind 以 `codex_sidecar/watch/rollout_extract.py` 与 `codex_sidecar/watch/rollout_ingest.py` 为准；UI 渲染以 `ui/app/render/core.js` 为准。

### 6.1 `user_message`

- 来源：rollout `event_msg` / `payload.type == "user_message"`（更简洁的用户输入回显）
- UI 展示：`<span class="pill">用户输入</span>` + Markdown；若以代码块开头会拆出 `<pre class="code">`
- 交互：主要是复制/选择（不额外加按钮）
- 导出：按“用户输入”段落导出（见 `ui/app/export.js`）

代码锚点：后端 `codex_sidecar/watch/rollout_extract.py`；前端 `ui/app/render/core.js`

### 6.2 `assistant_message`

- 来源：rollout `response_item` / `payload.type == "message" && role=="assistant"`
- UI 展示：`<span class="pill">回答</span>` + Markdown；对“编辑摘要”类输出有特殊渲染
- 未读/提示音：作为“用户最关心类型”，会计入未读与提示音（非 replay、且当前未视为已读时）
- 导出：按“回答”段落导出

代码锚点：后端 `codex_sidecar/watch/rollout_extract.py`；前端 `ui/app/render/core.js`、`ui/app/events/stream.js`、`ui/app/sound.js`

### 6.3 `reasoning_summary`（思考）

- 来源：rollout `response_item` / `payload.type == "reasoning"` / `summary_text`
- UI 展示：`<span class="pill">思考</span>` + EN/ZH 双区块
  - 默认：无译文时显示 EN；译文回填后默认切到 ZH（可点块切换）
  - 右侧 meta 按钮：翻译/重译、状态（in-flight/失败）
- 翻译回填：通过 `op=update` 更新同一 `id` 的 `zh` 与 `translate_error`，UI 尽量原位 patch（不整行重渲染）
- 导出：
  - “译文导出”时优先输出 `zh`；若缺译文可临时批量翻译补齐（见 A10）

代码锚点：后端 `codex_sidecar/watch/rollout_ingest.py`、`codex_sidecar/watch/translation_pump_core.py`；前端 `ui/app/render/core.js`、`ui/app/render/thinking/*`、`ui/app/interactions/thinking_rows.js`

### 6.4 `tool_call`

- 来源：rollout `function_call` / `custom_tool_call` / `web_search_call`
- UI 展示：
  - 一般 tool_call：展示参数（JSON 或文本）
  - 特殊：`shell_command` / `apply_patch` / `view_image` 的 tool_call 默认不渲染（避免与 tool_output 重复）
  - 特殊：`update_plan`（或 `parallel` 内嵌 update_plan）会被识别并渲染为“更新计划”块（见 6.7）
- 导出：按“工具调用”段落导出，`update_plan` 会导出为“更新计划”块

代码锚点：后端 `codex_sidecar/watch/rollout_extract.py`；前端 `ui/app/render/tool/call.js`、`ui/app/export/tool_calls.js`

### 6.5 `tool_output`

- 来源：rollout `function_call_output` / `custom_tool_call_output`
- UI 展示：摘要 + 可展开详情
  - `shell_command`：展示命令 + 输出摘要；若内含 apply_patch here-doc，会提取 diff 作为详情
  - `apply_patch`：摘要显示变更文件树/简要；详情显示完整 patch diff
  - 其他工具：树状摘要（最多 N 行）+ 详情（更多行）
- 导出：与 UI 类似的“摘要 + 详情”结构（Markdown 版）

代码锚点：前端 `ui/app/render/tool/output.js`、`ui/app/export.js`；后端 `/ingest` 见 `codex_sidecar/http/routes_post.py`

### 6.6 `tool_gate`（终端确认）

- 来源：**sidecar 派生**（不是 rollout 原生 kind）
  - 当 tool_call 参数包含 `sandbox_permissions=require_escalated`（或等价字段），且在阈值内未观察到对应 tool_output，sidecar 生成 tool_gate=waiting
  - 当观察到后续 tool_output，若之前已 emit waiting，则再 emit tool_gate=released（并带 `gate_result/exit_code`）
- UI 展示：时间线里作为“终端确认”块；同时在右下角/标签上方显示强提醒通知条
- 提示音：tool_gate waiting 触发（按 msg.id 去重，避免刷屏）
- 导出：作为“终端确认”段落导出

代码锚点：后端 `codex_sidecar/watch/rollout_ingest.py:_ApprovalGateTracker`；前端 `ui/app/events/stream.js`

### 6.7 （派生块）`update_plan`（更新计划）

- 注意：`update_plan` **不是后端 kind**。它来自 tool_call（可能是 `update_plan` 本体，或 `multi_tool_use.parallel` 内嵌）。
- UI 行为：
  - tool_call 侧：解析参数 `plan` 并渲染为“更新计划”块（`.tool-update_plan`）
  - tool_output 侧：为避免重复，若 tool_name==update_plan 则不渲染 tool_output
- 导出：同样以“更新计划”块导出

代码锚点：`ui/app/render/tool/call.js`、`ui/app/render/tool/output.js`、`ui/app/export/tool_calls.js`

---

## A7 设置项与配置文件全量说明（配置参考）

### 配置文件位置与范围

- 默认配置目录：`./config/sidecar/`（项目内）
- 实际配置文件：`config/sidecar/config.json`（默认已在 `.gitignore`）
- 示例配置：`config/sidecar/config.example.json`（可提交/可公开；不含敏感信息）

重要口径：
- 配置默认**只依赖当前项目目录**（不会自动从 `~/.config`、`$CODEX_HOME/tmp` 等旧路径导入）
- `config_home` 字段由后端强制写入并视为不可变（UI 只读展示）

代码锚点：`codex_sidecar/config.py`、`codex_sidecar/config_import.py`、`.gitignore`

### 设置抽屉（UI）里有哪些字段

- 只读展示：
  - 监视目录（`watchHome`）：对应 `watch_codex_home`（启动参数/配置决定）
  - 配置目录（`cfgHome`）：对应 `config_home_display`（展示用）
- 运行行为：
  - 自动开始（`autoStart` → `auto_start`）：影响 UI 启动后是否自动 `POST /api/control/start`
  - 回放行数（`replayLines` → `replay_last_lines`）
  - 并行会话（`maxSessions` → `watch_max_sessions`）
  - 提示音（`notifySoundAssistant` / `notifySoundToolGate`）
- UI-only（localStorage）：
  - 主题（`uiTheme`）
  - 字体大小（`uiFontSize`）
  - 按钮大小（`uiBtnSize`）

保存：
- 点击 `saveBtn`：`POST /api/config` 写入配置（并在必要时触发 `POST /api/control/start`）

代码锚点：`ui/index.html`、`ui/app/control/load.js`、`ui/app/control/config.js`、`ui/app/control/actions.js`

### 翻译设置抽屉（UI）里有哪些字段

- 自动翻译开关：`translateMode`（`translate_mode=auto/manual`）
- Provider 选择：`translator`（`translator_provider=http/openai/nvidia`）
- Provider 具体字段（见 A8；完整字段表见附录 B）

保存：
- 点击 `saveTranslateBtn`：`POST /api/config` 写入 translator 配置
- 保存后自动自检：`POST /api/control/translate_probe`

代码锚点：`ui/index.html`、`ui/app/control/config.js`、`codex_sidecar/control/translator_build.py`

### 配置迁移（升级时会自动改哪些旧值）

- `translator_provider`：旧值 `stub/none` 自动迁移为 `http`
- `translator_config.nvidia.model`：不在允许集合时会被修正为默认模型
- `replay_last_lines <= 0`：自动迁移为 `200`（避免重启后会话列表为空）
- HTTP 默认 profile：旧默认名 `默认` 且 URL 符合旧模板时，迁移为 `siliconflowfree`

代码锚点：`codex_sidecar/config_migrations.py`

---

## A8 翻译系统（深挖：provider/模式/安全/回填）

### auto / manual 的精确定义

- `translate_mode=auto`
  - watcher 在 ingest 阶段对 `reasoning_summary` 自动入队翻译
  - 回放阶段（`replay=true`）允许最多 5 条批量翻译（减少导入耗时）
- `translate_mode=manual`
  - 不自动翻译；只有当你在 UI：
    - 点击思考块（且当前无译文），或
    - 点击“翻译/重译”按钮
    才会触发翻译请求

代码锚点：后端 `codex_sidecar/watch/rollout_ingest.py`；前端 `ui/app/interactions/thinking_rows.js`

### Providers（字段、默认值、鉴权、超时）

> 配置总入口：`translator_provider` + `translator_config`（见附录 B）

1) HTTP（通用适配器）
- URL：支持两种常见协议：
  - `.../translate.json?...`：会用 `application/x-www-form-urlencoded` 提交（兼容 siliconflow 之类）
  - 其他 URL：默认发 JSON（字段同时带 `text/source/target` 与 `source_lang/target_lang` 以兼容更多社区接口）
- Token：
  - 若 URL 含 `{token}`，会做字符串替换
  - 否则会按 `auth_header`/`auth_prefix` 作为 Header 注入（默认 `Authorization: Bearer {token}`）
- 超时：`timeout_s`

代码锚点：`codex_sidecar/translators/http.py`

2) OpenAI（Responses API 兼容）
- Endpoint：`{base_url}/responses`（`base_url` 为空时运行时回退 `https://api.openai.com/v1`）
- 鉴权：
  - `Authorization: Bearer {api_key}`（默认）
  - 或 `x-api-key: {api_key}`（由 UI `openaiAuthMode` 控制）
- `reasoning_effort`：仅在模型支持 reasoning 时附加（如 `gpt-5*`、`o*`）
- `timeout_s`
- 批量翻译（带 `<<<SIDECAR_ITEM:...>>>` 协议）会**原样发送**，不会再包一层通用 prompt（避免标记被翻译破坏）

代码锚点：`codex_sidecar/translators/openai_responses_core.py`、`codex_sidecar/translators/batch_prompt.py`

3) NVIDIA（NIM Chat Completions 兼容）
- Endpoint：`{base_url}/chat/completions`
- `rpm`：全局节流（0=关闭）
- `max_tokens`：输出上限（超过模型限制会尝试 clamp 并重试）
- `max_retries`：对 429 等错误做重试（含 backoff / Retry-After）
- 模型选择：UI 下拉仅允许固定 4 个（配置迁移也会把旧/错误 model 修正回来）

代码锚点：`codex_sidecar/translators/nvidia_chat_core.py`、`codex_sidecar/config_migrations.py`

### 翻译回填机制（op=update）

- watcher ingest：先 push EN（`zh=""`）
- 翻译线程完成后：emit `{"op":"update","id":<mid>,"zh":<译文>,"translate_error":<错误>}`
- 服务端更新：`SidecarState.update` 原位更新消息并广播 SSE（`op=update`）
- SSE 断线补齐策略：
  - 仅对“新增消息”写入 `id: {seq}`（用于 Last-Event-ID）
  - 对 `op=update` 不写 `id:`，避免游标倒退导致重复回放

代码锚点：`codex_sidecar/watch/translation_pump_core.py`、`codex_sidecar/http/state.py`、`codex_sidecar/http/handler.py`

### 脱敏策略与“眼睛按钮” reveal

- `/api/config` 返回的是**脱敏视图**：
  - OpenAI：`base_url` 与 `api_key` 脱敏
  - NVIDIA：`api_key` 脱敏
  - HTTP：profile `token` 脱敏
- UI 若看到值为 `********`，点击“眼睛按钮”会调用：
  - `POST /api/control/reveal_secret`（只返回单字段明文，不返回整份 config）
- 保存时的“MASK 回填保护”：
  - UI 可能会把 `********` 原样带回；后端会用当前配置里的真实值替换，避免把 MASK 写进配置文件

代码锚点：`codex_sidecar/security.py`、`codex_sidecar/http/config_payload.py`、`codex_sidecar/control/reveal_secret.py`、`ui/app/control/wire/secrets.js`

---

## A9 历史文件/离线模式（查看历史对话文件）

### UI 入口与流程

- 入口：右侧 Dock 的 `importBtn`（“导入对话”）
- 弹窗：`importDialog`
  - 支持输入 `rel`（可直接粘贴完整路径，会自动提取 sessions 相对路径）
  - 支持日历浏览 `sessions/YYYY/MM/DD` 并选择 `rollout-*.jsonl`
- 导入后：
  - 被加入“离线展示列表”（`offlineShow`，存 localStorage）
  - 出现在 `offlineBookmarks` 标签栏中，可切换查看与导出

代码锚点：`ui/app/control/wire/import_dialog.js`、`ui/app/offline_show.js`

### 离线接口与 tail_lines

- 文件列表：`GET /api/offline/files?limit=...`
- 读取消息：`GET /api/offline/messages?rel=...&tail_lines=...`
  - `tail_lines` 为空时会使用配置 `replay_last_lines` 作为默认值
  - 上限会 clamp（避免一次拉过大）

代码锚点：后端 `codex_sidecar/http/routes_get.py`、`codex_sidecar/offline.py`；前端 `ui/app/list/refresh.js`

### 离线 key 编码规则（前后端一致）

- key：`offline:${encodeURIComponent(rel)}`
- rel：统一为 `sessions/.../rollout-*.jsonl` 的相对路径（去掉前导 `/`，统一 `/` 分隔符）

代码锚点：`codex_sidecar/offline.py:offline_key_from_rel`、`ui/app/offline.js`

### 离线译文缓存（本机 localStorage）

- 离线会话的思考译文不会写回后端 `SidecarState`，而是写入：
  - `localStorage["offlineZh:${rel}"]`（并在内存 Map 里缓存）
- 导出若需要译文且缺失：会尝试批量翻译补齐，并写回该缓存

代码锚点：`ui/app/offline_zh.js`、`ui/app/export.js`

---

## A10 导出（Markdown）规范

### 导出入口与选项

- 会话管理抽屉中的导出按钮（动态生成，非固定 id）
- 导出偏好为“会话级”：
  - 精简 / 全量
  - 译文 / 原文
- 长按导出按钮会打开导出设置弹窗 `exportPrefsDialog`

代码锚点：`ui/app/control/wire/bookmark_drawer.js`、`ui/app/control/wire/export_prefs_panel.js`

### 导出内容结构（与 UI 对齐）

- 每条消息输出为一个段落：包含 kind 标签 + 时间戳 + 正文
- `tool_output` / `apply_patch`：
  - 先输出摘要（树状/简表）
  - 详情部分以 Markdown 方式展开（不使用 HTML `<details>`，提高可移植性）
- `update_plan`：
  - 从 tool_call 解析出的“更新计划”块导出；tool_output 不重复

代码锚点：`ui/app/export.js`、`ui/app/export/tool_calls.js`、`ui/app/render/tool/output.js`

### 译文策略（导出时补齐）

- 当选择“译文导出”且思考块缺译文时：
  - 会对最多 N 条缺失思考做临时批量翻译
  - 优先 `POST /api/control/translate_text`（支持 items 批量）
  - 若端点不存在（旧版本兼容）才 fallback 到 `POST /api/offline/translate`

代码锚点：`ui/app/export.js`、`codex_sidecar/http/routes_post.py`、`codex_sidecar/http/handler.py`

### “导出从正文开始”（无调试信息头）

- 当前导出不会在文件顶部写入“调试信息头/环境头”，直接从内容正文开始（更适合分享与复盘）

代码锚点：`ui/app/export.js`

---

## A11 通知与长跑提醒（tool_gate + 声音）

### 哪些情况会响铃/提示

- `assistant_message`：新回答且判定为“未读”（非 replay，且当前并未被视为已看到）
- `tool_gate`：当 `gate_status=waiting`（或推断为 waiting）时作为强提醒提示音
- tool_call/tool_output：不计入未读、不响铃（噪音较高）

去重策略：
- 以 `msg.id` 去重（同一条消息不会重复响铃）
- 额外限流：两次播放之间有最小间隔

代码锚点：`ui/app/events/stream.js`、`ui/app/unread.js`、`ui/app/sound.js`

### 两类提示音的区别

- 回答输出：`notify_sound_assistant`
- 终端确认：`notify_sound_tool_gate`

音效来源：
- 内置：`ui/sfx/manifest.json`（以 `/ui/sfx/builtin/*.wav` 提供）
- 自定义：`{config_home}/sounds/*.wav|*.mp3|*.ogg`（通过 `/api/sfx/file/<name>` 读取；有 1MiB 上限与路径校验）

代码锚点：后端 `codex_sidecar/http/sfx.py`；前端 `ui/app/sound.js`

---

## A12 端口占用/自恢复/多实例（运行可靠性）

### 端口占用检测

启动脚本 `./run.sh` 在启动前会：
1. 对 `/health` 做一次探测：若已有 sidecar 健康运行，则直接打开 UI 并退出（避免重复启动）
2. 若健康检查失败，尝试用锁文件判断是否存在“旧 sidecar 残留占用”
3. 仅当占用者“看起来是 codex_sidecar”时才会尝试终止旧进程；否则拒绝自动处理，避免误杀其他服务

代码锚点：`scripts/_common.sh:maybe_autorecover_port`

### 锁文件与 PID 判断（避免误杀）

- 锁文件：`{config_home}/codex_sidecar.{port}.lock`
- 仅在能读取 PID 且 `ps` 命令行包含 `codex_sidecar` 时才会执行终止
- 若软终止超时，会发送 SIGKILL（仅针对已识别为 sidecar 的 PID）

代码锚点：`codex_sidecar/cli.py`（fcntl lock）与 `scripts/_common.sh`

### 多实例行为与限制

- 同一 `config_home + port`：会被锁阻止（避免重复 ingest）
- 不同端口：可并行（UI 端口不同）
- 同一端口不同 `config_home`：脚本/锁可能无法互相感知；不建议

---

## A13 安全与隐私

### 配置与密钥

- 默认配置落在项目内 `config/sidecar/config.json`（已在 `.gitignore`）
- 不会自动读取全局旧配置路径，避免 clone 后意外读到本机历史 token/api_key
- UI 对敏感字段默认脱敏；按需 reveal 需要显式点击“眼睛按钮”

代码锚点：`.gitignore`、`codex_sidecar/security.py`、`codex_sidecar/config_import.py`

### 离线文件读取的安全边界

- `/api/offline/messages` 只允许读取 `CODEX_HOME/sessions/` 下的 `rollout-*.jsonl`
- 传入路径必须以 `sessions/` 开头，且必须匹配 rollout 文件名正则，且 resolve 后仍在 sessions 目录内

代码锚点：`codex_sidecar/offline.py:resolve_offline_rollout_path`

### 自定义音效读取的安全边界

- 只允许读取 `{config_home}/sounds/` 下的有限扩展名文件
- 文件名正则校验 + 路径 resolve 防止越权；1MiB 上限

代码锚点：`codex_sidecar/http/sfx.py`

---

## A14 FAQ / 排障（按真实问题组织）

### 1) UI 看不到会话/一直显示“暂无消息”

- 先确认 watcher 是否运行：
  - UI 右侧 `▶/■` 状态，或 `GET /api/status`
- 确认 `watch_codex_home` 指向正确：
  - UI 设置里 `监视目录（固定）`
  - 启动时用 `--codex-home` 或设置环境变量 `CODEX_HOME`
- 若刚启动：等待 Codex 写入 rollout（或提高回放行数 `replay_last_lines`）

代码锚点：`ui/app/control/load.js`、`ui/app/control/actions.js`、`codex_sidecar/watch/rollout_paths.py`

### 2) 翻译不生效/一直“等待翻译…”

- 检查 `translate_mode` 是否为 auto
- 检查 Provider 配置是否完整：
  - HTTP：至少 1 个可用 profile（name + http/https URL）
  - OpenAI：需要 model + api_key（base_url 可空）
  - NVIDIA：需要 base_url + model + api_key
- 保存翻译设置后会自动 `translate_probe` 自检，可在状态栏提示中看到结果

代码锚点：`ui/app/control/config.js`、`codex_sidecar/control/translate_api.py`

### 3) 端口占用/启动失败

- 若已有 sidecar 在运行：脚本会直接打开现有 UI
- 若旧 sidecar 健康检查失败：脚本会尝试安全清理（仅限识别为 sidecar 的 PID）
- 若占用者不是 sidecar：请手动换端口或停止占用者

代码锚点：`scripts/_common.sh`、`codex_sidecar/cli.py`

### 4) 为什么不能在 UI 里输入驱动 Codex？

- 设计上这是“旁路只读”的 viewer：避免把 UI 变成远程执行面，也避免引入鉴权/多用户/输入注入等风险
- 你仍应在终端里与 Codex 交互；sidecar 负责展示与整理

代码锚点：`ui/index.html`（无输入框）、`README.md`（旁路只读原则）

### 5) 如何把配置迁移给别人（不带密钥）？

- 把 `config/sidecar/config.example.json` 作为模板分享
- 不要提交/分享 `config/sidecar/config.json`（可能包含密钥）
- 让对方在 UI 自己填入 token/api_key（会自动脱敏）

---

## A15 开发者附录

### 目录结构导览

- 后端：`codex_sidecar/`
  - CLI：`codex_sidecar/cli.py`
  - HTTP：`codex_sidecar/http/*`
  - watcher：`codex_sidecar/watch/*`
  - translators：`codex_sidecar/translators/*`
  - 离线：`codex_sidecar/offline.py`
- UI：`ui/`
  - 入口：`ui/index.html`
  - 逻辑：`ui/app/*`
  - 样式：`ui/styles.css`
  - 内置音效：`ui/sfx/*`
- 启动脚本：`run.sh`、`scripts/run.sh`、`scripts/_common.sh`
- 测试：`tests/`

### API 端点索引

- 见 **附录 C：HTTP API 索引**

### 如何跑测试

```bash
python3 -m pytest
```

### 如何打包 exe（如需）

- `./scripts/build_exe.sh`
- Windows：`./scripts/build_exe.ps1`

---

## 附录 A：UI 控件映射表（id → 行为 → API → 代码定位）

> 说明：
> - 本表覆盖 `ui/index.html` 的全部 `id=`（共 118 个）以及 `ui/app/dom.js` 的全部 `byId(...)`（共 104 个）。
> - `ui/app/dom.js` 中有 8 个 id 在 `ui/index.html` 不存在（历史遗留/已移除 UI）；也在此表列出并标注为 **DOM 缺失**，用于自检与回溯。

### A.1 全局结构与右侧 Dock

| UI 区域 | 控件(id/文案/aria-label/icon) | 交互 | 行为 | 影响范围 | 相关配置键 | 后端 API(method path + 关键参数) | 前端定位(文件 + 关键函数/选择器) | 后端定位(文件 + handler/函数分支) |
|---|---|---|---|---|---|---|---|---|
| 页面结构 | `main`（div） | — | 主容器（包含 `topbar` 与 `list`） | UI | — | — | `ui/index.html` | — |
| 页面结构 | `topbar`（div.row，标题） | — | 顶部标题栏（精简显示 CSS 强制可见） | UI | — | — | `ui/index.html`；`ui/app/quick_view_settings.js:_applyQuickStyle` | — |
| 时间线 | `list`（div） | — | 消息列表渲染容器（append/patch rows） | UI | — | `GET /api/messages`；`GET /api/offline/messages`；`GET /events` | `ui/index.html`；`ui/app/render/core.js:renderMessage`；`ui/app/list/refresh.js` | `codex_sidecar/http/routes_get.py:dispatch_get`；`codex_sidecar/http/handler.py:_handle_sse` |
| 右侧 Dock | `rightbar`（div，aria-label=actions） | — | Dock 按钮容器 | UI | — | — | `ui/index.html` | — |
| 右侧 Dock | `configToggleBtn`（button，aria-label=设置，icon `i-settings`） | click | 打开/关闭“设置抽屉” | UI | — | — | `ui/index.html`；`ui/app/control/wire.js`；`ui/app/control/ui.js:openDrawer/closeDrawer` | — |
| 右侧 Dock | `importBtn`（button，aria-label=导入对话，icon `i-inbox`） | click | 打开“导入对话”弹窗；回源离线文件列表 | UI（+离线展示列表） | — | `GET /api/offline/files`；`GET /api/offline/messages` | `ui/index.html`；`ui/app/control/wire/import_dialog.js:wireImportDialog` | `codex_sidecar/http/routes_get.py:dispatch_get`；`codex_sidecar/offline.py` |
| 右侧 Dock | `quickViewBtn`（button，aria-label=精简显示…，icon `i-bolt`） | click / long-press | click：切换精简/全量；长按：打开精简显示设置弹窗 | UI（localStorage） | — | — | `ui/index.html`；`ui/app/control/wire.js`；`ui/app/view_mode.js`；`ui/app/quick_view_settings.js` | — |
| 右侧 Dock | `translateToggleBtn`（button，aria-label=翻译，icon `i-globe`） | click / long-press | click：切换 `translate_mode`（并写入 config）；长按：打开翻译设置抽屉 | UI + 写入 config + 影响 watcher | `translate_mode` | `POST /api/config {translate_mode}` | `ui/index.html`；`ui/app/control/wire.js:_setTranslateMode`；`ui/app/control/ui.js:openTranslatorSettings` | `codex_sidecar/http/routes_post.py:dispatch_post`；`codex_sidecar/controller_core.py:update_config`；`codex_sidecar/control/watcher_hot_updates.py` |
| 右侧 Dock | `watchToggleBtn`（button，aria-label=开始监听/停止监听，icon `i-play/i-stop`） | click | 启动/停止 watcher（并刷新状态/图标） | 触发后端任务 | — | `POST /api/control/start`；`POST /api/control/stop`；`GET /api/status` | `ui/index.html`；`ui/app/control/wire.js`；`ui/app/control/actions.js:startWatch/stopWatch` | `codex_sidecar/http/routes_post.py:dispatch_post`；`codex_sidecar/controller_core.py:start/stop/status` |
| 右侧 Dock | `clearBtn`（button，aria-label=清空消息，icon `i-trash`） | click | 清空当前内存消息；并重置 follow 为 auto | 触发后端任务 + UI 清理 | — | `POST /api/control/clear`；`POST /api/control/follow {mode:auto}` | `ui/index.html`；`ui/app/control/actions.js:clearView` | `codex_sidecar/http/routes_post.py:dispatch_post`；`codex_sidecar/controller_core.py:clear_messages/set_follow` |
| 右侧 Dock | `powerBtn`（button，aria-label=关闭/长按重启，icon `i-power`） | click / long-press | click：确认后 `shutdown`；长按：跳过确认 `restart_process` | 触发后端任务（进程级） | — | `POST /api/control/shutdown`；`POST /api/control/restart_process`；`GET /health` | `ui/index.html`；`ui/app/control/wire.js`；`ui/app/control/actions.js:restartProcess`；`ui/app/control/api.js:healthPid` | `codex_sidecar/http/routes_post.py:dispatch_post`；`codex_sidecar/controller_core.py:request_shutdown/request_restart`；`codex_sidecar/cli.py` |
| 右侧 Dock | `scrollTopBtn`（button，aria-label=回到页面顶部，icon `i-arrow-up`） | click | 滚动到页面顶部（尊重 reduced-motion） | UI | — | — | `ui/index.html`；`ui/app/control/wire.js` | — |
| 右侧 Dock | `scrollBottomBtn`（button，aria-label=回到页面底部，icon `i-arrow-down`） | click | 滚动到页面底部（尊重 reduced-motion） | UI | — | — | `ui/index.html`；`ui/app/control/wire.js` | — |

### A.2 设置抽屉（Config Drawer）

| UI 区域 | 控件(id/文案/aria-label/icon) | 交互 | 行为 | 影响范围 | 相关配置键 | 后端 API(method path + 关键参数) | 前端定位(文件 + 关键函数/选择器) | 后端定位(文件 + handler/函数分支) |
|---|---|---|---|---|---|---|---|---|
| 设置抽屉 | `drawerOverlay`（div.overlay） | click | 点击遮罩关闭设置抽屉 | UI | — | — | `ui/index.html`；`ui/app/control/wire.js` | — |
| 设置抽屉 | `drawer`（div.drawer） | — | 设置抽屉容器 | UI | — | — | `ui/index.html` | — |
| 设置抽屉 | `drawerCloseBtn`（button，aria-label=关闭） | click | 关闭设置抽屉 | UI | — | — | `ui/index.html`；`ui/app/control/wire.js`；`ui/app/control/ui.js:closeDrawer` | — |
| 设置抽屉 | `watchHome`（readonly input，placeholder=~/.codex） | — | 展示 `watch_codex_home`（只读） | UI | `watch_codex_home` | — | `ui/index.html`；`ui/app/control/load.js` | — |
| 设置抽屉 | `cfgHome`（readonly input） | — | 展示 `config_home_display`（只读） | UI | `config_home`（展示） | — | `ui/index.html`；`ui/app/control/load.js`；`codex_sidecar/http/config_payload.py` | — |
| 设置抽屉 | `autoStart`（select） | click/change | 设置是否自动开始监听（保存后生效） | 写入 config（影响 UI 自动 start） | `auto_start` | `POST /api/config {auto_start}`；（可能）`POST /api/control/start` | `ui/index.html`；`ui/app/control/config.js:saveConfig`；`ui/app/control/actions.js:maybeAutoStartOnce` | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:update_config/start` |
| 设置抽屉 | `notifySoundAssistant`（select） | change | 选择“回答提示音”，并可试听 | 写入 config + UI | `notify_sound_assistant` | `GET /api/sfx`；`POST /api/config {notify_sound_assistant}` | `ui/index.html`；`ui/app/control/load.js`；`ui/app/control/wire/sfx.js`；`ui/app/sound.js` | `codex_sidecar/http/routes_get.py`；`codex_sidecar/http/sfx.py`；`codex_sidecar/http/routes_post.py` |
| 设置抽屉 | `notifySoundToolGate`（select） | change | 选择“终端确认提示音”，并可试听 | 写入 config + UI | `notify_sound_tool_gate` | `GET /api/sfx`；`POST /api/config {notify_sound_tool_gate}` | `ui/index.html`；`ui/app/control/load.js`；`ui/app/control/wire/sfx.js`；`ui/app/sound.js` | `codex_sidecar/http/routes_get.py`；`codex_sidecar/http/sfx.py`；`codex_sidecar/http/routes_post.py` |
| 设置抽屉 | `uiTheme`（select） | change | 切换 UI 主题（写 localStorage；不写 config） | UI（localStorage） | — | `GET /ui/themes/manifest.json`（静态资源） | `ui/index.html`；`ui/app/theme.js:initTheme` | — |
| 设置抽屉 | `uiFontSize`（input number） | input/change | 调整全局字号（写 localStorage；即时预览） | UI（localStorage） | — | — | `ui/index.html`；`ui/app/control/wire.js`；`ui/app/control/ui_prefs.js` | — |
| 设置抽屉 | `uiBtnSize`（input number） | input/change | 调整右侧 Dock 按钮尺寸（写 localStorage；即时预览） | UI（localStorage） | — | — | `ui/index.html`；`ui/app/control/wire.js`；`ui/app/control/ui_prefs.js` | — |
| 设置抽屉 | `maxSessions`（input number） | change | 设置并行 tail 的会话数量 | 写入 config + 影响 watcher | `watch_max_sessions` | `POST /api/config {watch_max_sessions}` | `ui/index.html`；`ui/app/control/config.js:saveConfig` | `codex_sidecar/control/watcher_hot_updates.py`；`codex_sidecar/watch/rollout_watcher.py:set_watch_max_sessions` |
| 设置抽屉 | `replayLines`（input number） | change | 设置启动/新文件回放行数 | 写入 config + 影响 watcher | `replay_last_lines` | `POST /api/config {replay_last_lines}` | `ui/index.html`；`ui/app/control/config.js:saveConfig` | `codex_sidecar/control/watcher_hot_updates.py`；`codex_sidecar/watch/rollout_watcher.py:set_replay_last_lines` |
| 设置抽屉 | `openTranslateFromSettingsBtn`（button，aria-label=翻译设置） | click | 从设置抽屉跳转打开翻译抽屉 | UI | — | — | `ui/index.html`；`ui/app/control/wire.js`；`ui/app/control/ui.js:openTranslatorSettings` | — |
| 设置抽屉 | `saveBtn`（button） | click | 保存设置抽屉配置（并强制校验字号/按钮大小） | 写入 config（可能触发 start） | `auto_start` 等（见附录 B） | `POST /api/config`；（可能）`POST /api/control/start` | `ui/index.html`；`ui/app/control/wire.js`；`ui/app/control/config.js:saveConfig` | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:update_config` |
| 设置抽屉 | `configErrorText`（div.meta） | — | 显示配置保存错误信息 | UI | — | — | `ui/index.html`；`ui/app/control/config.js` | — |

### A.3 翻译设置抽屉（Translate Drawer）

| UI 区域 | 控件(id/文案/aria-label/icon) | 交互 | 行为 | 影响范围 | 相关配置键 | 后端 API(method path + 关键参数) | 前端定位(文件 + 关键函数/选择器) | 后端定位(文件 + handler/函数分支) |
|---|---|---|---|---|---|---|---|---|
| 翻译抽屉 | `translateDrawerOverlay`（div.overlay） | click | 点击遮罩关闭翻译抽屉 | UI | — | — | `ui/index.html`；`ui/app/control/wire.js` | — |
| 翻译抽屉 | `translateDrawer`（div.drawer） | — | 翻译抽屉容器 | UI | — | — | `ui/index.html` | — |
| 翻译抽屉 | `translateDrawerCloseBtn`（button，aria-label=关闭） | click | 关闭翻译抽屉 | UI | — | — | `ui/index.html`；`ui/app/control/wire.js`；`ui/app/control/ui.js:closeTranslateDrawer` | — |
| 翻译抽屉 | `translateMode`（select） | change | 设置 `translate_mode`（与右侧 globe 按钮同步） | 写入 config + 影响 watcher | `translate_mode` | `POST /api/config {translate_mode}` | `ui/index.html`；`ui/app/control/wire.js:_setTranslateMode` | `codex_sidecar/controller_core.py:update_config`；`codex_sidecar/control/watcher_hot_updates.py` |
| 翻译抽屉 | `translator`（select） | change | 选择翻译 Provider，并切换可见字段块 | UI（待保存） | `translator_provider` | —（保存时才写入） | `ui/index.html`；`ui/app/control/load.js`；`ui/app/control/ui.js:showProviderBlocks` | — |
| 翻译抽屉 | `httpBlock`（div） | — | HTTP provider 字段容器（show/hide） | UI | — | — | `ui/index.html`；`ui/app/control/ui.js:showProviderBlocks` | — |
| HTTP Profiles | `httpProfile`（select） | change | 切换当前 profile（仅更新 UI state） | UI（待保存） | `translator_config.http.selected` | —（保存时写入） | `ui/index.html`；`ui/app/control/wire.js`；`ui/app/control/http_profiles.js` | — |
| HTTP Profiles | `httpProfileAddBtn`（button，aria-label=新增，icon `i-plus`） | click | 新增 profile（prompt 输入名称） | UI（待保存） | `translator_config.http.profiles[]` | —（保存时写入） | `ui/index.html`；`ui/app/control/wire.js` | — |
| HTTP Profiles | `httpProfileRenameBtn`（button，aria-label=重命名，icon `i-edit`） | click | 重命名 profile（prompt） | UI（待保存） | `translator_config.http.profiles[]` | —（保存时写入） | `ui/index.html`；`ui/app/control/wire.js` | — |
| HTTP Profiles | `httpProfileDelBtn`（button，aria-label=删除，icon `i-trash`） | click | 删除 profile（confirmDialog） | UI（待保存） | `translator_config.http.profiles[]` | —（保存时写入） | `ui/index.html`；`ui/app/control/wire.js`；`ui/app/control/ui.js:confirmDialog` | — |
| HTTP Profiles | `httpUrl`（input） | input | profile URL（支持 `{token}` 替换） | UI（待保存） | `translator_config.http.profiles[].url` | —（保存时写入） | `ui/index.html`；`ui/app/control/http_profiles.js`；`codex_sidecar/translators/http.py` | — |
| HTTP Profiles | `httpToken`（input password） | input | profile token（敏感；默认脱敏） | UI（待保存） | `translator_config.http.profiles[].token` | `POST /api/control/reveal_secret`（当值为 `********`） | `ui/index.html`；`ui/app/control/wire/secrets.js` | `codex_sidecar/control/reveal_secret.py`；`codex_sidecar/security.py` |
| HTTP Profiles | `httpTokenEyeBtn`（button，aria-label=显示 Token，icon `i-eye`） | click | 显示/隐藏 token；必要时调用 reveal_secret 拉取明文 | UI（敏感展示） | — | `POST /api/control/reveal_secret {provider:http,field:token,profile}` | `ui/index.html`；`ui/app/control/wire/secrets.js` | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:reveal_secret` |
| HTTP Profiles | `httpTimeout`（input number） | input | profile timeout（秒） | UI（待保存） | `translator_config.http.profiles[].timeout_s` | —（保存时写入） | `ui/index.html`；`ui/app/control/http_profiles.js` | — |
| NVIDIA | `nvidiaBlock`（div） | — | NVIDIA provider 字段容器（show/hide） | UI | — | — | `ui/index.html`；`ui/app/control/ui.js:showProviderBlocks` | — |
| NVIDIA | `nvidiaBaseUrl`（input） | input | NVIDIA base_url | UI（待保存） | `translator_config.nvidia.base_url` | —（保存时写入） | `ui/index.html`；`ui/app/control/config.js:_buildTranslatorPatch` | — |
| NVIDIA | `nvidiaModel`（select） | change | NVIDIA model（固定 4 个） | UI（待保存） | `translator_config.nvidia.model` | —（保存时写入） | `ui/index.html`；`codex_sidecar/config_migrations.py:_migrate_nvidia_model` | — |
| NVIDIA | `nvidiaApiKey`（input password） | input | NVIDIA api_key（敏感；默认脱敏） | UI（待保存） | `translator_config.nvidia.api_key` | `POST /api/control/reveal_secret`（当值为 `********`） | `ui/index.html`；`ui/app/control/wire/secrets.js` | `codex_sidecar/control/reveal_secret.py`；`codex_sidecar/security.py` |
| NVIDIA | `nvidiaApiKeyEyeBtn`（button，aria-label=显示 API Key，icon `i-eye`） | click | 显示/隐藏 API Key；必要时 reveal_secret 拉取明文 | UI（敏感展示） | — | `POST /api/control/reveal_secret {provider:nvidia,field:api_key}` | `ui/index.html`；`ui/app/control/wire/secrets.js` | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:reveal_secret` |
| NVIDIA | `nvidiaRpm`（input number） | input | NVIDIA RPM 节流（0=关闭） | UI（待保存） | `translator_config.nvidia.rpm` | —（保存时写入） | `ui/index.html`；`codex_sidecar/translators/nvidia_chat_core.py:_throttle` | — |
| NVIDIA | `nvidiaTimeout`（input number） | input | NVIDIA timeout（秒） | UI（待保存） | `translator_config.nvidia.timeout_s` | —（保存时写入） | `ui/index.html`；`codex_sidecar/translators/nvidia_chat_core.py` | — |
| NVIDIA | `nvidiaMaxTokensText`（div.meta） | — | 展示 Max Tokens（UI 固定显示 8192） | UI | — | — | `ui/index.html`；`ui/app/control/load.js` | — |
| OpenAI | `openaiBlock`（div） | — | OpenAI provider 字段容器（show/hide） | UI | — | — | `ui/index.html`；`ui/app/control/ui.js:showProviderBlocks` | — |
| OpenAI | `openaiBaseUrl`（input password） | input | OpenAI base_url（展示按敏感字段处理；可留空） | UI（待保存） | `translator_config.openai.base_url` | `POST /api/control/reveal_secret`（当值为 `********`） | `ui/index.html`；`ui/app/control/wire/secrets.js`；`codex_sidecar/control/translator_build.py` | `codex_sidecar/control/reveal_secret.py`；`codex_sidecar/security.py` |
| OpenAI | `openaiBaseUrlEyeBtn`（button，aria-label=显示 Base URL，icon `i-eye`） | click | 显示/隐藏 Base URL；必要时 reveal_secret 拉取明文 | UI（敏感展示） | — | `POST /api/control/reveal_secret {provider:openai,field:base_url}` | `ui/index.html`；`ui/app/control/wire/secrets.js` | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:reveal_secret` |
| OpenAI | `openaiModel`（input） | input | OpenAI model（必填；如 gpt-5.1） | UI（待保存） | `translator_config.openai.model` | —（保存时写入） | `ui/index.html`；`ui/app/control/config.js:_buildTranslatorPatch` | — |
| OpenAI | `openaiApiKey`（input password） | input | OpenAI api_key（敏感；默认脱敏） | UI（待保存） | `translator_config.openai.api_key` | `POST /api/control/reveal_secret`（当值为 `********`） | `ui/index.html`；`ui/app/control/wire/secrets.js` | `codex_sidecar/control/reveal_secret.py`；`codex_sidecar/security.py` |
| OpenAI | `openaiApiKeyEyeBtn`（button，aria-label=显示 API Key，icon `i-eye`） | click | 显示/隐藏 API Key；必要时 reveal_secret 拉取明文 | UI（敏感展示） | — | `POST /api/control/reveal_secret {provider:openai,field:api_key}` | `ui/index.html`；`ui/app/control/wire/secrets.js` | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:reveal_secret` |
| OpenAI | `openaiAuthMode`（select） | change | 选择鉴权 Header 模式（Authorization/x-api-key） | UI（待保存） | `translator_config.openai.auth_header/auth_prefix` | —（保存时写入） | `ui/index.html`；`ui/app/control/config.js:_buildTranslatorPatch` | — |
| OpenAI | `openaiReasoning`（input） | input | reasoning_effort（可选） | UI（待保存） | `translator_config.openai.reasoning_effort` | —（保存时写入） | `ui/index.html`；`codex_sidecar/translators/openai_responses_core.py` | — |
| OpenAI | `openaiTimeout`（input number） | input | OpenAI timeout（秒） | UI（待保存） | `translator_config.openai.timeout_s` | —（保存时写入） | `ui/index.html`；`codex_sidecar/translators/openai_responses_core.py` | — |
| 翻译抽屉 | `saveTranslateBtn`（button） | click | 保存翻译设置，并自动 translate_probe 自检 | 写入 config + 影响 watcher | `translator_provider/translator_config` | `POST /api/config`；`POST /api/control/translate_probe` | `ui/index.html`；`ui/app/control/config.js:saveTranslateConfig` | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:update_config/translate_probe` |
| 翻译抽屉 | `translateErrorText`（div.meta） | — | 显示翻译设置保存/校验错误 | UI | — | — | `ui/index.html`；`ui/app/control/config.js` | — |

### A.4 会话标签栏与会话管理抽屉（Bookmarks / Drawer）

| UI 区域 | 控件(id/文案/aria-label/icon) | 交互 | 行为 | 影响范围 | 相关配置键 | 后端 API(method path + 关键参数) | 前端定位(文件 + 关键函数/选择器) | 后端定位(文件 + handler/函数分支) |
|---|---|---|---|---|---|---|---|---|
| 标签栏（离线） | `offlineBookmarks`（div.bookmarks） | click（动态按钮） | 展示“离线展示中”的会话标签 | UI（localStorage） | — | `GET /api/offline/messages`（切换离线视图时） | `ui/index.html`；`ui/app/offline_show.js`；`ui/app/list/refresh.js` | `codex_sidecar/http/routes_get.py`；`codex_sidecar/offline.py` |
| 标签栏（在线） | `bookmarks`（div.bookmarks） | click（动态按钮） | 展示“监听中”的会话标签（未读/跳转/tool_gate 锚点） | UI | — | `GET /api/threads`；`POST /api/control/follow` | `ui/index.html`；`ui/app/list/threads.js`；`ui/app/events/stream.js` | `codex_sidecar/http/routes_get.py`；`codex_sidecar/controller_core.py:set_follow` |
| 会话管理 | `bookmarkDrawerToggleBtn`（button，aria-label=会话管理，icon `i-menu`） | click / long-press | 打开/关闭会话管理抽屉（长按与 click 等价） | UI | — | — | `ui/index.html`；`ui/app/control/wire/bookmark_drawer.js`；`ui/app/control/ui.js:openBookmarkDrawer/closeBookmarkDrawer` | — |
| 会话管理 | `bookmarkDrawerOverlay`（div.overlay） | click | 点击遮罩关闭会话管理抽屉 | UI | — | — | `ui/index.html`；`ui/app/control/wire/bookmark_drawer.js` | — |
| 会话管理 | `bookmarkDrawer`（div.drawer） | — | 会话管理抽屉容器（动态渲染列表与行内按钮） | UI | — | — | `ui/index.html`；`ui/app/control/wire/bookmark_drawer.js` | — |
| 会话管理 | `bookmarkDrawerCloseBtn`（button，aria-label=关闭） | click | 关闭会话管理抽屉 | UI | — | — | `ui/index.html`；`ui/app/control/wire/bookmark_drawer.js` | — |
| 会话管理 | `bookmarkTabsToggleBtn`（button，role=switch） | click/拖拽容错 | 收起/展开标签栏（写 localStorage） | UI（localStorage） | — | — | `ui/index.html`；`ui/app/control/wire/bookmark_drawer.js` | — |
| 会话管理 | `bookmarkCount`（span） | — | 显示“监听中”会话数量 | UI | — | — | `ui/index.html`；`ui/app/control/wire/bookmark_drawer.js` | — |
| 会话管理 | `bookmarkList`（div.tabs） | click（动态行内按钮） | 会话列表（切换/重命名/导出/关闭监听等为动态按钮） | UI +（部分动作触发后端） | — | `GET /api/threads`；`POST /api/control/follow`；`POST /api/control/follow_excludes` | `ui/index.html`；`ui/app/control/wire/bookmark_drawer.js`；`ui/app/control/wire/bookmark_drawer/interactions.js` | `codex_sidecar/http/routes_get.py`；`codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:set_follow/set_follow_excludes` |
| 会话管理 | `bookmarkHiddenDetails`（details） | toggle | “关闭监听”列表折叠区 | UI | — | — | `ui/index.html`；`ui/app/control/wire/bookmark_drawer.js` | — |
| 会话管理 | `bookmarkHiddenCount`（span） | — | 显示“关闭监听”会话数量 | UI | — | — | `ui/index.html`；`ui/app/control/wire/bookmark_drawer.js` | — |
| 会话管理 | `bookmarkHiddenList`（div.tabs） | click（动态行内按钮） | “关闭监听”会话列表（可恢复/清除等） | UI + 触发后端（excludes） | — | `POST /api/control/follow_excludes` | `ui/index.html`；`ui/app/control/wire/bookmark_drawer.js` | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:set_follow_excludes` |
| 会话管理（离线） | `offlineDetails`（details） | toggle | “展示中（离线）”列表折叠区 | UI | — | — | `ui/index.html`；`ui/app/control/wire/bookmark_drawer.js` | — |
| 会话管理（离线） | `offlineShowCount`（span） | — | 显示“展示中（离线）”数量 | UI | — | — | `ui/index.html`；`ui/app/control/wire/bookmark_drawer.js` | — |
| 会话管理（离线） | `offlineShowList`（div.tabs） | click（动态行内按钮） | 离线展示会话列表（切换/重命名/导出等为动态按钮） | UI（localStorage） + 导出 | — | `GET /api/offline/messages`；（导出补齐）`POST /api/control/translate_text` | `ui/index.html`；`ui/app/offline_show.js`；`ui/app/export.js` | `codex_sidecar/http/routes_get.py`；`codex_sidecar/http/routes_post.py` |

### A.5 弹窗（精简/导入/导出/确认）

| UI 区域 | 控件(id/文案/aria-label/icon) | 交互 | 行为 | 影响范围 | 相关配置键 | 后端 API(method path + 关键参数) | 前端定位(文件 + 关键函数/选择器) | 后端定位(文件 + handler/函数分支) |
|---|---|---|---|---|---|---|---|---|
| 精简显示 | `quickViewDialog`（dialog） | open/close | 精简显示设置弹窗（锚定 `quickViewBtn`） | UI（localStorage） | — | — | `ui/index.html`；`ui/app/control/wire.js`；`ui/app/quick_view_settings.js` | — |
| 精简显示 | `quickViewDialogCloseBtn`（button，×） | click | 关闭精简显示弹窗 | UI | — | — | `ui/index.html`；`ui/app/control/wire.js` | — |
| 精简显示 | `quickBlocksSummary`（div.meta） | — | 显示“已选 n/total”摘要 | UI | — | — | `ui/index.html`；`ui/app/quick_view_settings.js:_updateSummary` | — |
| 精简显示 | `quickBlocksResetBtn`（button） | click | 重置精简显示勾选为默认值 | UI（localStorage） | — | — | `ui/index.html`；`ui/app/quick_view_settings.js` | — |
| 精简显示 | `quickBlockList`（div） | click | 勾选/取消显示块（写 localStorage；注入 CSS 规则） | UI（localStorage） | — | — | `ui/index.html`；`ui/app/quick_view_settings.js` | — |
| 精简显示 | `quickBlocksErrorText`（div.meta） | — | 显示精简显示设置错误 | UI | — | — | `ui/index.html`；`ui/app/quick_view_settings.js` | — |
| 导入对话 | `importDialog`（dialog） | open/close | 导入对话弹窗（锚定 `importBtn`） | UI（localStorage） | — | `GET /api/offline/files` | `ui/index.html`；`ui/app/control/wire/import_dialog.js` | `codex_sidecar/http/routes_get.py` |
| 导入对话 | `importDialogCloseBtn`（button，×） | click | 关闭导入对话弹窗 | UI | — | — | `ui/index.html`；`ui/app/control/wire/import_dialog.js` | — |
| 导入对话 | `importRel`（input） | keydown Enter | 输入 rel/path 并打开（离线展示） | UI（localStorage） | — | `GET /api/offline/messages` | `ui/index.html`；`ui/app/control/wire/import_dialog.js`；`ui/app/control/wire/import_dialog/open_offline_rel.js` | `codex_sidecar/http/routes_get.py` |
| 导入对话 | `importOpenBtn`（button） | click | 打开 importRel 输入的离线文件 | UI（localStorage） | — | `GET /api/offline/messages` | `ui/index.html`；`ui/app/control/wire/import_dialog.js` | `codex_sidecar/http/routes_get.py` |
| 导入对话 | `importRefreshBtn`（button） | click | 刷新离线文件列表 | UI | — | `GET /api/offline/files` | `ui/index.html`；`ui/app/control/wire/import_dialog.js` | `codex_sidecar/http/routes_get.py` |
| 导入对话 | `importList`（div.tabs） | click | 点击选择离线文件（按日历/列表） | UI（localStorage） | — | `GET /api/offline/messages` | `ui/index.html`；`ui/app/control/wire/import_dialog.js` | `codex_sidecar/http/routes_get.py` |
| 导入对话 | `importErrorText`（div.meta） | — | 显示导入对话错误（sessions_not_found 等） | UI | — | — | `ui/index.html`；`ui/app/control/wire/import_dialog.js` | — |
| 导出设置 | `exportPrefsDialog`（dialog） | open/close | 会话级导出偏好弹窗（锚定导出按钮） | UI（localStorage） | — | — | `ui/index.html`；`ui/app/control/wire/export_prefs_panel.js`；`ui/app/export_prefs.js` | — |
| 导出设置 | `exportPrefsDialogCloseBtn`（button，×） | click | 关闭导出设置弹窗 | UI | — | — | `ui/index.html`；`ui/app/control/wire.js` | — |
| 导出设置 | `exportPrefsQuickBtn`（button，aria-pressed） | click | 切换 精简/全量 导出偏好 | UI（localStorage） | — | — | `ui/index.html`；`ui/app/control/wire/export_prefs_panel.js` | — |
| 导出设置 | `exportPrefsTranslateBtn`（button，aria-pressed） | click | 切换 译文/原文 导出偏好 | UI（localStorage） | — | — | `ui/index.html`；`ui/app/control/wire/export_prefs_panel.js` | — |
| 确认弹窗 | `confirmDialog`（dialog） | showModal/close | 通用确认弹窗（用于危险操作） | UI | — | — | `ui/index.html`；`ui/app/control/ui.js:confirmDialog` | — |
| 确认弹窗 | `confirmDialogTitle`（div） | — | 标题文本 | UI | — | — | `ui/index.html`；`ui/app/control/ui.js` | — |
| 确认弹窗 | `confirmDialogDesc`（div） | — | 描述文本 | UI | — | — | `ui/index.html`；`ui/app/control/ui.js` | — |
| 确认弹窗 | `confirmDialogCancel`（button） | click | 取消 | UI | — | — | `ui/index.html`；`ui/app/control/ui.js` | — |
| 确认弹窗 | `confirmDialogOk`（button） | click | 确认（danger/primary） | UI | — | — | `ui/index.html`；`ui/app/control/ui.js` | — |

### A.6 SVG 图标（symbol id）

| UI 区域 | 控件(id/文案/aria-label/icon) | 交互 | 行为 | 影响范围 | 相关配置键 | 后端 API(method path + 关键参数) | 前端定位(文件 + 关键函数/选择器) | 后端定位(文件 + handler/函数分支) |
|---|---|---|---|---|---|---|---|---|
| SVG 图标 | `i-settings`（symbol） | — | 图标定义（被 `<use href="#i-settings">` 引用） | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-bookmark`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-bolt`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-globe`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-play`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-stop`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-refresh`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-trash`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-plus`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-edit`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-eye`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-eye-off`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-eye-closed`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-power`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-menu`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-arrow-up`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-arrow-down`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-download`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |
| SVG 图标 | `i-inbox`（symbol） | — | 图标定义 | UI | — | — | `ui/index.html` | — |

### A.7 DOM 缺失（`ui/app/dom.js` 引用但 `ui/index.html` 不存在）

| UI 区域 | 控件(id/文案/aria-label/icon) | 交互 | 行为 | 影响范围 | 相关配置键 | 后端 API(method path + 关键参数) | 前端定位(文件 + 关键函数/选择器) | 后端定位(文件 + handler/函数分支) |
|---|---|---|---|---|---|---|---|---|
| 遗留/已移除 | `statusText`（DOM 缺失） | — | 旧版状态栏文本容器（当前 UI 已移除；代码有空值保护） | — | — | — | `ui/app/dom.js`；`ui/app/control/ui.js:setStatus` | — |
| 遗留/已移除 | `statusMain`（DOM 缺失） | — | 旧版状态栏主文本容器（当前 UI 已移除；代码有空值保护） | — | — | — | `ui/app/dom.js`；`ui/app/control/ui.js:setStatus` | — |
| 遗留/已移除 | `statusHover`（DOM 缺失） | — | 旧版状态 hover 详情容器（当前 UI 已移除） | — | — | — | `ui/app/dom.js`；`ui/app/control/load.js`（尝试写入 hoverHtml） | — |
| 遗留/已移除 | `followProc`（DOM 缺失） | — | 高级监听设置输入（UI 已移除；仍可通过 config.json/CLI 设置） | — | `follow_codex_process` | — | `ui/app/dom.js`；`ui/app/control/config.js`（存在则发送） | `codex_sidecar/control/watcher_hot_updates.py` |
| 遗留/已移除 | `onlyWhenProc`（DOM 缺失） | — | 高级监听设置输入（UI 已移除） | — | `only_follow_when_process` | — | `ui/app/dom.js`；`ui/app/control/config.js` | `codex_sidecar/control/watcher_hot_updates.py` |
| 遗留/已移除 | `procRegex`（DOM 缺失） | — | 高级监听设置输入（UI 已移除） | — | `codex_process_regex` | — | `ui/app/dom.js`；`ui/app/control/config.js` | `codex_sidecar/control/watcher_hot_updates.py` |
| 遗留/已移除 | `pollInterval`（DOM 缺失） | — | 高级监听设置输入（UI 已移除） | — | `poll_interval` | — | `ui/app/dom.js`；`ui/app/control/config.js` | `codex_sidecar/control/watcher_hot_updates.py` |
| 遗留/已移除 | `scanInterval`（DOM 缺失） | — | 高级监听设置输入（UI 已移除） | — | `file_scan_interval` | — | `ui/app/dom.js`；`ui/app/control/config.js` | `codex_sidecar/control/watcher_hot_updates.py` |

---

## 附录 B：Config 字段索引（key path → 默认值 → UI → 生效时机 → 安全说明）

> 说明：本表以 `codex_sidecar/config.py:SidecarConfig` 为 SSOT；并对齐 `config/sidecar/config.example.json`（用户可见示例）。

### B.1 SidecarConfig（持久化配置）

| key path | 默认值（代码/示例） | 说明 | UI 入口 | 生效时机 | 敏感性与脱敏 | reveal 行为 | 迁移规则 |
|---|---|---|---|---|---|---|---|
| `config_home` | 默认：`./config/sidecar`（由 CLI/后端注入；示例未包含） | 配置目录（不可变；展示用字段会派生 `config_home_display`） | 设置抽屉 `cfgHome`（只读） | 启动时 | 非敏感 | — | — |
| `watch_codex_home` | 默认：`$CODEX_HOME` 或 `~/.codex`（示例：`~/.codex`） | 监听的 Codex 数据目录 | 设置抽屉 `watchHome`（只读） | 需要 stop/start watcher（hot update 不覆盖） | 非敏感 | — | — |
| `auto_start` | 默认：`true`（示例：`true`） | UI 启动时是否自动 `POST /api/control/start` | 设置抽屉 `autoStart` | 立即（保存后） | 非敏感 | — | — |
| `watch_max_sessions` | 默认：`3`（示例：`3`） | 同时 tail 的会话文件数量 | 设置抽屉 `maxSessions` | hot update | 非敏感 | — | — |
| `replay_last_lines` | 默认：`200`（示例：`50`） | 启动/新文件发现时从尾部回放的行数 | 设置抽屉 `replayLines` | hot update（影响后续新发现会话） | 非敏感 | — | `<=0 → 200` |
| `poll_interval` | 默认：`0.5`（示例：`0.5`） | 轮询读取文件的间隔（秒） |（UI 已移除；可手改 config） | hot update | 非敏感 | — | — |
| `file_scan_interval` | 默认：`2.0`（示例：`2.0`） | 扫描新会话文件的间隔（秒） |（UI 已移除；可手改 config） | hot update | 非敏感 | — | — |
| `max_messages` | 默认：`1000`（示例：`1000`） | 内存中保留最近消息条数（注意：服务端实际以 CLI `--max-messages` 初始化） |（UI 未暴露） | 需重启进程 | 非敏感 | — | — |
| `follow_codex_process` | 默认：`false`（示例：`false`） | 是否优先基于进程定位正在写入的 rollout（WSL/Linux） |（UI 已移除；可手改 config） | hot update | 非敏感 | — | — |
| `codex_process_regex` | 默认：`codex`（示例：`codex`） | 进程匹配正则 |（UI 已移除；可手改 config） | hot update | 非敏感 | — | — |
| `only_follow_when_process` | 默认：`true`（示例：`true`） | 未检测到 Codex 进程时是否禁止 follow 切换 |（UI 已移除；可手改 config） | hot update | 非敏感 | — | — |
| `translate_mode` | 默认：`auto`（示例：`auto`） | auto：自动翻译思考；manual：只在 UI 触发时翻译 | 右侧 `translateToggleBtn`；翻译抽屉 `translateMode` | hot update | 非敏感 | — | — |
| `notify_sound_assistant` | 默认：`builtin:chime-gentle-up`（示例同） | 回答提示音 | 设置抽屉 `notifySoundAssistant` | 立即（保存后） | 非敏感 | — | — |
| `notify_sound_tool_gate` | 默认：`builtin:chime-double`（示例同） | 终端确认提示音 | 设置抽屉 `notifySoundToolGate` | 立即（保存后） | 非敏感 | — | — |
| `translator_provider` | 默认：`http`（示例：`http`） | 当前翻译 provider | 翻译抽屉 `translator` | hot update（保存后） | 非敏感 | — | `stub/none → http` |
| `translator_config.http.profiles[]` | 默认：1 条 siliconflowfree（示例同） | HTTP profiles（name/url/token/timeout_s） | 翻译抽屉 HTTP block | hot update（保存后） | `token` 脱敏 | `reveal_secret(http, token, profile)` | 默认名“默认”→“siliconflowfree” |
| `translator_config.openai.*` | 默认：`model=gpt-5.1` 等（示例同） | OpenAI（Responses 兼容）配置 | 翻译抽屉 OpenAI block | hot update（保存后） | `base_url/api_key` 脱敏 | `reveal_secret(openai, base_url/api_key)` | — |
| `translator_config.nvidia.*` | 默认：`base_url=https://integrate.api.nvidia.com/v1` 等（示例同） | NVIDIA（Chat Completions 兼容）配置 | 翻译抽屉 NVIDIA block | hot update（保存后） | `api_key` 脱敏 | `reveal_secret(nvidia, api_key)` | model 修正到允许集合 |

### B.2 UI-only 偏好（localStorage）

| key | 默认 | 说明 | 影响范围 | 代码锚点 |
|---|---|---|---|---|
| `codex_sidecar_ui_theme` | manifest default | UI 主题选择 | UI | `ui/app/theme.js` |
| `codex_sidecar_ui_font_size` | `14` | UI 字体大小（px） | UI | `ui/app/control/ui_prefs.js` |
| `codex_sidecar_ui_btn_size` | `38` | 右侧 Dock 按钮大小（px） | UI | `ui/app/control/ui_prefs.js` |
| `codex_sidecar_view_mode_v1` | `full` | 全量/精简显示模式 | UI | `ui/app/view_mode.js` |
| `codex_sidecar_quick_view_blocks_v1` | 默认包含 tool_gate/update_plan 等 | 精简显示包含哪些块（并注入 CSS） | UI | `ui/app/quick_view_settings.js` |
| `codex_sidecar_export_prefs_v1` |（无） | 会话级导出偏好（精简/全量、译文/原文） | UI 导出 | `ui/app/export_prefs.js` |
| `offlineShow:1` |（无） | 离线“展示中”列表 | UI | `ui/app/offline_show.js` |
| `offlineZh:${rel}` |（无） | 离线会话思考译文缓存 | UI/导出 | `ui/app/offline_zh.js` |
| `codex_sidecar_tabs_collapsed_v1` | `0` | 标签栏是否收起 | UI | `ui/app/control/wire/bookmark_drawer.js` |

---

## 附录 C：HTTP API 索引（method/path → 用途 → handler → 前端调用点）

> 说明：路由真相以 `codex_sidecar/http/routes_get.py` 与 `codex_sidecar/http/routes_post.py` 为准；SSE 在 `codex_sidecar/http/handler.py`。

| method | path | 用途 | 输入(query/body) | 输出(json 字段) | 错误/失败条件 | handler(后端定位) | 前端调用点(文件 + 调用函数) |
|---|---|---|---|---|---|---|---|
| GET | `/health` | 健康检查/获取 pid | query：无 | `{ok,pid}` | — | `codex_sidecar/http/routes_get.py:dispatch_get` | `scripts/_common.sh:check_health_once`；`ui/app/control/api.js:healthPid` |
| GET | `/api/messages` | 获取在线消息列表 | query：`thread_id`(可选) | `{messages:[...]}` | — | `codex_sidecar/http/routes_get.py` | `ui/app/list/refresh.js:refreshList` |
| GET | `/api/threads` | 获取会话聚合列表 | query：无 | `{threads:[{key,thread_id,file,count,last_ts,last_seq,kinds}...]}` | — | `codex_sidecar/http/routes_get.py`；`codex_sidecar/http/state.py:list_threads` | `ui/app/list/threads.js` |
| GET | `/api/config` | 获取配置（脱敏） | query：无 | `{ok,config,...}` | — | `codex_sidecar/http/routes_get.py`；`codex_sidecar/http/config_payload.py` | `ui/app/control/load.js:loadControl` |
| POST | `/api/config` | 更新配置（持久化） | body：patch dict | `{ok,config,...}` | 409 conflict（ValueError） | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:update_config` | `ui/app/control/config.js:saveConfig/saveTranslateConfig`；`ui/app/control/wire.js:_setTranslateMode` |
| GET | `/api/status` | 获取运行态状态 | query：无 | `{ok,pid,boot_id,running,watcher,follow,config,last_error}` | — | `codex_sidecar/http/routes_get.py`；`codex_sidecar/controller_core.py:status` | `ui/app/control/load.js`；`ui/app/control/actions.js:stopWatch` |
| POST | `/api/control/start` | 启动 watcher | body：无 | `{ok,running}` | — | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:start` | `ui/app/control/actions.js:startWatch`；`ui/app/control/actions.js:maybeAutoStartOnce` |
| POST | `/api/control/stop` | 停止 watcher | body：无 | `{ok,running,stop_timeout?}` | stop_timeout（后台任务拖延） | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:stop` | `ui/app/control/actions.js:stopWatch` |
| POST | `/api/control/follow` | 设置 follow（auto/pin） | body：`{mode,thread_id?,file?}` | `{ok,mode,thread_id,file}` | — | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:set_follow` | `ui/app/control/actions.js:clearView`；（会话切换处） |
| POST | `/api/control/follow_excludes` | 更新关闭监听列表 | body：`{keys:[],files:[]}` | `{ok,exclude_keys,exclude_files}` | — | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:set_follow_excludes` | `ui/app/control/wire/bookmark_drawer.js` |
| POST | `/api/control/clear` | 清空消息 | body：无 | `{ok:true}` | — | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:clear_messages` | `ui/app/control/actions.js:clearView` |
| POST | `/api/control/shutdown` | 退出进程（异步） | body：无 | `{ok:true}` | — | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:request_shutdown` | `ui/app/control/wire.js` |
| POST | `/api/control/restart_process` | 请求进程重启（异步） | body：无 | `{ok:true}` | — | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:request_restart` | `ui/app/control/actions.js:restartProcess` |
| GET | `/api/translators` | 获取可用翻译 provider 列表 | query：无 | `{translators:[{id,label,fields}...]}` | — | `codex_sidecar/http/routes_get.py`；`codex_sidecar/control/translator_specs.py` | `ui/app/control/load.js` |
| POST | `/api/control/translate_probe` | 翻译自检 | body：无 | `{ok,provider,model?,error?}` | — | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:translate_probe` | `ui/app/control/config.js:saveTranslateConfig` |
| POST | `/api/control/translate_text` | 翻译文本（在线/离线共用） | body：`{text}` 或 `{items:[{id,text}...]}` | `{ok,zh}` 或 `{ok,items:[...]}` | 400 invalid_json | `codex_sidecar/http/routes_post.py`；`codex_sidecar/http/handler.py:_handle_translate_text` | `ui/app/export.js`；`ui/app/interactions/thinking_rows.js`（离线） |
| POST | `/api/control/retranslate` | 触发单条思考翻译/重译 | body：`{id}` | `{ok,queued?,error?}` | — | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:retranslate` | `ui/app/interactions/thinking_rows.js:_postRetranslate` |
| POST | `/api/control/reveal_secret` | reveal 单字段密钥 | body：`{provider,field,profile?}` | `{ok,value}` | unknown_provider/field | `codex_sidecar/http/routes_post.py`；`codex_sidecar/controller_core.py:reveal_secret` | `ui/app/control/wire/secrets.js` |
| GET | `/api/sfx` | 列出内置/自定义提示音 | query：无 | `{ok,builtin,custom,selected_assistant,selected_tool_gate}` | — | `codex_sidecar/http/routes_get.py`；`codex_sidecar/http/sfx.py` | `ui/app/control/load.js` |
| GET | `/api/sfx/file/<name>` | 读取自定义音效文件 | path：`name` | bytes（audio/*） | not_found/校验失败 | `codex_sidecar/http/routes_get.py`；`codex_sidecar/http/sfx.py:read_custom_sfx_bytes` | `ui/app/sound.js`（`file:` URL） |
| GET | `/api/offline/files` | 列出离线可选 rollout 文件 | query：`limit` | `{ok,files:[{rel,file,thread_id,mtime,size}...]}` | sessions_not_found | `codex_sidecar/http/routes_get.py`；`codex_sidecar/offline.py:list_offline_rollout_files` | `ui/app/control/wire/import_dialog.js:refreshOfflineFiles` |
| GET | `/api/offline/messages` | 读取离线消息 | query：`rel`、`tail_lines` | `{ok,rel,key,file,messages:[...]}` | missing_rel/invalid_path | `codex_sidecar/http/routes_get.py`；`codex_sidecar/offline.py:build_offline_messages` | `ui/app/list/refresh.js`；`ui/app/export.js` |
| POST | `/api/offline/translate` | 兼容：离线翻译入口 | body：同 translate_text | 同 translate_text | — | `codex_sidecar/http/routes_post.py` | `ui/app/export.js`（fallback） |
| POST | `/ingest` | watcher 推送消息/回填更新 | body：消息对象；`op=update` 支持 patch | `{ok,op:add|update}` | empty_body/invalid_json/missing_fields | `codex_sidecar/http/routes_post.py`；`codex_sidecar/http/state.py` | 后端 watcher：`codex_sidecar/watch/ingest_client.py` |
| GET | `/events` | SSE 消息流 | header：`Last-Event-ID`(可选) | SSE `event: message` | — | `codex_sidecar/http/handler.py:_handle_sse` | `ui/app/events/stream.js` |
| GET | `/ui` / `/ui/*` | 提供静态 UI 资源 | path | text/bytes | not_found | `codex_sidecar/http/routes_get.py`；`codex_sidecar/http/handler.py:_serve_ui_file` | 浏览器 |

---

## D. 完整性自检清单

- [x] D.1 `ui/index.html` 的全部 `id=`（118 个）都在“附录 A”出现
- [x] D.2 `ui/app/dom.js` 的全部 `byId(...)`（104 个）都在“附录 A”出现（其中 8 个为 DOM 缺失已标注）
- [x] D.3 `config/sidecar/config.example.json` 的全部顶层键都在“附录 B”出现
- [x] D.4 `routes_get.py` / `routes_post.py` 的全部端点都在“附录 C”出现
- [x] D.5 每个消息 kind 都有“来源 + UI 展示 + 交互 + 导出”说明（见 A6）
- [x] D.6 README.DRAFT 明确写了：只读旁路、不注入输入、敏感信息不入仓（见 A1/A3/A13）
