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
  - `GET /api/offline/files`：列出可选的历史 `rollout-*.jsonl`（严格限制在 `CODEX_HOME/sessions/**`）
  - `GET /api/offline/messages`：按 `rel` 只读解析离线文件并返回与 `/api/messages` 相同 schema（不进入实时 state，不触发未读/提示音）
  - `POST /api/control/translate_text`：通用文本翻译（不依赖 SidecarState / watcher，Live/Offline 共用；支持单条 `text` 或批量 `items`）
  - `POST /api/offline/translate`：兼容入口（内部同样走 `translate_text`）

## 离线展示（展示中）
离线能力用于“只读回看/归档/导出”，不进入 watcher 的跟随集合，不产生未读/提示音，也不会触发 `/api/control/follow`。

- UI 结构
  - 底部双标签栏：上方为“展示标签栏”（离线），下方为“会话标签栏”（实时监听）
  - 会话管理抽屉：`监听中` / `展示中` / `关闭监听` 三列表分区
  - 导入入口：右侧工具栏“导入对话”（弹窗中可输入 `rel`，或用日历组件 Air Datepicker 按年月日浏览 `sessions/YYYY/MM/DD` 并通过数量角标选择文件）
- 关键标识与本机缓存
  - 离线 key：`offline:${encodeURIComponent(rel)}`（服务端与前端一致）
  - 离线消息 id：`off:${key}:${sha1(rawLine)}`
  - 展示中列表：`localStorage offlineShow:1`（持久化保存 `rel`）
  - 离线译文缓存：`localStorage offlineZh:${rel}`（`{ [msg_id]: zh }`）

## 时间戳说明
- `rollout-*.jsonl` 里的 `timestamp` 通常是 UTC（形如 `...Z`）。
- UI 默认使用**浏览器本地时区**展示时间戳（在国内环境通常为 Asia/Shanghai），减少 UTC/本地对照带来的视觉噪音（原始 timestamp 仍保留在数据中，便于必要时排查）。

## 关键实现点
- 只读解析 JSONL（不改写原始日志）
- 轮询 + 增量读取（按 offset tail），支持启动时回放尾部 N 行
- 多会话并行 tail：默认同时跟随最近 N 个会话文件（配置项 `watch_max_sessions`，默认 3），用于“至少 3 个会话同时实时更新”；锁定（pin）会固定主跟随；在启用“进程跟随”时 pin 模式仅从**当前进程打开的 rollout 文件**补齐并行会话（不再按 sessions mtime 补齐，避免“僵尸会话”）
- 代码分层：`watch/rollout_watcher.py` 聚焦主流程（`watcher.py` 仅作为向后兼容的 facade）；`watch/*` 承载“跟随策略/进程扫描/解析/去重/tail/翻译队列”等可复用组件
  - `watch/rollout_extract.py`：单条 JSONL 记录 → UI 事件块提取（assistant/user/tool/reasoning）
  - `watch/dedupe_cache.py`：轻量去重缓存（rollout 与 TUI gate 共享一套去重语义）
  - `watch/tui_gate_helpers.py`：TUI gate 的时间戳拆分/ToolCall 解析/脱敏/Markdown 生成（供 tailer 调用），便于单测与复用（行为保持不变）
  - `watch/rollout_ingest.py`：rollout 单行解析/去重/工具门禁提示/翻译入队（watcher 只负责调度）
  - `watch/rollout_tailer.py`：文件 replay/poll 的通用 tail 逻辑（按 offset 增量读取）
  - `watch/rollout_follow_state.py`：follow targets → cursors/primary 的落地逻辑（cursor 初始化/回放/active 标记），从 watcher 抽离保持行为不变
  - `watch/follow_targets.py`：follow targets 计算（process/pin/auto + excludes），降低 watcher 内联分支耦合
  - `watch/follow_control_helpers.py`：follow 控制面输入清洗（pin 文件解析 + excludes 清洗），供 `RolloutWatcher` 复用（行为保持不变）
  - `watch/process_follow_scan.py`：进程强匹配扫描/进程树收集/rollout fd 解析（供 `FollowPicker` 复用），降低 follow_picker 内联复杂度（行为保持不变）
  - `watch/translation_queue.py`：翻译队列状态机（seen/inflight/force_after + 背压丢弃时的 inflight 清理）
  - `watch/translation_batch_worker.py`：批量翻译执行/解包/回退逻辑抽离，`TranslationPump` 更聚焦队列调度与统计（行为保持不变）
  - `watch/translation_pump_batching.py`：从 lo 队列聚合 batch（同 key 批量翻译）与不同 key 回退 pending 的规则抽离，便于单测与维护（行为保持不变）
