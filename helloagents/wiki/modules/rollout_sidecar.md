# rollout_sidecar

## 职责
提供一个**不修改 Codex** 的旁路工具：实时监听 `CODEX_HOME` 下的 `rollout-*.jsonl`（结构化会话记录），提取思考摘要（`reasoning.summary`），并将原文/译文推送到本地 HTTP 服务（含 SSE/Web UI）便于实时查看与调试。

## 输入/输出
- 输入：`CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`（追加写入的 JSONL）
- 输出：本地服务端（默认 `127.0.0.1:8787`）
  - `GET /ui`：浏览器实时面板（含配置/控制）
  - `GET /events`：SSE（可供其它客户端订阅）
  - `GET /api/messages`：最近消息 JSON（调试）
  - `GET /api/threads`：按 `thread_id/file` 聚合的会话列表（用于 UI 标签切换）

## 时间戳说明
- `rollout-*.jsonl` 里的 `timestamp` 通常是 UTC（形如 `...Z`）。
- UI 默认使用**浏览器本地时区**展示时间戳（在国内环境通常为 Asia/Shanghai），减少 UTC/本地对照带来的视觉噪音（原始 timestamp 仍保留在数据中，便于必要时排查）。

## 关键实现点
- 只读解析 JSONL（不改写原始日志）
- 轮询 + 增量读取（按 offset tail），支持启动时回放尾部 N 行
- 多会话并行 tail：默认同时跟随最近 N 个会话文件（配置项 `watch_max_sessions`，默认 3），用于“至少 3 个会话同时实时更新”；锁定（pin）仅影响主跟随，不阻断后台摄取与侧栏会话发现
- 代码分层：`watcher.py` 聚焦主流程；`watch/*` 承载“跟随策略/进程扫描/翻译批处理与队列”等可复用组件
  - 其中 `watch/rollout_extract.py` 负责“单条 JSONL 记录 → UI 事件块”提取（assistant/user/tool/reasoning）
- 服务端分层：`server.py` 仅负责启动/绑定；HTTP 路由、SSE 与静态资源拆分到 `http/*`
- 控制面分层：`controller.py` 聚焦线程生命周期/配置入口；translator schema/构建与校验拆分到 `control/*`

> 注：下文涉及 `ui/app/*` 的“分层/模块拆分”描述对应当前默认 UI（`ui/`）；此前尝试过 UI v2（Vue 3 + Vite + Pinia），现已归档到 `old/`（不再提供路由入口）。
- 可选：WSL2/Linux 下支持“进程优先定位”当前会话文件
  - 扫描 `/proc/<pid>/fd`，优先锁定匹配到的 Codex 进程（及其子进程）正在写入的 `sessions/**/rollout-*.jsonl`
  - 并保留 sessions 扫描作为回退（用于进程已启动但文件尚未被发现的窗口期）
- UI 顶栏：标题 + 极简状态（监听/会话数/翻译/精简…）；悬停可见当前跟随的会话列表（短时间戳 + shortId，完整路径仅作为 tooltip）
- UI 右侧工具栏：⚙️ 设置、⚡ 快速信息（快速浏览开关）、🌐 翻译（点击开关，长按设置）、▶/⏹️ 监听（开始/停止切换）、🧹 清空消息、⏻ 关闭（长按重启）
- 交互提示：右侧工具栏按钮 hover/聚焦会显示文字提示；🌐 翻译按钮带“自动翻译开/关”状态点并在提示中注明“长按打开翻译设置”
- UI 设置抽屉：常用配置 + “高级选项”折叠；保存配置/调试信息；皮肤切换（默认/柔和/对比/扁平/深色，仅影响前端观感，本机记忆）
- UI 会话切换：左侧为“自动隐藏会话列表”（鼠标移到最左侧热区浮现、离开自动隐藏；覆盖式浮层，不占用主列表宽度）；列表项展示短时间戳（MM-DD HH:MM）+ shortId，hover 提示完整时间戳 + shortId；单击切换会话；长按在原位重命名（Enter/失焦提交，Esc 取消）
  - 选中即锁定跟随（pin-on-select）：开启时切换会话会向后端发送 `follow=pin`；关闭时仅切换视图并释放为 `follow=auto`，避免“监听跑偏/新会话不出现”的错觉
