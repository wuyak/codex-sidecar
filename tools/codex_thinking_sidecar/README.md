# Codex Thinking Sidecar（旁路思考摘要监听器）

本工具用于**不修改 Codex** 的前提下，实时监听 `CODEX_HOME/sessions/**/rollout-*.jsonl`，提取思考摘要（`reasoning.summary`），并通过本地 HTTP 服务（含 SSE）展示。

> 翻译 Provider 支持 `stub/none/http`：`stub` 为占位便于自测链路，`none` 表示不生成译文，`http` 可对接自建翻译服务。

## 运行（推荐：先开 UI 再开始监听）

WSL/Linux：

```bash
./ui.sh
```

打开页面：
- `http://127.0.0.1:8787/ui`

在 UI 里设置“监视目录（CODEX_HOME）”、回放行数、是否采集 `agent_reasoning`、翻译 Provider 等；保存配置后点击“开始监听”。

## 运行（兼容：启动即监听，命令行参数）

```bash
./run.sh --codex-home "$HOME/.codex" --port 8787 --replay-last-lines 200
```

监听 Windows 侧（WSL 下挂载）：

```bash
./run.sh --codex-home "/mnt/c/Users/<YourUser>/.codex" --port 8787 --replay-last-lines 200
```

## 注意事项
- rollout 日志可能包含敏感信息；本工具默认仅本机 `127.0.0.1` 服务，不会上传。
- 请勿在未审计的情况下将日志内容转发到第三方服务。

## 配置持久化与多翻译 API
- UI 中点击“保存配置”会写入：`$CODEX_HOME/tmp/codex_thinking_sidecar.config.json`，下次启动会自动读取并沿用。
- 当翻译 Provider 选择 `HTTP` 时，UI 支持 `HTTP Profiles`：可保存多个翻译 API 配置并手动切换（新增/删除）。
  - 对 DeepLX 这类“token 在 URL 路径里”的接口：可将 URL 写为 `https://api.deeplx.org/{token}/translate`，并在 `HTTP Token` 中填写 token，sidecar 会自动替换 `{token}`。
  - ⚠️ token 会随配置一起持久化到本机配置文件中；请勿把包含 token 的配置文件加入版本控制。

## 显示模式
UI 支持三种显示模式：`中英文对照 / 仅中文 / 仅英文`，该选择保存在浏览器 `localStorage` 中（不写入服务端配置文件）。