- 服务端分层：`server.py` 仅负责启动/绑定；HTTP Handler（SSE/静态资源/通用响应）与路由分发拆分到 `http/*`（GET/POST 路由分别在 `http/routes_get.py`、`http/routes_post.py`）
- 控制面分层：`controller_core.py` 聚焦线程生命周期/配置入口（`controller.py` 仅作为向后兼容的 facade）；translator schema/构建与校验拆分到 `control/*`，配置 patch/校验抽到 `control/config_patch.py`，密钥按需读取抽到 `control/reveal_secret.py`，翻译控制面公共逻辑抽到 `control/translate_api.py`，watcher 组装抽到 `control/watcher_factory.py`
- UI 控制层：`ui/app/control/wire.js` 作为事件 wiring 入口，按功能域拆分到 `ui/app/control/wire/*`（例如 `ui_hints.js`、`import_dialog.js`），降低单文件耦合与复杂度。

> 注：下文涉及 `ui/app/*` 的“分层/模块拆分”描述对应当前默认 UI（`ui/`）；此前尝试过 UI v2（Vue 3 + Vite + Pinia），现已归档到 `old/`（不再提供路由入口）。
- 可选：WSL2/Linux 下支持“进程优先定位”当前会话文件
  - 扫描 `/proc/<pid>/fd`，优先锁定匹配到的 Codex 进程（及其子进程）正在写入的 `sessions/**/rollout-*.jsonl`
  - 并保留 sessions 扫描作为回退（用于进程已启动但文件尚未被发现的窗口期）
- UI 顶栏：仅标题（顶部右侧状态汇总条已移除，避免信息噪音）
- UI 右侧工具栏：⚙️ 设置、📥 导入对话、⚡ 快速信息（快速浏览开关）、🌐 翻译（点击开关，长按设置）、▶/⏹️ 监听（开始/停止切换）、🧹 清空消息、⏻ 关闭（长按重启）
- 交互提示：图标按钮不再弹出 hover tooltip（减少遮挡与误解）；`aria-label` 仅用于无障碍读屏。底部标签栏 hover 提示使用信息栏（重命名/关闭监听），不再弹浮动提示
- UI 设置抽屉：常用配置 + “监听设置”折叠；保存配置；皮肤切换（默认/柔和/对比/扁平/深色，仅影响前端观感，本机记忆）；字体大小/按钮大小（本机记忆，实时预览，不弹出额外提示）
- 精简显示设置：独立弹窗（可自定义精简模式下显示的内容块），长按右侧 ⚡ 打开；再次长按可自动关闭；也可点右上角 `×` 关闭；默认勾选：用户输入/回答/思考摘要/终端确认/更新计划
- 破坏性操作确认：退出/重启/删除 Profile 等使用统一确认弹窗（AlertDialog 语义），避免浏览器 `confirm()` 抢焦点
- 表单错误提示：保存失败/缺字段在抽屉内就地提示（并高亮对应字段），减少 `alert()` 打断阅读
- 无障碍/适配：fixed 元素尊重 `safe-area-inset`；支持 `prefers-reduced-motion` 降级；触控设备（pointer: coarse）下自动放大触控目标
- 体验优化：通过 `scrollbar-gutter: stable` 预留滚动条槽位，避免弹窗打开/关闭（`body.popup-open { overflow: hidden; }`）或精简模式切换时滚动条出现/消失导致右侧控件“抖动/位移”。
- UI 会话切换：底部为“浏览器标签栏”式会话标签（横向滚动，始终可见当前会话）；标签宽度按内容自适应增长，超过上限后才截断并显示省略号；**标签顺序保持稳定（不会随新消息重排）**，并尽量保持横向滚动位置，避免 SSE 频繁刷新导致“来回跳”；长按标签重命名；`×` 临时关闭监听（该会话有新输出时会自动回到标签栏）；右键可将会话从标签栏移除/恢复；右下角菜单按钮打开“会话管理”抽屉（四按钮：重命名/导出/监听/清除（仅本次进程内临时从列表隐藏；有新输出或重启后自动回来）；导出按钮角标显示导出偏好：精简=闪电、译文=地球；长按导出按钮打开“导出设置”弹窗；会话行长按可复制源 json 路径（不再弹出“已复制”提示））
- UI 展示名单：会话管理抽屉新增“展示名单”区，可主动打开历史 `rollout-*.jsonl`；打开后以 `offline:*` 会话进入标签栏（标签/列表会显示“离线”标识），但不会改变实时 follow 选择。
  - 选中即锁定跟随（pin-on-select）：开启时切换会话会向后端发送 `follow=pin`；关闭时仅切换视图并释放为 `follow=auto`，避免“监听跑偏/新会话不出现”的错觉
