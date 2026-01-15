# codex-thinking-sidecar-zh

一个**不修改 Codex** 的旁路工具：读取 `CODEX_HOME/sessions/**/rollout-*.jsonl`，提取思考摘要/推理文本并在本地 Web UI 展示（可选翻译 Provider）。

核心原则：
- **读取优先**：先把英文原文入库/推送到 UI，避免翻译阻塞采集。
- **翻译解耦**：翻译在后台队列慢慢补齐，完成后以 `op=update` 回填到原消息块（不改变时间线位置）。
- **时间线稳定**：服务端为新增消息附加单调递增 `seq`，UI 按 `(timestamp, seq)` 插入渲染，避免“时间倒退/回跳”。
- **切换稳定**：UI 刷新列表期间暂存 SSE 消息，刷新结束后批量回放，避免清空/插入并发导致错位或闪烁。
- **断线恢复**：SSE 重连后自动回源同步，避免长时间挂着时网络抖动/服务重启导致漏消息。
- **会话列表同步**：断线恢复后标记为 dirty，并在下一次列表回源时同步 `/api/threads`，避免侧栏漏会话/排序漂移。
- **切换加速**：消息列表按会话 `key` 做视图缓存；切换时优先复用已渲染 DOM，并回放该会话的 SSE 缓冲（溢出或切到 `all` 时再回源 `refreshList()`）。
- **渲染加速**：Markdown 渲染按消息缓存；翻译回填优先原位更新 ZH 区块，减少重绘与上下文丢失。
- **旁路只读**：不提供浏览器“驱动 Codex 执行”的控制入口（避免把 UI 变成远程执行面）。

## 快速开始

```bash
cd ~/src/codex-thinking-sidecar-zh
./ui.sh
```

打开：
- `http://127.0.0.1:8787/ui`

在 UI 里配置 `监视目录（CODEX_HOME）`，保存后点击“开始监听”；也可以启用“自动开始监听（UI）”省去手动点击。

如果你希望 **启动即开始监听**（不走 UI 按钮）：

```bash
./run.sh
```

## 版本
本项目不维护单独的版本号，直接以 Git 提交为准（例如：`git rev-parse --short HEAD`）。

## 说明

### 翻译 Provider
- 默认翻译为占位实现（`stub`），不调用任何外部 API。
- 可在 UI 切换：
  - `none`：不翻译
  - `http`：通用 HTTP 适配器（支持 Profiles）
  - `openai`：Responses API 兼容（用于 GPT 类网关/自建代理）

说明：
- 翻译默认不会阻塞采集；中文会稍后“回填”到对应消息。
- 为提高导入速度：仅在**回放/积压导入阶段**会对同一会话做**最多 5 条批量翻译**；实时新增通常逐条翻译（避免跨会话串流/无谓聚合）。

### 高级设置（UI）
- `回放行数`：启动监听时从文件尾部回放最近 N 行（用于补历史）
- `采集 reasoning`：额外采集 `agent_reasoning`（更实时但更噪）
- `进程定位/仅跟随进程/进程 regex`：在 Linux/WSL 下用 `/proc/<pid>/fd` 更精准跟随正在写入的 rollout 文件，减少“挂着但读旧会话”
- `poll/scan`：读文件/扫描新会话文件的频率

## 目录结构（概览）

- `tools/codex_thinking_sidecar/codex_thinking_sidecar/`
  - `controller.py`: 监听线程生命周期与配置控制（供 HTTP handler 调用）
  - `watcher.py`: 跟随 rollout 读取→`/ingest`；TUI tool gate 提示；翻译通过 `watch/` 子模块异步回填
  - `watch/`: watcher 侧子模块（rollout 路径/进程扫描/跟随策略/翻译批处理与队列）
    - `watch/rollout_extract.py`: rollout JSONL 单条记录 → UI 事件提取（assistant/user/tool/reasoning）
  - `control/`: 控制面子模块（translator schema / translator 构建 / 配置校验）
  - `server.py`: HTTP+SSE 启动器（绑定 state/controller，启动 ThreadingHTTPServer）
  - `http/`: 服务端子模块（内存 state / HTTP 路由与 SSE / UI 静态资源）
    - `ui/`: 纯静态 UI（无构建）
    - `ui/app/render.js`: 消息渲染门面（实现：`ui/app/render/*`）
    - `ui/app/markdown.js`: Markdown 门面；实现位于 `ui/app/markdown/*`（含 inline/table 子模块）
    - `ui/app/decorate.js`: 行装饰门面；实现位于 `ui/app/decorate/core.js`
    - `ui/app/events.js`: SSE/事件流门面；实现位于 `ui/app/events/*`（timeline/buffer/stream）
    - `ui/app/sidebar.js`: 侧栏门面；实现位于 `ui/app/sidebar/*`（labels/tabs）
    - `ui/app/utils.js`: 工具函数门面；实现位于 `ui/app/utils/*`（time/id/color/json/clipboard/error）
    - `ui/app/list.js`: 列表门面；实现位于 `ui/app/list/*`（threads/refresh/bootstrap）
    - `ui/app/views.js`: 多会话 list 视图缓存（切换复用 DOM + 还原滚动）
- `helloagents/`: 知识库（CHANGELOG / wiki / history）
