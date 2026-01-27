# codex-sidecar（README.ENCYCLOPEDIA：百科全书版）

> 本文是**百科全书版**：面向“要把所有行为讲清楚，并能回溯到代码”的读者。
>
> - 对外简版：`README.md`
> - 信息挖掘/索引表版（含 3 张超长附录表）：`README.DRAFT.md`（已保留）
> - 百科全书版（本文）：`README.ENCYCLOPEDIA.md`（侧重解释原理、数据流、边界与细节）
>
> 写作口径（强制）：
> - **以代码为准**：文档描述与运行时行为不一致时，以代码为准（并给出代码锚点）。
> - **不引入敏感信息**：任何 token/api_key/secret 不写入本文（只描述字段、脱敏与 reveal 行为）。
> - **可回溯**：关键行为必须能回溯到具体文件路径 + 关键函数/入口（前端/后端至少各 1 个锚点，或说明仅存在单侧）。

---

## 0. 如何使用本文（导航约定）

如果你把本文当“百科”来查资料，建议用搜索而不是从头读：

- 找“消息块/kind”：搜 `KIND:`（例如 `KIND: reasoning_summary`）
- 找“后端接口”：搜 `API:`（例如 `API: GET /api/messages`）
- 找“配置键”：搜 `CFG:`（例如 `CFG: translate_mode`）
- 找“UI 控件”：搜 `UI:`（例如 `UI: translateToggleBtn`）
- 找“关键模块入口”：搜 `CODE:`（例如 `CODE: RolloutLineIngestor.handle_line`）

此外，若你需要**全量**的 UI/Config/API 三张索引表：
- 你可以看本文底部的 `附录 A / 附录 B / 附录 C / D`（已内置一份，便于单文件查阅）
- 也可以看 `README.DRAFT.md`（同样保留一份，便于对照/拆分维护）

---

## 1. 一句话定位与边界（你在用什么 / 它不是什么）

`codex-sidecar` 是一个**不修改 Codex** 的旁路 viewer：读取本机 `CODEX_HOME/sessions/**/rollout-*.jsonl`（以及 `CODEX_HOME/log/codex-tui.log`），把对话中的**回答/思考/工具调用与输出/终端确认**等“消息块”在本地 Web UI 里更好地展示；并提供可选的“思考翻译”能力（译文以 `op=update` 的形式回填到 sidecar 的内存消息流中）。

- 目标：**读得更清楚、回溯到代码、可导出复盘**。
- 非目标：**不接管/不注入 Codex 输入**、不把 UI 做成“远程执行台”、不修改/重写 rollout 文件。

代码锚点：
- CODE: `codex_sidecar/watch/rollout_extract.py:extract_rollout_items`
- CODE: `codex_sidecar/watch/rollout_ingest.py:RolloutLineIngestor.handle_line`
- CODE: `codex_sidecar/http/state.py:SidecarState.add/update`
- CODE: `ui/app/events/stream.js`（SSE 订阅）

---

## 2. 运行方式（从命令到进程）

### 2.1 你通常怎么启动它

推荐（项目内脚本，自动补齐 config-home 与 codex-home）：

```bash
./run.sh
# 或：只启动 UI/服务端（不自动开始监听，需要在 UI 点 ▶）
./run.sh --ui
```

打开：`http://127.0.0.1:8787/ui`（默认）

代码锚点：
- `run.sh` → `scripts/run.sh`
- CODE: `codex_sidecar/cli.py:main`

### 2.2 `./run.sh` 到底做了什么

1) 解析 `HOST/PORT` 环境变量与 `--host/--port` 参数（两种写法都支持：`--port 8787` / `--port=8787`）

2) 默认把配置目录固定到项目内 `./config/sidecar`（除非你显式传 `--config-home`）：
- 这样“配置随项目走”，避免误读你机器上别处的旧密钥/旧配置。

3) 默认把 `--codex-home` 补齐为 `$CODEX_HOME` 或 `~/.codex`（除非你显式传 `--codex-home`）

4) **端口自恢复**（仅当启用本地服务端，即未传 `--no-server`）：
- 如果 `GET /health` 返回 200：认为已有 sidecar 在运行，直接打开 `/ui` 并退出脚本；
- 如果端口被锁但健康检查失败：尝试安全终止旧 sidecar 并重启；
- 如果锁占用的进程不像 sidecar：**拒绝自动终止**，要求你手动处理（避免误杀）。

代码锚点：
- CODE: `scripts/run.sh`
- CODE: `scripts/_common.sh:maybe_autorecover_port`

### 2.3 `python3 -m codex_sidecar` 的关键参数（精确口径）

| 参数 | 默认值 | 含义 |
|---|---:|---|
| `--host` | `127.0.0.1` | 本地 HTTP 服务监听地址 |
| `--port` | `8787` | 本地 HTTP 服务端口 |
| `--config-home` | `./config/sidecar` | sidecar 配置目录（项目内） |
| `--codex-home` | `$CODEX_HOME` 或 `~/.codex` | 被监听的 Codex 数据目录 |
| `--ui` | false | 只启动 UI/服务端，不自动开始 watcher |
| `--no-server` | false | 不启服务端（只跑 watcher 推送到 `--server-url`） |
| `--server-url` | `http://127.0.0.1:8787`（隐式） | watcher 推送目标（`/ingest`） |
| `--replay-last-lines` | 200 | 启动/新文件发现时从尾部回放多少行 |
| `--poll-interval` | 0.5 | 轮询 tail 的间隔（秒） |
| `--file-scan-interval` | 2.0 | 扫描新会话文件的间隔（秒） |
| `--follow-codex-process` | false | 进程跟随模式（WSL/Linux） |
| `--codex-process-regex` | `codex` | 匹配 Codex 进程的正则 |
| `--allow-follow-without-process` | false | 没检测到 Codex 进程也允许退回 sessions 扫描 |

