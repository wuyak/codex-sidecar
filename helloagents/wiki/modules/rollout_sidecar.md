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
- UI 默认优先显示浏览器本地时区时间（并标注时区），同时保留原始 UTC 方便对照。

## 关键实现点
- 只读解析 JSONL（不改写原始日志）
- 轮询 + 增量读取（按 offset tail），支持启动时回放尾部 N 行
- UI 控制面：保存配置、开始/停止监听、清空显示
- 翻译 Provider 可插拔并可在 UI 中切换：`stub/none/http`
- `--include-agent-reasoning` 说明：
  - 该类型通常是“流式推理文本”，同一段内容可能重复出现（模型/客户端实现差异）。
  - sidecar 会对 `agent_reasoning` 做更激进的去重（不依赖 timestamp），但仍建议仅在需要更实时内容时开启。

## 运行方式（WSL 示例）
- 推荐（短命令，先开 UI 再开始监听）：
  - `cd ~/src/codex-thinking-sidecar-zh && ./ui.sh`
  - 打开 `http://127.0.0.1:8787/ui`，在 UI 里保存配置并点击“开始监听”

- 兼容（启动即监听，命令行参数方式）：
  - `cd ~/src/codex-thinking-sidecar-zh && ./run.sh --codex-home "$HOME/.codex" --port 8787 --replay-last-lines 5000 --include-agent-reasoning`

## 配置持久化与多翻译 Profiles
- UI 中点击“保存配置”会将配置写入：`$CODEX_HOME/tmp/codex_thinking_sidecar.config.json`。
- 下次启动 `./ui.sh` 或 `./run.sh` 时会自动读取并沿用已保存配置（`./run.sh` 会立即开始监听）。
- 当翻译 Provider 选择 `HTTP` 时，可在 `HTTP Profiles` 中保存多个翻译 API 配置并手动切换（支持新增/删除）。
  - DeepLX 等“token 在 URL 路径里”的接口：将 URL 写为 `https://api.deeplx.org/{token}/translate`，并在 `HTTP Token` 中填写 token，sidecar 会自动替换 `{token}`。
  - ⚠️ token 会随配置一起持久化到本机配置文件中；请勿把包含 token 的配置文件加入版本控制。

## UI 显示模式
UI 支持三种显示模式：`中英文对照 / 仅中文 / 仅英文`（保存在浏览器 localStorage，不写入配置文件）。

## 配置生效提示
sidecar 的监听线程启动时会读取一次配置；若在“已开始监听”状态下修改翻译配置，需重启监听后才会生效（UI 会提示是否重启）。