- UI 未读提醒：回答输出/审批提示计入未读；未读数显示在对应会话书签徽标上，“全部”书签显示总未读；切换到会话时自动清空该会话未读
- 会话列表性能：书签渲染做了降频与增量更新（复用节点），降低高频 SSE 下的重排/重绘
- UI 事件流分层：`ui/app/events/*`（timeline/buffer/stream）拆分，便于维护与进一步优化
- 刷新期保护：刷新列表期间 SSE 会暂存到 `ssePending`；若积压过大则触发溢出兜底，刷新结束后自动回源同步一次
- UI 装饰分层：长按复制/复制反馈由 `decorate/copy_hold.js` 负责；工具“详情/收起”切换由 `decorate/tool_toggle.js` 负责；`decorate/core.js` 仅做装饰编排
- UI 会话栏分层：会话标签持久化拆到 `sidebar/labels.js`；书签渲染与交互在 `sidebar/tabs.js`；`sidebar.js` 作为 facade
- UI 工具函数分层：`utils/*`（time/id/color/json/clipboard/error），`utils.js` 作为 facade
- UI 格式化分层：`format/wrap/*`（command/lines/tree/rg/output），`format/wrap.js` 作为 facade
- UI 列表分层：`list/*`（threads/refresh/bootstrap），`list.js` 作为 facade
- UI 工具渲染分层：`render/tool/*`（call/output），`render/tool.js` 作为 facade
- 长列表刷新：对较早消息行延后装饰（idle 分片 `decorateRow`），避免一次性加载/切换时卡顿
- 多会话切换性能：消息列表按会话 key 做视图缓存；非当前会话的 SSE 仅对“已缓存视图”的会话进行缓冲，切回时回放到对应视图（溢出/切到 all 时自动回源刷新）；其中 `op=update`（译文回填）会按消息 id 覆盖合并，避免缓冲被大量回填顶爆
- 断线恢复：浏览器 SSE 重连后会自动回源同步当前视图，并标记缓存视图在下次切换时回源刷新（避免长时间挂着漏消息）
- 会话列表同步：断线恢复后会标记 `threadsDirty`，下一次列表回源时同步 `/api/threads`，避免侧栏漏会话/排序漂移
- 多会话不串线：推荐通过会话书签栏切换（或启用“锁定”）来浏览单会话；`all` 视图更适合快速总览（不再在每条消息上额外展示会话标识，避免信息噪音）
- 翻译 Provider 可插拔并可在 UI 中切换：`http/openai/nvidia`（旧配置中的 `stub/none` 会自动迁移到 `openai`）
## UI 展示内容与翻译策略
- UI 现在会展示更多事件类型：用户输入（`user_message`）、工具调用与输出（`tool_call` / `tool_output`）、最终回答（`assistant_message`）、思考摘要（`reasoning_summary`）。
- 翻译策略：仅对“思考摘要”（`reasoning_summary`）进行翻译；工具输出与最终回答不翻译。
- 展示顺序：列表按时间从上到下（新内容在底部）；工具输出默认折叠展示。
- tool_call/tool_output 会做友好格式化（例如 `update_plan` 计划分行、`shell_command` 命令块展示）；原始参数/输出仍可展开查看，便于排障。
- tool_call/tool_output 不展示 `call_id`（仅用于内部关联 tool_call ↔ tool_output），避免 UI 出现无意义的 uuid 干扰阅读。
- 快速浏览：开启 ⚡ 后仅显示 输入/输出/思考 + 更新计划（`update_plan`）块，其余类型隐藏（不影响摄取与时间线）。
- Tool gate 提示来源：
  - ✅ 优先：`codex-tui.log`（真实 “waiting for tool gate / released”）
  - ⚠️ 辅助：tool_call 参数中出现权限升级字段时的“可能需要终端确认”提示（不等同于 tool gate 状态，是否需要批准以终端为准）
  - `justification` 字段来源：来自 tool_call 的参数（由 Codex 生成，用于解释“为什么要执行该命令/操作”）
- UI 辅助：
  - 右下角悬浮“↑ 顶部 / ↓ 底部”按钮，便于快速跳转（底部按钮不再承载未读提示）
- 右下角通知：tool gate / 回答新输出等关键状态弹出提醒（含“可能是历史残留”的提示）；新输出未读以右侧书签徽标为准
- 右侧“翻译”按钮：单击切换自动翻译 `auto/manual`（对运行中的 watcher 立即生效，无需重启）；长按打开独立的“翻译设置”抽屉（含自动翻译开关、Provider/模型/Key/超时等）
  - 提示音：设置中可选择“无/提示音-1/2/3（轻/中/强）”，用于“回答输出/审批提示”的通知（选择后会播放预览；音效来源：Kenney UI SFX Set，CC0；文件在 `ui/music/`）