代码锚点：
- CODE: `codex_sidecar/cli.py:_parse_args`

### 2.4 多实例与端口锁（为什么能避免“重复输出两次”）

当启用本地服务端（默认），`codex_sidecar/cli.py` 会在 `config_home` 目录下创建/占用一个“按端口区分”的锁文件：

- 锁文件：`codex_sidecar.{port}.lock`
- 机制：`fcntl.flock(LOCK_EX | LOCK_NB)`（不可重入）
- 目的：防止同一台机器上误启动多个 sidecar 进程，导致同一条内容被重复 ingest

代码锚点：
- CODE: `codex_sidecar/cli.py`（lock 相关逻辑）

---

## 3. 目录与数据源（CODEX_HOME 是什么）

### 3.1 sidecar 关心哪些文件

1) rollout（核心）：
- `CODEX_HOME/sessions/**/rollout-*.jsonl`

2) TUI 日志（用于 tool gate 判断与补充上下文）：
- `CODEX_HOME/log/codex-tui.log`

3) sidecar 自己的配置（默认项目内）：
- `./config/sidecar/config.json`（通常在 `.gitignore`，避免把本机配置提交进仓库）
- `./config/sidecar/config.example.json`（可提交/可公开；不含敏感值）

代码锚点：
- CODE: `codex_sidecar/config.py`
- CODE: `codex_sidecar/watch/rollout_paths.py`
- CODE: `codex_sidecar/watch/tui_gate.py`

### 3.2 离线读取的安全边界（为什么不会读到任意文件）

离线接口 `GET /api/offline/messages` 只允许读取：

- 路径必须以 `sessions/` 开头
- 最终解析到的文件必须在 `CODEX_HOME/sessions` 目录树内
- 文件名必须匹配 `rollout-*.jsonl` 的正则
- 且必须是一个真实存在的文件

代码锚点：
- CODE: `codex_sidecar/offline.py:resolve_offline_rollout_path`

---

## 4. 解析与消息抽取（rollout JSONL → sidecar messages）

### 4.1 rollout JSONL 的“我们用到的那部分”

rollout 文件是 JSONL：每行一个 JSON 对象。sidecar 只关心其中少数几种 `type`：

- `type="response_item"`：
  - `payload.type="message"`（assistant 输出）
  - `payload.type="reasoning"`（思考摘要）
  - `payload.type in ("function_call","custom_tool_call","web_search_call")`（工具调用）
  - `payload.type in ("function_call_output","custom_tool_call_output")`（工具输出）
- `type="event_msg"`：
  - `payload.type="user_message"`（用户输入回显；通常比 message 更简洁）

代码锚点：
- CODE: `codex_sidecar/watch/rollout_extract.py:extract_rollout_items`

### 4.2 抽取规则（从一行 rollout 变成多个“消息块”）

抽取函数返回 `(ts, extracted[])`，其中 `extracted` 是一组 `{kind, text}`：

- `assistant_message`：从 `payload.content[]` 抽取 `text` 片段并拼接
- `reasoning_summary`：从 `payload.summary[]` 里抽 `type=="summary_text"` 的 `text`
- `tool_call`：
  - 第 1 行：tool 名称（`payload.name` 或 `ptype`）
  - 如果有 `call_id`：第 2 行起包含 `call_id=...`
  - 后续：原始参数（可能是 JSON 字符串或其他文本）
- `tool_output`：
  - 若有 `call_id`：以 `call_id=...` 开头
  - 后续：原始输出文本
- `user_message`：直接使用 `payload.message`

代码锚点：
- CODE: `codex_sidecar/watch/rollout_extract.py`

### 4.3 sidecar message 的基础 schema（这是 UI 与导出共同的“事实层”）

无论在线（watcher ingest）还是离线（offline parse），UI 最终都消费一种统一的 message 形状（字段可能略有差异）：

- `id`：消息 id（在线为 16 hex；离线为 `off:...` 前缀）
- `seq`：服务端为每条新增消息分配的递增序号（用于 SSE `id:` 与排序）
- `ts`：rollout 的 `timestamp`（字符串）
- `kind`：消息类型（见 4.4 / 6 / 10 / 12）
- `text`：正文（Markdown/纯文本/工具输出）
- `zh`：译文（默认空，回填 `op=update`）
- `translate_error`：翻译失败信息（默认空）
- `replay`：是否来自回放（启动/发现新文件时的 tail 回放）
- `thread_id`：从文件名解析到的会话 id（若可得）
- `file`：rollout 文件路径（在线为绝对路径字符串；离线同）
- `line`：来源行号（在线为“文件绝对行号”；离线为“tail 后序号”）

代码锚点：
- CODE: `codex_sidecar/watch/rollout_ingest.py:RolloutLineIngestor.handle_line`
- CODE: `codex_sidecar/offline.py:build_offline_messages`
- CODE: `codex_sidecar/http/state.py:SidecarState.add/update`

### 4.4 `id` 生成与去重（为什么能“稳定”且不会刷屏）

在线模式的 `id` 生成规则：

- hash 输入：`"{file_path}:{kind}:{ts}:{text}"`
- hash：`sha1_hex(...)`
- 最终 `id`：取前 16 个 hex 字符（`hid[:16]`）