- UI 未读提醒：回答输出计入未读；未读数显示在对应会话标签徽标上（避免遮挡标签名字/关闭按钮）；点击带未读的会话书签会跳到该会话**最早未读**，在当前会话再次点击会继续跳到**下一条未读**，直到看完为止
- 会话列表性能：书签渲染做了降频与增量更新（复用节点），降低高频 SSE 下的重排/重绘
- UI 事件流分层：`ui/app/events/*`（timeline/buffer/stream）拆分，便于维护与进一步优化
- 刷新期保护：刷新列表期间 SSE 会暂存到 `ssePending`；若积压过大则触发溢出兜底，刷新结束后自动回源同步一次
- UI 装饰分层：长按复制/复制反馈由 `decorate/copy_hold.js` 负责；工具“详情/收起”切换由 `decorate/tool_toggle.js` 负责；`decorate/core.js` 仅做装饰编排
- 工具“详情/收起”稳定：切换前后基于锚点 `top` 差值进行滚动补偿（无漂移）；并在从代码块内点击切换时，基于点击位置做滚动校正，避免收起后视口落到代码块下方
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
    - 误报规避：仅当日志行“行首即为时间戳”时才会被识别为 tool gate 事件；避免 apply_patch/代码片段中的缩进示例文本触发误报
  - ⚠️ 辅助：tool_call 参数中出现权限升级字段时的“可能需要终端确认”提示（不等同于 tool gate 状态，是否需要批准以终端为准）
  - `justification` 字段来源：来自 tool_call 的参数（由 Codex 生成，用于解释“为什么要执行该命令/操作”）
- UI 辅助：
  - 右下角悬浮“↑ 顶部 / ↓ 底部”按钮：仅负责滚动定位；未读提示/跳转由会话标签（徽标 + 点击逐条跳转）承载，并高亮落点
- 右下角通知：tool gate / 回答新输出等关键状态弹出提醒（含“可能是历史残留”的提示）；新输出未读以底部会话标签徽标为准
- 右侧“翻译”按钮：单击切换自动翻译 `auto/manual`（对运行中的 watcher 立即生效，无需重启）；长按打开独立的“翻译设置”抽屉（含自动翻译开关、Provider/模型/Key/超时等）
  - 提示音：设置中可选择“无/提示音-1/2/3（轻/中/强）”，用于“回答输出/审批提示”的通知；**仅在产生新未读时响铃**，并按 `msg.id` 去重避免重复事件导致无新增也响铃（回放/补齐不响铃；当前视图在底部也不一定“已读”，仅当页面可见/聚焦且近 5s 有明确交互时才视为已看到）（选择后会播放预览，不再弹出额外文字提示；音效来源：Kenney UI SFX Set，CC0；文件在 `ui/music/`）

## 关于“在页面内输入并让 Codex 执行”
本 sidecar 的核心原则是**不修改 Codex、只读监听**（旁路查看/调试）。因此：
- 纯旁路情况下，Web UI **无法可靠地把输入“注入”到正在运行的 Codex TUI 会话**（缺少官方可写 API/IPC，且 pty 注入复杂/脆弱）。
- 本项目不提供任何“在浏览器里触发本机执行”的控制入口，避免把旁路 UI 变成远程执行面。

更“非侵入”的替代思路（更安全、也更贴合旁路定位）仍然有价值：
- UI 以旁路查看/复制为主；如需归档可在“会话管理”中导出为 Markdown（下载到本机文件，文件名使用会话显示名；导出设置为会话级：精简/全量、思考译文/原文；长按导出按钮打开设置），且不提供任何“在浏览器里触发本机执行”的控制入口（避免 Web UI 变成远程执行入口）。
  - 导出默认**串行化**（同一时间只允许 1 个导出任务），避免“连续点多个导出 → 卡住一阵 → 突然下载一大批”的体验；导出过程中会提示“导出中…”，忙碌时提示“已有导出在进行中”。