## 关于“在页面内输入并让 Codex 执行”
本 sidecar 的核心原则是**不修改 Codex、只读监听**（旁路查看/调试）。因此：
- 纯旁路情况下，Web UI **无法可靠地把输入“注入”到正在运行的 Codex TUI 会话**（缺少官方可写 API/IPC，且 pty 注入复杂/脆弱）。
- 本项目不提供任何“在浏览器里触发本机执行”的控制入口，避免把旁路 UI 变成远程执行面。

更“非侵入”的替代思路（更安全、也更贴合旁路定位）仍然有价值：
- UI 以旁路查看/复制为主；如需归档可手动复制（后续可再补“导出为 .md/.txt”入口），而不直接执行任何本机命令（避免 Web UI 变成远程执行入口）。

## 运行方式（WSL 示例）
- 推荐（短命令，先开 UI 再开始监听）：
  - 在仓库根目录执行：`./ui.sh`
  - 打开 `http://127.0.0.1:8787/ui`，点右侧工具栏 ⚙️ 保存配置，再点 ▶/⏹️ 监听（点击切换开始/停止）

- 兼容（启动即监听，命令行参数方式）：
  - 在仓库根目录执行：`./run.sh --codex-home "$HOME/.codex" --port 8787 --replay-last-lines 5000`

## 配置持久化与多翻译 Profiles
- UI 中点击“保存配置”会将配置写入项目目录内（默认放在仓库根目录下）：
  - 实际配置（本机使用，已加入 `.gitignore`）：`./config/sidecar/config.json`
  - 示例配置（可提交/发布，无敏信息）：`./config/sidecar/config.example.json`
- 下次启动 `./ui.sh` 或 `./run.sh` 时会自动读取并沿用已保存配置（`./run.sh` 会立即开始监听）。
- 当翻译 Provider 选择 `HTTP` 时，可在 `HTTP Profiles` 中保存多个翻译 API 配置并手动切换（支持新增/删除）。
  - `HTTP Profiles` 支持在 UI 中新增/删除/重命名配置。
  - DeepLX 等“token 在 URL 路径里”的接口：将 URL 写为 `https://api.deeplx.org/{token}/translate`，并在 `HTTP Token` 中填写 token，sidecar 会自动替换 `{token}`。
  - ⚠️ token 会随配置一起持久化到本机配置文件中；请勿把包含 token 的配置文件加入版本控制（本项目默认已忽略 `config.json`）。
- 已移除“从备份恢复”功能：避免误用导致配置混乱；如需调整翻译配置请直接修改并保存。

### 脱敏与“显示原文”
- 为便于截图/发布与避免误泄露：`/api/config` 与 `/api/status` 返回的配置会默认脱敏：
  - `openai`: `base_url` + `api_key` 仅显示 `********`
  - `nvidia`: 仅 `api_key` 脱敏（`base_url` 保留）
  - `http`: `token` 脱敏
- UI 中点击输入框右侧的“眼睛按钮”会按需取回并显示原文（只取回单个字段，不会返回整份配置）。
## 翻译模式（auto/manual）
- `auto`：自动翻译思考摘要（`reasoning_summary`）。未译时默认显示英文原文；译文回填后默认切到中文；单击思考块可在 EN/ZH 间切换。
- `manual`：不自动翻译；仅当你单击思考块或点击“翻译/重译”按钮时才会发起翻译请求。UI 侧会做 in-flight 防抖；当某条仍在翻译中再次点击“重译”时，会将重译请求加入队列（等待当前翻译完成后执行）。
- 失败处理：翻译失败（超时/空译文等）不会把告警写进 `zh` 内容区；会以 `translate_error` 字段回填，UI 状态 pill 显示“失败/重试”，可点击按钮重新发起翻译。

常见失败原因与建议：
- timeout 太小：会导致大量 `translate_error=timeout` 并让 UI 长时间显示“ZH 翻译中…”。建议：
  - `HTTP`：`3s~8s` 起步（取决于上游接口）
  - `openai`：`8s~20s` 起步（取决于模型/网关）
- 批量翻译解包缺失：通常来自上游把 marker 行改写/翻译。`openai` Provider 已对 marker prompt 做“原样发送”以降低该风险；如仍出现，可先调大 timeout 或改用更稳定的上游翻译接口。

## GPT（Responses API 兼容）配置（right.codes 中转站）
当翻译 Provider 选择 `GPT（Responses API 兼容）`（`openai`）时，sidecar 会按 OpenAI Responses API 兼容格式发起翻译请求。