去重是基于同一个 `hid` + `kind` 的 dedupe cache（避免回放/重连/重复读取造成重复消息）。

代码锚点：
- CODE: `codex_sidecar/watch/rollout_ingest.py:sha1_hex`
- CODE: `codex_sidecar/watch/dedupe_cache.py`

### 4.5 `op=update`（译文/状态回填）是什么

sidecar 支持一种“原位更新”消息：

- watcher 初次 ingest：先发 `zh=""`（英文原文）
- 翻译完成后：再发 `{"op":"update","id":<mid>,"zh":...,"translate_error":...}`
- 服务端 `SidecarState.update` 只更新特定字段，保持 `seq` 不变
- UI 侧尽量对 DOM 做 patch（减少大列表重排）

代码锚点：
- CODE: `codex_sidecar/http/routes_post.py`（`/ingest` 的 update 分支）
- CODE: `codex_sidecar/http/state.py:update`
- CODE: `ui/app/render/thinking/patch.js`

### 4.6 消息类型全集（kinds）与派生块

当前后端会产出的 `kind`（SSOT 以 extractor/ingestor 为准）：

- `user_message`
- `assistant_message`
- `reasoning_summary`
- `tool_call`
- `tool_output`
- `tool_gate`（派生：终端确认提醒；不是 rollout 原生）

另外，UI 还有一个“派生展示块”：

- `update_plan`（不是后端 kind）
  - 来自 tool_call（可能是 `update_plan` 本体或 `multi_tool_use.parallel` 内嵌）
  - UI 将其渲染为“更新计划”块；并抑制对应 tool_output 的重复渲染

代码锚点：
- CODE: `codex_sidecar/watch/rollout_extract.py`
- CODE: `codex_sidecar/watch/rollout_ingest.py:_ApprovalGateTracker`
- CODE: `ui/app/render/tool/call.js`（plan update 识别）
- CODE: `ui/app/export/tool_calls.js`

---

## 5. 后端 HTTP 服务与 API（控制面 + 数据面 + UI 静态资源）

### 5.1 服务端是什么架构

- Python 标准库 `http.server.BaseHTTPRequestHandler`
- 统一 handler：`codex_sidecar/http/handler.py:SidecarHandler`
- GET/POST 路由分发拆分到：
  - `codex_sidecar/http/routes_get.py:dispatch_get`
  - `codex_sidecar/http/routes_post.py:dispatch_post`
- 内存态消息存储与 SSE 广播：
  - `codex_sidecar/http/state.py:SidecarState`

### 5.2 API：健康检查

KIND: 不适用（这是 HTTP）

API: `GET /health`
- 用途：判断服务是否就绪；返回 pid
- 响应：`{ "ok": true, "pid": <int> }`

代码锚点：`codex_sidecar/http/routes_get.py`

### 5.3 API：消息读取（在线）

API: `GET /api/messages`
- query：
  - `thread_id`（可选）：只返回某个会话的消息
- 响应：`{ "messages": [<message>, ...] }`

API: `GET /api/threads`
- 用途：返回“会话聚合视图”（按 thread_id/file 聚合 count、last_seq、kinds）
- 响应：`{ "threads": [ {key, thread_id, file, count, last_ts, last_seq, kinds}, ... ] }`

代码锚点：
- CODE: `codex_sidecar/http/routes_get.py`
- CODE: `codex_sidecar/http/state.py:list_threads`

### 5.4 API：配置读写（含脱敏）

API: `GET /api/config`
- 用途：返回**脱敏**后的配置 payload（供 UI 展示）
- 说明：服务端会派生/补充 display 字段（例如只读展示用）

API: `POST /api/config`
- body：一个 JSON 对象（允许部分字段 patch；由 controller 负责合并/校验/迁移）
- 成功响应：脱敏后的配置 payload
- 失败响应：`409 conflict` + error 文本（例如非法配置组合）

代码锚点：
- CODE: `codex_sidecar/http/routes_get.py` / `routes_post.py`
- CODE: `codex_sidecar/http/config_payload.py`（脱敏与 payload 结构）
- CODE: `codex_sidecar/security.py`（mask/reveal 相关）
- CODE: `codex_sidecar/controller_core.py:update_config`

### 5.5 API：watcher 生命周期（start/stop/status/clear）

API: `GET /api/status`
- 响应：包含 running、follow 状态、热点配置等（UI 用于状态条）

API: `POST /api/control/start`
- 用途：启动 watcher（开始 ingest）

API: `POST /api/control/stop`
- 用途：停止 watcher

API: `POST /api/control/clear`
- 用途：清空内存消息（并重置 follow 为 auto）

代码锚点：
- CODE: `codex_sidecar/controller_core.py:start/stop/status/clear_messages`
- CODE: `ui/app/control/actions.js`

### 5.6 API：follow（自动跟随 / 固定会话 / 关闭监听列表）

API: `POST /api/control/follow`
- body：`{ mode: "auto"|"pin", thread_id?: string, file?: string }`
- 用途：
  - auto：按“最新/进程跟随”的策略选取主会话，并填充并行会话列表
  - pin：固定跟随某个 thread_id 或文件

API: `POST /api/control/follow_excludes`
- body：`{ keys: string[], files: string[] }`
- 用途：更新“关闭监听”名单（用于过滤/隐藏某些会话）

代码锚点：
- CODE: `codex_sidecar/watch/follow_picker.py:FollowPicker`
- CODE: `codex_sidecar/control/follow_control_api.py`
- CODE: `ui/app/control/wire/bookmark_drawer.js`

### 5.7 API：翻译（probe / translate / retranslate）