## 运行方式（WSL 示例）
- 推荐（短命令，先开 UI 再开始监听）：
  - 在仓库根目录执行：`./ui.sh`
  - 打开 `http://127.0.0.1:8787/ui`，点右侧工具栏 ⚙️ 保存配置，再点 ▶/⏹️ 监听（点击切换开始/停止）

- 兼容（启动即监听，命令行参数方式）：
  - 在仓库根目录执行：`./run.sh --codex-home "$HOME/.codex" --port 8787 --replay-last-lines 5000`

端口占用自动恢复（体验优化）：
- 若检测到旧 sidecar 仍占用端口，但健康检查失败（例如意外关浏览器/进程卡死导致 UI 打不开），`./run.sh` / `./ui.sh` 会尝试**仅对 codex_sidecar 进程**做安全终止并重启。
- 若占用端口的进程看起来不是 codex_sidecar，则会在终端提示并退出（避免误杀其它服务）；此时请手动停止占用进程或换端口（`PORT=...` / `--port ...`）。

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
- 说明：以下属于 watcher 的“跟随/刷新”参数；UI 默认不再展示这些高级项（减少误操作与概念负担）。如需调整请直接编辑 `config/sidecar/config.json` 或使用启动参数。
- `进程定位`：开启后会根据进程（`/proc/<pid>/fd`）定位 Codex **实际打开**的 `rollout-*.jsonl`，并只跟随这些文件（最多 N 个），更稳定也更省资源（不会为了“补齐 N”再去扫描 `sessions/**`）。
- `仅在有进程时跟随`：开启后若未检测到匹配的 Codex 进程，则 sidecar 会进入 idle（不跟随任何文件）；关闭则会回退为 sessions 扫描（仍可看到最新会话）。注：若检测到进程但暂未发现其打开的 rollout 文件，会进入 `wait_rollout` 等待文件出现（不扫 sessions）。
- `进程匹配 regex`：用于匹配 Codex 进程的可执行文件名（默认 `codex`），只影响“进程定位”的检测范围。
  - 进程检测仅使用 `/proc/<pid>/exe` basename 与 argv0 basename 做 **fullmatch**（更精准，默认不误伤）；不再回退到整条 cmdline 匹配。若你确实需要“子串匹配”，请在 regex 自行写成 `.*codex.*`。
  - UI 状态里的 `pid:` 默认展示“确实打开了 rollout 的 pid”（更干净）；候选 pid 仅在调试信息里展示。
- 性能说明：进程定位会在每个 `scan` 周期全量扫描 `/proc` 并刷新候选 PID；如需降低开销，调大 `目标刷新间隔（秒）` 或收紧 regex（例如 `codex` / `^codex(\\.exe)?$`）。
- `读取间隔（秒）`（poll）：读取**已纳入监听名单**的会话文件增量内容（越小越实时，但 CPU/IO 更高）。
- 性能优化：poll 在文件无新增（`size==offset`）时不会反复打开/读取文件，减少空转开销。
- `目标刷新间隔（秒）`（scan）：刷新“跟随目标”（进程定位时=扫描 `/proc/*/fd`，非进程定位时=回退为 sessions 最新文件选择）。越小越快发现新会话，但开销更高。
- 性能优化：TUI gate tail（`codex-tui.log`）在无新增（`size==offset`）时不会反复打开文件，减少空转 IO。
- 性能优化：当处于 `idle/wait_codex`（进程定位开启但未检测到 Codex 进程）时，TUI gate 的轮询会降频到 scan cadence，减少空闲期空转。

## 已知问题（UI Markdown 渲染）

### 有序列表序号显示为 1（混合列表/子项场景）

现象：
- 部分回答块（`assistant_message`）在 UI 中渲染时，多个“小标题序号”都显示为 1（如 `1) ...`、`2) ...`、`3) ...` 在 UI 里变成每段都从 1 开始）。