推荐配置（right.codes 示例）：
- `Base URL`：`https://www.right.codes/codex/v1`（sidecar 会自动 POST 到 `${Base URL}/responses`）
- `Auth Header`：支持 `Authorization: Bearer` 或 `x-api-key`（二选一）
- `Model`：优先使用你在 `/codex/v1/models` 里看到“可用”的模型。部分 right.codes 的 **ChatGPT 账号**在 Codex 网关下可能不支持 `gpt-4o-mini`，可先用 `gpt-5.2` 作为保底。
- `Reasoning`：翻译通常不需要；仅当使用 `gpt-5*` / `o*` 推理模型时才建议设置为 `minimal/none`

配置保存策略（避免互相覆盖）：
- sidecar 会把不同 Provider 的配置分区保存到 `translator_config.http` / `translator_config.openai` / `translator_config.nvidia`，切换 Provider 不会覆盖另一边的配置。

性能与请求量（避免“翻译 API 占用太多请求”）：
- sidecar 会先对消息做去重，再进行翻译请求（重复内容不会反复打到翻译 API）。
- `openai` Provider 内置小型 LRU 缓存（默认 64 条），同一段文本多次出现时会复用译文。
- 回放/积压导入期支持“同一会话 key 内批量翻译”（默认最多 5 条/批）：通过 `watch/translate_batch.py` 的 marker 协议打包/解包，避免跨会话串流。
- `openai` Provider 在检测到批量 marker prompt 时会原样发送（不再额外包裹通用翻译 prompt），确保 marker 不被翻译/改动从而可稳定解包。
- UI 选择 `openai` Provider 时会自动补齐默认 `Base URL`（right.codes）与默认 `Model`（right.codes 场景默认 `gpt-5.2`），减少手动输入。

## 配置生效提示
翻译相关配置（`translate_mode`、`translator_provider`、`translator_config.*`）已支持**热加载**：在“已开始监听”状态下保存后会立即对新翻译请求生效，无需重启进程/会话。

注：监视目录（`watch_codex_home` / `CODEX_HOME`）仅能通过启动参数或环境变量调整；切换后需“停止监听 → 再开始监听”（或重启进程）才会生效。其余大多数 watcher 参数已支持运行时热更新。

## UI v2（Vue 3 + Vite）

UI v2 已归档（默认不启用），仅保留作为历史参考：

- 归档目录：`old/tools/codex_thinking_sidecar/codex_thinking_sidecar/ui_v2/`
- 路由入口：不再提供 `/ui-v2`（仅保留源码归档）

## 配置项速查（Watcher）
- `进程定位`：开启后会根据进程（`/proc/<pid>/fd`）定位 Codex **实际打开**的 `rollout-*.jsonl`，并只跟随这些文件（最多 N 个），更稳定也更省资源（不会为了“补齐 N”再去扫描 `sessions/**`）。
- `仅在有进程时跟随`：开启后若未检测到匹配的 Codex 进程，则 sidecar 会进入 idle（不跟随任何文件）；关闭则会回退为 sessions 扫描（仍可看到最新会话）。注：若检测到进程但暂未发现其打开的 rollout 文件，会进入 `wait_rollout` 等待文件出现（不扫 sessions）。
- `进程匹配 regex`：用于匹配 Codex 进程命令行（默认 `codex`），只影响“进程定位”的检测范围。
  - 进程检测优先按 `/proc/<pid>/exe` basename 与 argv0 匹配，只有在无法判断时才回退到整条 cmdline 匹配；UI 状态里的 `pid:` 默认展示“确实打开了 rollout 的 pid”（更干净），候选 pid 仅在调试信息里展示。
- `poll（秒）`：主循环轮询间隔（越小越实时，但 CPU/IO 更高）。
- `scan（秒）`：会话文件/进程 fd 扫描间隔（越小越快发现新会话，但开销更高）。

## 硅基流动 translate.json 配置（免费优先）
硅基流动的 translate.js 提供了 `translate.json`（表单提交）接口。sidecar 已对该接口做兼容：仍使用 `HTTP（通用适配器）`，仅需把 URL 指向 `translate.json`。

- `HTTP URL`：`https://siliconflow.zvo.cn/translate.json?to=chinese_simplified`
- `HTTP Token`：留空（如无需要）
- 语言参数：通过 URL query 传入 `to` / `from`（未传 `from` 默认 `auto`）