API: `GET /api/translators`
- 用途：返回 UI 用的 provider 元信息（字段列表、label 等）

API: `POST /api/control/translate_probe`
- 用途：对当前 translator 配置做一次“可用性自检”

API: `POST /api/control/translate_text`
- body 支持两种形态：
  - `{ text: "..." }`：单条翻译
  - `{ items: [ {id?, text}, ... ] }`：批量翻译（导出补齐、离线补齐会用到）
- 响应：
  - 单条：`{ ok, zh, error? }`
  - 批量：`{ ok: true, items: [ { id?, zh, error? }, ... ] }`（注意：为兼容旧调用，外层 `ok` 尽量保持 true，错误放在 item 里）

API: `POST /api/control/retranslate`
- body：`{ id }`（消息 id）
- 用途：触发对某条 `reasoning_summary` 的翻译/重译（在线消息为主）

代码锚点：
- CODE: `codex_sidecar/http/routes_get.py` / `routes_post.py`
- CODE: `codex_sidecar/controller_core.py:translate_probe/translate_text/translate_items/retranslate`
- CODE: `ui/app/interactions/thinking_rows.js`

### 5.8 API：reveal secret（按需取回单字段明文）

API: `POST /api/control/reveal_secret`
- body：`{ provider, field, profile? }`
- 响应：`{ ok, value }`（仅返回请求的单字段明文）
- 说明：这是为了在 UI 中实现“眼睛按钮”，避免把整份配置明文下发给前端

代码锚点：
- CODE: `codex_sidecar/control/reveal_secret.py`
- CODE: `codex_sidecar/security.py`
- CODE: `ui/app/control/wire/secrets.js`

### 5.9 API：离线（files/messages）

API: `GET /api/offline/files?limit=60`
- 用途：列出最近的 rollout 文件（给导入对话弹窗用）
- 响应：`{ ok, files:[{rel,file,thread_id,mtime,size}...] }`

API: `GET /api/offline/messages?rel=...&tail_lines=...`
- 用途：读取离线消息（不影响 watcher，不写入在线消息队列）
- 失败：`missing_rel` / `invalid_path`

代码锚点：
- CODE: `codex_sidecar/offline.py`
- CODE: `ui/app/control/wire/import_dialog.js`

### 5.10 API：提示音（sfx）

API: `GET /api/sfx`
- 用途：列出内置/自定义提示音，以及当前选择项

API: `GET /api/sfx/file/<name>`
- 用途：读取自定义音效文件（只允许特定扩展名）

代码锚点：
- CODE: `codex_sidecar/http/sfx.py`
- CODE: `ui/app/sound.js`

### 5.11 数据面：/ingest（watcher 推送）与 /events（SSE）

API: `POST /ingest`
- body：一个 message 对象（JSON）
  - 普通新增：必须至少包含 `id/kind/text`
  - 更新：`{"op":"update","id":...,...}`
- 响应：`{ ok: true, op: "add"|"update" }`

API: `GET /events`（SSE）
- `event: message`
- `data: <json>`
- 对“新增消息”附带 `id: {seq}`（用于 EventSource 断线续传）
- **对 `op=update` 不附带 `id:`**（避免浏览器 Last-Event-ID 游标倒退导致重放）
- reconnect 行为：
  - 首次连接：不会主动补历史（UI 自己会先 `GET /api/messages`）
  - 断线重连：若浏览器带 `Last-Event-ID`，服务端 best-effort 从内存消息列表补齐 `seq > Last-Event-ID` 的新增消息

代码锚点：
- CODE: `codex_sidecar/http/routes_post.py`（/ingest）
- CODE: `codex_sidecar/http/handler.py:_handle_sse`
- CODE: `codex_sidecar/http/state.py:_Broadcaster`（高优先级事件在背压下更不容易丢）
- CODE: `ui/app/events/stream.js`

---

## 6. UI 运行机制（从 SSE 到渲染）

### 6.1 UI 启动时发生的事（概览）

1) 加载 `ui/index.html` 与静态资源（CSS/JS/音效 manifest）
2) 前端初始化 state（当前视图 key、导出偏好、quick view 偏好、主题/字体等）
3) `GET /api/config` / `GET /api/status` 拉取配置与运行状态
4) `GET /api/messages` 拉取当前内存消息（作为首屏历史）
5) `EventSource("/events")` 订阅实时增量

代码锚点：
- CODE: `ui/app/main.js`
- CODE: `ui/app/list/bootstrap.js`
- CODE: `ui/app/events/stream.js`
- CODE: `ui/app/state.js`

### 6.2 在线/离线视图为什么能共存（双标签栏）

UI 同时维护两套“标签栏”：

- 在线（监听中）：`bookmarks`
  - 对应 watcher 跟随/多会话并行
  - 有未读徽标、tool_gate 强提醒
- 离线（展示中）：`offlineBookmarks`
  - 仅用于回看/导出
  - 不影响 watcher 的 follow/未读/提示音策略

代码锚点：
- CODE: `ui/index.html`
- CODE: `ui/app/offline_show.js`
- CODE: `ui/app/list/threads.js`

### 6.3 “未读”与提示音（为什么只对某些 kind 响）

未读与提示音的目标是“提醒你真正需要注意的事件”，因此会有过滤与去重：

- `assistant_message`：通常会计入未读，并可能触发“回答提示音”
- `tool_gate` waiting：会触发强提醒与“终端确认提示音”（并按 msg.id 去重）
- `op=update`（译文回填）：通常不会触发提示音（否则翻译补齐会刷屏）

