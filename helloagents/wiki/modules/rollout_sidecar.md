# rollout_sidecar

## 职责
提供一个**不修改 Codex** 的旁路工具：实时监听 `CODEX_HOME` 下的 `rollout-*.jsonl`（结构化会话记录），提取思考摘要（`reasoning.summary`）与可选的 `agent_reasoning`，并将原文/译文推送到本地 HTTP 服务（含 SSE/Web UI）便于实时查看与调试。

## 输入/输出
- 输入：`CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`（追加写入的 JSONL）
- 输出：本地服务端（默认 `127.0.0.1:8787`）
  - `GET /ui`：浏览器实时面板（含配置/控制）
  - `GET /events`：SSE（可供其它客户端订阅）
  - `GET /api/messages`：最近消息 JSON（调试）
  - `GET /api/threads`：按 `thread_id/file` 聚合的会话列表（用于 UI 标签切换）

## 时间戳说明
- `rollout-*.jsonl` 里的 `timestamp` 通常是 UTC（形如 `...Z`）。
- UI 默认以北京时间（Asia/Shanghai）展示时间戳，减少 UTC/本地对照带来的视觉噪音（原始 timestamp 仍保留在数据中，便于必要时排查）。

## 关键实现点
- 只读解析 JSONL（不改写原始日志）
- 轮询 + 增量读取（按 offset tail），支持启动时回放尾部 N 行
- 代码分层：`watcher.py` 聚焦主流程；`watch/*` 承载“跟随策略/进程扫描/翻译批处理与队列”等可复用组件
  - 其中 `watch/rollout_extract.py` 负责“单条 JSONL 记录 → UI 事件块”提取（assistant/user/tool/reasoning）
- 可选：WSL2/Linux 下支持“进程优先定位”当前会话文件
  - 扫描 `/proc/<pid>/fd`，优先锁定匹配到的 Codex 进程（及其子进程）正在写入的 `sessions/**/rollout-*.jsonl`
  - 并保留 sessions 扫描作为回退（用于进程已启动但文件尚未被发现的窗口期）
- UI 顶栏：标题与运行状态
- UI 右侧工具栏：⚙️ 配置、▶️ 开始监听、⏹️ 停止监听、🔄 重启 Sidecar、🧹 清空显示、⏻ 退出 Sidecar
- UI 配置抽屉：保存配置、恢复配置
- UI 会话切换：会话列表固定在左侧 sidebar（默认自动隐藏，鼠标移到最左侧热区浮现），支持会话自定义标签（右键/双击会话项设置）
- 侧栏性能：会话列表渲染做了降频与增量更新（复用 tab 节点），降低高频 SSE 下的重排/重绘
- 长列表刷新：对较早消息行延后装饰（idle 分片 `decorateRow`），避免一次性加载/切换时卡顿
- 多会话切换性能：消息列表按会话 key 做视图缓存；非当前会话的 SSE 仅对“已缓存视图”的会话进行缓冲，切回时回放到对应视图（溢出/切到 all 时自动回源刷新）
- 断线恢复：浏览器 SSE 重连后会自动回源同步当前视图，并标记缓存视图在下次切换时回源刷新（避免长时间挂着漏消息）
- 会话列表同步：断线恢复后会标记 `threadsDirty`，下一次列表回源时同步 `/api/threads`，避免侧栏漏会话/排序漂移
- 翻译 Provider 可插拔并可在 UI 中切换：`stub/none/http/openai`
- `--include-agent-reasoning` 说明：
  - 该类型通常是“流式推理文本”，同一段内容可能重复出现（模型/客户端实现差异）。
  - sidecar 会对 `agent_reasoning` 做更激进的去重（不依赖 timestamp），但仍建议仅在需要更实时内容时开启。

## UI 展示内容与翻译策略
- UI 现在会展示更多事件类型：用户输入（`user_message`）、工具调用与输出（`tool_call` / `tool_output`）、最终回答（`assistant_message`）、思考摘要（`reasoning_summary`）。
- 翻译策略：仅对“思考内容”（`reasoning_summary` / 可选 `agent_reasoning`）进行翻译；工具输出与最终回答不翻译。
- 展示顺序：列表按时间从上到下（新内容在底部）；工具输出默认折叠展示。
- tool_call/tool_output 会做友好格式化（例如 `update_plan` 计划分行、`shell_command` 命令块展示）；原始参数/输出仍可展开查看，便于排障。
- UI 辅助：右下角悬浮“↑ 顶部 / ↓ 底部”按钮，便于快速跳转。

## 关于“在页面内输入并让 Codex 执行”
本 sidecar 的核心原则是**不修改 Codex、只读监听**（旁路查看/调试）。因此：
- 纯旁路情况下，Web UI **无法可靠地把输入“注入”到正在运行的 Codex TUI 会话**（缺少官方可写 API/IPC，且 pty 注入复杂/脆弱）。
- 本项目不提供任何“在浏览器里触发本机执行”的控制入口，避免把旁路 UI 变成远程执行面。