根因（UI 端）：
- UI 使用自定义轻量 Markdown 渲染器（`ui/app/markdown/render.js`）。当文本形如：
  - `1) ...`（有序列表项）
  - 紧接着 `- ...`（无序子项）
  渲染器会在遇到 `- ...` 时把当前 `<ol>` 立即 flush 成“只有 1 个 `<li>` 的 `<ol>`”，随后切换到 `<ul>`；下一段 `2) ...` 又新开一个 `<ol>`。
- 同时渲染器会丢弃原始序号（仅提取 item 文本，不输出 `<ol start>` / `<li value>`），因此每个独立 `<ol>` 都从 1 显示。

修复（UI 端）：
- 有序列表项解析时保留原始序号（捕获 `(\d+)`），并在输出 HTML 时写入 `<li value="N">`：即使有序列表被拆成多个独立 `<ol>`，浏览器也会按 `value` 正确显示序号（1/2/3…）。

验证要点：
- Codex 写入的 `rollout-*.jsonl` 原文通常是正确递增的（例如 `1) ...`、`2) ...`、`3) ...`）；问题主要发生在 UI 渲染阶段。

### 其他“格式修剪/归一化”点（可能影响原文保真）

说明：以下行为多数是“为可读性/去终端换行噪音”的取舍，但确实可能改变 Markdown 的原始排版语义。

- `ui/app/markdown/render.js`：
  - 对每行做 `trimEnd()`：会移除行尾空格，可能破坏 Markdown 的“两个空格=强制换行”语义。
  - 段落 flush 时 `replace(/\\s+/g, \" \")`：会把连续空白（含换行/多空格）压缩成单空格，改变原始换行与对齐。
  - `smartJoinParts()` + `t.trim()`：会合并终端换行并按中英文字符规则插入/去掉空格，可能改变作者刻意的分行/空格布局。
- `ui/app/markdown/clean.js`（主要用于思考块 thinking）：
  - 非代码块内移除行尾空白、压缩连续空行、清理下划线噪音：可能改变原始空行数量与行尾空格语义。
- `ui/app/markdown/split.js`：
  - 对 “leading code block split” 的 `rest` 做 `trim()`：会去掉前后空行，影响首尾留白。

## 已知问题（UI 交互）

### 长代码块展开后滚动，收起时视口落到代码块下方

现象：
- 在工具输出的“详情”长代码块中向下滚动后，直接在代码块区域点击“收起/详情切换”，有概率导致收起后视口停留在该代码块下方内容（焦点漂移）。

根因（UI 端）：
- `decorate/tool_toggle.js` 的“无漂移切换”只补偿锚点 `top` 的变化；当用户已在长代码块中滚动到中下部时，收起会让大量内容高度瞬间消失，导致视口相对代码块区域发生偏移。

修复（UI 端）：
- 在 `toggleToolDetailsFromPre` 中，切换后基于点击 `clientY` 调用 `stabilizeClickWithin`，把视口校正回当前可见代码块区域，保证“展开/收起”后仍停留在同一代码块附近。

## 已知问题（后端控制面）

### `/health` 正常但 `/api/config` / `/api/status` 卡死（UI 空白/不可用）

现象：
- 端口仍在监听，`GET /health` 返回 200（看似“服务正常”），但 UI 首屏请求 `/api/config` / `/api/status` 超时，表现为“空白/无数据”。

根因（后端）：
- `controller.py` 的 `SidecarController._patch_config()` 在持有 `self._lock` 时调用 `_apply_watcher_hot_updates()`；
  后者内部再次 `with self._lock` 获取快照。由于 `threading.Lock` 非可重入，会发生自锁死锁。
- 一旦触发，控制面接口（`/api/config`、`/api/status`、`POST /api/config` 等）会永久阻塞，只能重启进程恢复。

修复（后端）：
- 将 watcher 热更新应用移动到释放 `self._lock` 之后执行，避免自锁；并增加回归测试确保 `update_config` 不会卡住。

## 硅基流动 translate.json 配置（免费优先）
硅基流动的 translate.js 提供了 `translate.json`（表单提交）接口。sidecar 已对该接口做兼容：仍使用 `HTTP（通用适配器）`，仅需把 URL 指向 `translate.json`。

- `HTTP URL`：`https://siliconflow.zvo.cn/translate.json?to=chinese_simplified`
- `HTTP Token`：留空（如无需要）
- 语言参数：通过 URL query 传入 `to` / `from`（未传 `from` 默认 `auto`）