背压策略：SSE subscriber 队列是 bounded 的；如果浏览器跟不上，服务端会优先保留高优先级事件（assistant/tool_gate），丢弃低优先级噪音（更新回填）。

代码锚点：
- CODE: `codex_sidecar/http/state.py:_Broadcaster._is_high_priority`
- CODE: `ui/app/unread.js`
- CODE: `ui/app/sound.js`

---

## 7. UI 交互百科（按“功能”解释，而不是只罗列控件）

> 你如果要查“每个 id 对应什么行为/API/代码”，请直接看本文底部的 **附录 A**（或对照 `README.DRAFT.md` 的附录 A）。

### 7.1 右侧 Dock：你会最常点的那排按钮

UI: `configToggleBtn`（设置）
- click：打开/关闭设置抽屉（`drawer`）
- 目的：集中管理 watcher/翻译/提示音/UI 偏好等

UI: `importBtn`（导入对话）
- click：打开离线导入弹窗（`importDialog`），支持搜索/日历选择 rollout 文件
- 目的：回看历史对话文件（离线展示，不影响监听）

UI: `quickViewBtn`（精简显示）
- click：切换全量/精简视图
- long-press：打开“精简显示设置”（控制哪些 kind 在 quick mode 显示）

UI: `translateToggleBtn`（自动翻译）
- click：切换 `translate_mode`（会写入 config，并触发 watcher hot update）
- long-press：打开翻译设置抽屉（`translateDrawer`）
- 设计点：click 给“开关”，long-press 给“细节”，减少日常操作成本

UI: `watchToggleBtn`（开始/停止监听）
- click：`POST /api/control/start` 或 `POST /api/control/stop`
- 说明：`--ui` 模式下 watcher 默认不启动；你需要点这个按钮开始监听

UI: `clearBtn`（清空消息）
- click：清空服务端内存消息（`POST /api/control/clear`），并重置 follow 为 auto
- 注意：这不会删除 rollout 文件，也不会影响 Codex

UI: `powerBtn`（关闭/重启）
- click：确认后请求 sidecar shutdown（进程退出）
- long-press：跳过确认直接请求 restart_process（进程重启）

代码锚点：
- CODE: `ui/app/control/wire.js`
- CODE: `ui/app/control/actions.js`
- CODE: `codex_sidecar/http/routes_post.py`

### 7.2 设置抽屉：持久化配置 + UI 偏好

设置抽屉对应的保存动作：

UI: `saveBtn`
- click：调用 `saveConfig(...)`，最终 `POST /api/config` 落盘到 `config/sidecar/config.json`

一些字段是“只读展示用”，例如：
- `cfgHome`：显示 config_home（不建议让 UI 修改）
- `watchHome`：显示 watch_codex_home（通常需要通过启动参数改变；hot update 不覆盖）

代码锚点：
- CODE: `ui/app/control/config.js:saveConfig`
- CODE: `codex_sidecar/http/routes_post.py:/api/config`

### 7.3 翻译抽屉：provider 选择、配置、脱敏与自检

翻译抽屉的保存动作：

UI: `saveTranslateBtn`
- click：`POST /api/config` 写入 translator 配置
- 保存后自动自检：`POST /api/control/translate_probe`

脱敏与 reveal：
- `GET /api/config` 返回的敏感字段会被 mask（例如 `********`）
- UI 的“眼睛按钮”会对单字段发 `POST /api/control/reveal_secret`
- 后端会做“MASK 回填保护”：避免把 `********` 写回 config 文件

代码锚点：
- CODE: `ui/app/control/wire/secrets.js`
- CODE: `codex_sidecar/http/config_payload.py`
- CODE: `codex_sidecar/control/reveal_secret.py`

### 7.4 会话管理抽屉（Bookmarks Drawer）：监听中 / 展示中 / 关闭监听

会话管理抽屉把会话分成三类：

1) 监听中（watcher active）
2) 展示中（离线 show）
3) 关闭监听（excludes）

这背后的核心设计是：**离线回看不应该污染在线监听行为**，否则“导入历史文件”会打断你正在跟随的会话。

代码锚点：
- CODE: `ui/app/control/wire/bookmark_drawer.js`
- CODE: `codex_sidecar/http/state.py:list_threads`
- CODE: `codex_sidecar/control/follow_control_api.py`

### 7.5 时间线（消息块）交互：你点到的其实是不同的渲染器

UI 的每条消息行会按 `kind` 走不同渲染路径：

- `assistant_message` / `user_message`：Markdown 渲染为主
- `reasoning_summary`：有 EN/ZH 切换与“翻译/重译”按钮
- `tool_call` / `tool_output`：有摘要/详情展开；部分工具（如 apply_patch）会被结构化
- `tool_gate`：会额外触发通知条与提示音

代码锚点：
- CODE: `ui/app/render/core.js`
- CODE: `ui/app/render/thinking/*`
- CODE: `ui/app/render/tool/*`
- CODE: `ui/app/decorate/*`
- CODE: `ui/app/interactions/*`

---

## 8. 配置系统百科（CFG：SidecarConfig + localStorage prefs）

### 8.1 配置文件：在哪里、什么时候读、什么时候写

默认：
- 配置目录：`./config/sidecar/`
- 实际配置：`./config/sidecar/config.json`（建议不入仓）
- 示例配置：`./config/sidecar/config.example.json`（可入仓、无敏感）

读取：
- 进程启动时读取（`load_config`），并自动应用迁移与 invariant 修正

写入：
- UI 保存：`POST /api/config` → controller 合并/迁移 → 写 `config.json`

