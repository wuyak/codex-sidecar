# codex-thinking-sidecar-zh

一个**不修改 Codex** 的旁路工具：读取 `CODEX_HOME/sessions/**/rollout-*.jsonl`，提取思考摘要/推理文本并在本地 Web UI 展示（可选翻译 Provider）。

核心原则：
- **读取优先**：先把英文原文入库/推送到 UI，避免翻译阻塞采集。
- **翻译解耦**：翻译在后台队列慢慢补齐，完成后以 `op=update` 回填到原消息块（不改变时间线位置）。
- **时间线稳定**：服务端为新增消息附加单调递增 `seq`，UI 按 `(timestamp, seq)` 插入渲染，避免“时间倒退/回跳”。

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

### 可选：SDK 控制模式（实验性）
项目内包含 `src/codex-sdk/`（Node.js），sidecar 提供 `/api/sdk/*` 接口用于从 UI 发送一条文本到本机 Codex 会话（并把 user/assistant 消息写回同一事件流展示）。

前置条件：
- 需要 Node.js（建议 ≥ 18）
- 首次使用需在 `src/codex-sdk` 安装依赖：`npm install`

## 目录结构（概览）

- `tools/codex_thinking_sidecar/codex_thinking_sidecar/`
  - `watcher.py`: 跟随 rollout 读取→`/ingest`；翻译后台队列（批量仅用于回放导入）
  - `server.py`: HTTP+SSE；消息 `seq`；`op=add/update`
  - `ui/`: 纯静态 UI（无构建）
    - `ui/app/render.js`: 时间线渲染（按 `(timestamp, seq)` 插入 + `op=update` 原位回填）
    - `ui/app/markdown.js`: Markdown 门面；实现位于 `ui/app/markdown/*`
    - `ui/app/decorate.js`: 行装饰门面；实现位于 `ui/app/decorate/core.js`
- `src/codex-sdk/`: SDK 控制模式（实验性）
- `helloagents/`: 知识库（CHANGELOG / wiki / history）