更“非侵入”的替代思路（更安全、也更贴合旁路定位）仍然有价值：
- UI 提供“导出为 .md/.txt”以便归档或回放，而不直接执行任何本机命令（避免 Web UI 变成远程执行入口）。

## 运行方式（WSL 示例）
- 推荐（短命令，先开 UI 再开始监听）：
  - `cd ~/src/codex-thinking-sidecar-zh && ./ui.sh`
  - 打开 `http://127.0.0.1:8787/ui`，点右侧工具栏 ⚙️ 保存配置，再点 ▶️ 开始监听

- 兼容（启动即监听，命令行参数方式）：
  - `cd ~/src/codex-thinking-sidecar-zh && ./run.sh --codex-home "$HOME/.codex" --port 8787 --replay-last-lines 5000 --include-agent-reasoning`

## 配置持久化与多翻译 Profiles
- UI 中点击“保存配置”会将配置写入用户级配置目录（XDG）：
  - 默认：`$XDG_CONFIG_HOME/codex-thinking-sidecar/config.json`
  - 常见路径：`~/.config/codex-thinking-sidecar/config.json`
- 下次启动 `./ui.sh` 或 `./run.sh` 时会自动读取并沿用已保存配置（`./run.sh` 会立即开始监听）。
- 当翻译 Provider 选择 `HTTP` 时，可在 `HTTP Profiles` 中保存多个翻译 API 配置并手动切换（支持新增/删除）。
  - `HTTP Profiles` 支持在 UI 中新增/删除/重命名配置。
  - DeepLX 等“token 在 URL 路径里”的接口：将 URL 写为 `https://api.deeplx.org/{token}/translate`，并在 `HTTP Token` 中填写 token，sidecar 会自动替换 `{token}`。
  - ⚠️ token 会随配置一起持久化到本机配置文件中；请勿把包含 token 的配置文件加入版本控制。
- 为避免误操作丢失翻译配置，sidecar 会在保存前自动生成 1 份备份（覆盖式）：
  - `config.json.bak`
- 如遇到“Profiles 变空/配置丢失”，UI 会提示是否从备份恢复；也可手动点击“恢复配置”。
- 兼容说明：旧版本写入在 `CODEX_HOME/tmp/` 下的 `.lastgood` / `.bak-*` 仍会被纳入恢复候选来源（只读，不再继续写入）。

## UI 显示模式
UI 支持三种显示模式：`中英文对照 / 仅中文 / 仅英文`（保存在浏览器 localStorage，不写入配置文件）。

## GPT（Responses API 兼容）配置（right.codes 中转站）
当翻译 Provider 选择 `GPT（Responses API 兼容）`（`openai`）时，sidecar 会按 OpenAI Responses API 兼容格式发起翻译请求。

推荐配置（right.codes 示例）：
- `Base URL`：`https://www.right.codes/codex/v1`（sidecar 会自动 POST 到 `${Base URL}/responses`）
- `Auth Header`：支持 `Authorization: Bearer` 或 `x-api-key`（二选一）
- `Model`：优先使用你在 `/codex/v1/models` 里看到“可用”的模型。部分 right.codes 的 **ChatGPT 账号**在 Codex 网关下可能不支持 `gpt-4o-mini`，可先用 `gpt-5.2` 作为保底。
- `Reasoning`：翻译通常不需要；仅当使用 `gpt-5*` / `o*` 推理模型时才建议设置为 `minimal/none`

配置保存策略（避免互相覆盖）：
- sidecar 会把不同 Provider 的配置分区保存到 `translator_config.http` / `translator_config.openai`，切换 Provider 不会覆盖另一边的配置。

性能与请求量（避免“翻译 API 占用太多请求”）：
- sidecar 会先对消息做去重，再进行翻译请求（重复内容不会反复打到翻译 API）。
- `openai` Provider 内置小型 LRU 缓存（默认 64 条），同一段文本多次出现时会复用译文。
- UI 选择 `openai` Provider 时会自动补齐默认 `Base URL`（right.codes）与默认 `Model`（right.codes 场景默认 `gpt-5.2`），减少手动输入。

## 配置生效提示
sidecar 的监听线程启动时会读取一次配置；若在“已开始监听”状态下修改翻译配置，需重启监听后才会生效（UI 会提示是否重启）。

## 硅基流动 translate.json 配置（免费优先）
硅基流动的 translate.js 提供了 `translate.json`（表单提交）接口。sidecar 已对该接口做兼容：仍使用 `HTTP（通用适配器）`，仅需把 URL 指向 `translate.json`。

- `HTTP URL`：`https://siliconflow.zvo.cn/translate.json?to=chinese_simplified`
- `HTTP Token/Auth ENV`：留空
- 语言参数：通过 URL query 传入 `to` / `from`（未传 `from` 默认 `auto`）