代码锚点：
- CODE: `codex_sidecar/config.py:load_config/save_config`
- CODE: `codex_sidecar/config_migrations.py`
- CODE: `ui/app/control/config.js`

### 8.2 SidecarConfig 字段语义（哪些能热更新，哪些需要重启）

CFG: `replay_last_lines` / `poll_interval` / `file_scan_interval` / `watch_max_sessions`
- 属于 watcher 行为参数，通常支持 hot update（对“后续”生效）

CFG: `watch_codex_home`
- UI 只读展示；改变它通常意味着“换一个 CODEX_HOME”
- 运行中切换可能导致线程列表/离线文件列表语义变化，默认不做热切换

CFG: `max_messages`
- 决定服务端内存窗口大小；服务端初始化时读取（想改一般需要重启进程）

CFG: `translate_mode`
- `auto`：自动翻译 `reasoning_summary`
- `manual`：只在 UI 触发时翻译
- 支持 hot update（切换即生效）

CFG: `notify_sound_assistant` / `notify_sound_tool_gate`
- UI 立即生效（选择音效 id）

代码锚点：
- CODE: `codex_sidecar/config.py:SidecarConfig`
- CODE: `codex_sidecar/control/watcher_hot_updates.py`
- CODE: `ui/app/control/wire.js:_setTranslateMode`

### 8.3 UI-only 偏好（localStorage）

localStorage 不属于后端 config，而是纯 UI 偏好：

- `codex_sidecar_ui_theme`（主题）
- `codex_sidecar_ui_font_size`（字体大小）
- `codex_sidecar_ui_btn_size`（Dock 按钮大小）
- `codex_sidecar_view_mode_v1`（full/quick）
- `codex_sidecar_quick_view_blocks_v1`（quick mode 显示哪些块）
- `codex_sidecar_export_prefs_*`（会话级导出偏好：精简/全量、译文/原文等）

代码锚点：
- CODE: `ui/app/control/ui_prefs.js`
- CODE: `ui/app/theme.js`
- CODE: `ui/app/view_mode.js`
- CODE: `ui/app/export_prefs.js`

---

## 9. 翻译系统百科（从 provider 到回填）

### 9.1 端到端流程（先英文、后回填）

1) watcher ingest 推送原文（`zh=""`）
2) 翻译队列/线程异步翻译
3) 翻译完成后 `POST /ingest {op:update,...}` 回填 `zh/translate_error`
4) UI 收到 `op=update` 后原位 patch 思考块

代码锚点：
- CODE: `codex_sidecar/watch/translation_pump_core.py`
- CODE: `codex_sidecar/http/routes_post.py:/ingest`
- CODE: `ui/app/render/thinking/patch.js`

### 9.2 `translate_mode=auto/manual` 的精确定义

CFG: `translate_mode=auto`
- 自动翻译范围：只自动翻译 `KIND: reasoning_summary`
- 回放阶段（`replay=true`）允许 batchable（减少导入耗时/请求次数）

CFG: `translate_mode=manual`
- 不自动翻译
- UI 主动触发：
  - 点击思考块（无译文时）
  - 点击“翻译/重译”按钮

代码锚点：
- CODE: `codex_sidecar/watch/rollout_ingest.py`（auto enqueue）
- CODE: `ui/app/interactions/thinking_rows.js`（UI 触发翻译）

### 9.3 provider：HTTP / OpenAI / NVIDIA 的核心差异

CFG: `translator_provider`
- 取值：`http` / `openai` / `nvidia`

HTTP：
- 面向“社区翻译接口”的通用适配器
- 既支持 urlencoded 也支持 JSON body
- token 支持 `{token}` URL 替换或 Authorization header 注入

OpenAI（Responses 兼容）：
- `base_url` 可留空（运行时回退 `https://api.openai.com/v1`）
- 支持 `Authorization: Bearer` 与 `x-api-key` 两种 auth 方式（由 UI 选择）

NVIDIA（Chat Completions 兼容）：
- 有 `rpm` 节流、`max_tokens`、`max_retries` 等运行策略
- model 选择受限（迁移会修正非法 model）

代码锚点：
- CODE: `codex_sidecar/translators/http.py`
- CODE: `codex_sidecar/translators/openai_responses_core.py`
- CODE: `codex_sidecar/translators/nvidia_chat_core.py`
- CODE: `codex_sidecar/control/translator_build.py`

### 9.4 脱敏与 reveal（为什么不会把 key 明文塞进 DOM）

原则：
- `GET /api/config` 返回的敏感字段全部脱敏
- 只有当用户点击“眼睛按钮”时，才对单字段做 reveal
- 后端保存配置时要避免把 `********` 写回文件

代码锚点：
- CODE: `codex_sidecar/http/config_payload.py`
- CODE: `codex_sidecar/security.py`
- CODE: `codex_sidecar/control/reveal_secret.py`
- CODE: `ui/app/control/wire/secrets.js`

---

## 10. 离线/历史文件百科（导入、展示、翻译缓存）

### 10.1 “导入对话”本质是在做什么

离线导入不是把文件“加载进服务端内存”，而是：

- UI 记录一个 `rel`（相对 `CODEX_HOME` 的 `sessions/.../rollout-*.jsonl`）
- 需要展示或导出时，再通过 `GET /api/offline/messages?rel=...` 临时读取解析
- 这样不会污染在线消息队列，也不需要服务端长期持有离线内容

代码锚点：
- CODE: `ui/app/control/wire/import_dialog.js`
- CODE: `codex_sidecar/http/routes_get.py:/api/offline/messages`
- CODE: `codex_sidecar/offline.py:build_offline_messages`

### 10.2 离线消息 id 为什么长得不一样（`off:...`）

离线消息的 id 规则：

- `id = off:{offline_key}:{sha1(rawLineBytes)}`
- 目的：
  - 避免与在线的 16-hex id 冲突（UI DOM id、缓存、导出逻辑都依赖 id）
  - raw-line hash 能抵抗“插入导致行号偏移”的变化

代码锚点：
- CODE: `codex_sidecar/offline.py:build_offline_messages`

### 10.3 离线译文缓存（为什么导出时也能补齐）

离线思考翻译会写入本机缓存：

- localStorage：`offlineZh:${rel}`（key 为 rel）
- 内存 Map：`state.offlineZhById`

导出时如果选择“译文”且离线消息无 `zh`，会尝试：
- 先读取本机缓存回填
- 仍无则调用 `POST /api/control/translate_text` 批量补齐并写回缓存

代码锚点：
- CODE: `ui/app/offline_zh.js`
- CODE: `ui/app/export.js`（离线导出补齐）

---

## 11. 导出（Markdown）百科（你复盘时拿到的文件长什么样）

### 11.1 导出不是“把 DOM 抄一遍”，而是走独立渲染链

导出为了稳定与可读性，通常不会直接复用 DOM：
- 重新拉取消息（在线/离线）
- 重新做 tool_call index（为了 tool_output 的结构化渲染）
- quick/full 按规则过滤 kinds
- 处理 Markdown fence 平衡与一些 HTML codeblock 兼容

代码锚点：
- CODE: `ui/app/export.js:exportThreadMarkdown`
- CODE: `ui/app/export/tool_calls.js`
- CODE: `ui/app/export/markdown_utils.js`

### 11.2 quick vs full（精简/全量）

- quick：只导出用户关心的块（由 quickBlocks 决定）
- full：导出所有已知 kind（并保留摘要/详情结构）

quickBlocks 的默认集合与 UI 快速浏览设置一致。

代码锚点：
- CODE: `ui/app/export/quick_blocks.js`
- CODE: `ui/app/quick_view_settings.js`

### 11.3 思考译文策略（en / zh / auto）

导出支持：
- `reasoningLang="en"`：只导出英文
- `reasoningLang="zh"`：优先导出中文；缺失时尝试导出时翻译补齐
- `reasoningLang="auto"`：有 zh 就用 zh，没有就用 en

导出时的“补齐翻译”是为了让“译文导出选项”真正有意义，而不是取决于你之前是否点过某条思考。

代码锚点：
- CODE: `ui/app/export.js`（`translateStat` 与补齐逻辑）
- CODE: `codex_sidecar/http/routes_post.py:/api/control/translate_text`

### 11.4 工具调用/输出与“更新计划”

导出会尽量 mirror UI 的行为：
- 某些 tool_call（如 `apply_patch`/`shell_command`）在 UI 中默认不渲染（因为 tool_output 更有价值）
- `update_plan` 会在 tool_call 侧渲染为“更新计划”，并抑制对应的 tool_output（避免重复）

代码锚点：
- CODE: `ui/app/export.js`
- CODE: `ui/app/export/tool_calls.js`

### 11.5 “导出从正文开始”是什么意思（你看到的文件不会带调试头）

导出生成的 Markdown 会在最后做一次“正文清理”：
- 去掉开头空行
- 折叠连续空行
- 不再插入调试信息头（例如请求/环境的 debug header）

代码锚点：
- CODE: `ui/app/export.js`（`bodyLines` 清理逻辑）

---

## 12. tool_gate（终端确认）百科（为什么能提醒“卡住了要你点批准”）

### 12.1 tool_gate 不是 rollout 原生消息

`tool_gate` 是 sidecar 派生的 `kind`，用于解决一个现实问题：

- 当某个工具调用需要“系统级权限审批”（例如需要你在终端批准），rollout 文件可能会**停止增长**；
- 如果只靠“新行出现”来触发 UI 更新，就会错过“正在等待你确认”的关键时刻。

因此 sidecar 在 ingest 过程中会：
- 识别“可能需要终端批准”的 tool_call
- 若在一定延迟后仍未看到对应 tool_output，则 emit `tool_gate waiting`
- 若之后看到了 tool_output，则 emit `tool_gate released`（附带 result/exit_code）

代码锚点：
- CODE: `codex_sidecar/watch/rollout_ingest.py:_ApprovalGateTracker`

### 12.2 判定逻辑与阈值（避免误报）

判定“需要终端批准”的依据（best-effort）：
- tool_call args 里出现 `sandbox_permissions=require_escalated` 或 `with_escalated_permissions=true`

延迟策略：
- 基础延迟：`_APPROVAL_WAIT_NOTIFY_DELAY_S = 1.25s`
- 若历史上观察到同一命令的“典型运行时长”（EMA），则延迟会取 `max(1.25, expected_runtime + cushion)`
  - 目的：避免“自动批准但命令本身长跑”被误报为“在等你批准”

代码锚点：
- CODE: `codex_sidecar/watch/rollout_ingest.py:_needs_terminal_approval`
- CODE: `codex_sidecar/watch/rollout_ingest.py:_APPROVAL_WAIT_NOTIFY_DELAY_S`

### 12.3 tool_gate 消息字段（UI 用来渲染通知条）

tool_gate 消息除了基础字段外，还会带：
- `gate_id`：call_id
- `gate_status`：`waiting` / `released`
- `gate_result`：`executed/released/rejected/aborted`（best-effort）
- `gate_exit_code`：可解析到时为 int，否则 null
- `gate_justification` / `gate_command`：从 args 提取并做脱敏

代码锚点：
- CODE: `codex_sidecar/watch/rollout_ingest.py:_extract_gate_context`
- CODE: `ui/app/events/stream.js`（通知条渲染与跳转）

---

## 13. 可靠性/多实例/自恢复百科

### 13.1 端口占用：为什么有时会“自动帮你清理旧 sidecar”

脚本层（`scripts/_common.sh`）会做一套相对保守的自恢复：

1) 如果健康检查 OK：说明服务端正常 → 直接打开 UI
2) 如果健康检查失败但锁被占用：
   - 读取锁文件里记录的 PID
   - 用 `ps` 读取该 PID 的 command line
   - 只有当 command line 看起来包含 `codex_sidecar` 时才会 kill（否则拒绝）
   - kill 后等待退出；超时才 SIGKILL

这套策略的原则是：**宁可要求你手动处理，也不冒误杀风险**。

代码锚点：
- CODE: `scripts/_common.sh:maybe_autorecover_port`

### 13.2 进程重启（UI long-press power）

UI long-press `powerBtn` 会触发 `POST /api/control/restart_process`：
- 服务端先返回 `{ok:true}`，再异步触发重启（避免响应被截断）
- CLI 最终会用 `subprocess.Popen` 或 `os.execv` 来实现重启

代码锚点：
- CODE: `codex_sidecar/http/routes_post.py:/api/control/restart_process`
- CODE: `codex_sidecar/cli.py`（restart 逻辑）

---

## 14. 安全与隐私百科（公开仓库必须写清）

### 14.1 最重要的安全边界（SSOT）

- sidecar **不**向 Codex 注入输入、不接管终端、不修改 rollout
- 配置默认落在项目内，避免误读机器别处的密钥
- `GET /api/config` 只返回脱敏视图；明文只可通过 reveal 单字段按需取回
- 离线读取只允许 `CODEX_HOME/sessions/**/rollout-*.jsonl`，不允许任意文件路径

代码锚点：
- CODE: `codex_sidecar/security.py`
- CODE: `codex_sidecar/http/config_payload.py`
- CODE: `codex_sidecar/offline.py:resolve_offline_rollout_path`

### 14.2 你需要自己做的事（避免密钥入仓）

- 确保 `config/sidecar/config.json` 不提交（项目已在 `.gitignore` 里默认忽略）
- 不把包含 token 的截图/日志贴进 issue（本文也不会写任何明文）

代码锚点：
- `.gitignore`

---

## 15. 开发者：代码导航（读代码从哪里开始）

### 15.1 后端（Python）建议阅读顺序

1) 入口与运行：
- `codex_sidecar/__main__.py`
- `codex_sidecar/cli.py`

2) 服务端：
- `codex_sidecar/server.py`
- `codex_sidecar/http/handler.py`
- `codex_sidecar/http/routes_get.py` / `routes_post.py`
- `codex_sidecar/http/state.py`

3) watcher 与抽取：
- `codex_sidecar/watcher.py`
- `codex_sidecar/watch/rollout_watcher_loop.py`
- `codex_sidecar/watch/rollout_tailer.py`
- `codex_sidecar/watch/rollout_extract.py`
- `codex_sidecar/watch/rollout_ingest.py`

4) follow（会话选择）：
- `codex_sidecar/watch/follow_picker.py`
- `codex_sidecar/watch/rollout_paths.py`

5) 翻译：
- `codex_sidecar/control/translator_build.py`
- `codex_sidecar/translators/*`
- `codex_sidecar/watch/translation_pump_core.py`

### 15.2 前端（UI）建议阅读顺序

1) 页面与入口：
- `ui/index.html`
- `ui/app/main.js`

2) 事件流与状态：
- `ui/app/state.js`
- `ui/app/events/stream.js`
- `ui/app/list/refresh.js`

3) 渲染：
- `ui/app/render/core.js`
- `ui/app/render/thinking/*`
- `ui/app/render/tool/*`

4) 控件 wiring（最关键的交互入口）：
- `ui/app/dom.js`
- `ui/app/control/wire.js`
- `ui/app/control/actions.js`
- `ui/app/control/config.js`

5) 离线/导出：
- `ui/app/offline_show.js`
- `ui/app/export.js`

---

## 16. 索引与一致性自检（给维护者用）

如果你需要“全量索引表”（UI 控件/Config 字段/API 端点），请看本文底部的：
- `附录 A / 附录 B / 附录 C / D 自检清单`（或对照 `README.DRAFT.md`）

维护建议（最小自检）：
- 改 UI：跑一遍 `ui/index.html` 的 `id=` 与 `ui/app/dom.js` 的 `byId(...)` 对齐（参照本文/`README.DRAFT.md` 的附录 A 覆盖规则）
- 改 API：对照 `codex_sidecar/http/routes_get.py` + `routes_post.py`，更新 API 索引
- 改 config：以 `codex_sidecar/config.py:SidecarConfig` 为 SSOT 同步附录 B；同时检查迁移 `config_migrations.py`

---

## 附录：KIND / UI / CFG / API 快速参考（内置）

> 说明：
> - 为了让本文在“百科全书”模式下也能快速定位关键事实，这里内置一份 **KIND / UI / CFG / API** 索引与自检清单（与 `README.DRAFT.md` 同源同步）。

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

> 说明：路由真相以 `codex_sidecar/http/routes_get.py` 与 `routes_post.py` 为准；SSE 在 `codex_sidecar/http/handler.py`。

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
