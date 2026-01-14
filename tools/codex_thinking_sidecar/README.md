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
也可以启用“自动开始监听（UI）”，保存配置后会自动开始（无需手动点击）。

## SDK 控制模式（可选：浏览器输入 → 本机持续对话）

当你希望在浏览器里直接输入并驱动 Codex 执行时，可使用 `codex_sdk` 控制模式（不尝试向既有 TUI 进程注入 stdin/pty，而是通过 Codex SDK 按 turn 执行并复用 threadId 续聊）。

准备工作：
- 安装 Node 依赖：`cd src/codex-sdk && npm install`
- 确保本机 Codex 已完成登录/鉴权，且 `CODEX_HOME` 可写

使用方式：
- 启动 `./ui.sh` 后，页面底部会出现 “SDK 控制” 输入栏（回车发送，Shift+Enter 换行）
- `threadId` 可留空（自动新建），也可粘贴恢复；点击“使用”可把当前选中会话的 threadId 填入输入栏

最小自测：
- `tools/codex_thinking_sidecar/sdk_smoke_test.sh`

## 运行（兼容：启动即监听，命令行参数）

```bash
./run.sh --codex-home "$HOME/.codex" --port 8787 --replay-last-lines 200
```

可选：进程优先定位当前会话（WSL2/Linux）：

```bash
./run.sh --codex-home "$HOME/.codex" --follow-codex-process --codex-process-regex "codex"
```

监听 Windows 侧（WSL 下挂载）：

```bash
./run.sh --codex-home "/mnt/c/Users/<YourUser>/.codex" --port 8787 --replay-last-lines 200
```

## 注意事项
- rollout 日志可能包含敏感信息；本工具默认仅本机 `127.0.0.1` 服务，不会上传。
- 请勿在未审计的情况下将日志内容转发到第三方服务。

## 配置持久化与多翻译 API
- UI 中点击“保存配置”会写入用户级配置目录（XDG）：
  - 默认：`$XDG_CONFIG_HOME/codex-thinking-sidecar/config.json`
  - 常见路径：`~/.config/codex-thinking-sidecar/config.json`
  下次启动会自动读取并沿用。
- 当翻译 Provider 选择 `HTTP` 时，UI 支持 `HTTP Profiles`：可保存多个翻译 API 配置并手动切换（新增/删除）。
  - 对 DeepLX 这类“token 在 URL 路径里”的接口：可将 URL 写为 `https://api.deeplx.org/{token}/translate`，并在 `HTTP Token` 中填写 token，sidecar 会自动替换 `{token}`。
  - ⚠️ token 会随配置一起持久化到本机配置文件中；请勿把包含 token 的配置文件加入版本控制。
- 为避免误操作丢失翻译配置，sidecar 会在保存前自动生成 1 份备份（覆盖式）：
  - `config.json.bak`
- 如遇到“Profiles 变空/配置丢失”，UI 会提示是否从备份恢复；也可手动点击“恢复配置”从备份中自动恢复。
- 兼容说明：旧版本写入在 `CODEX_HOME/tmp/` 下的 `.lastgood` / `.bak-*` 仍会被纳入恢复候选来源（只读，不再继续写入）。

## 进程优先定位当前会话（WSL2/Linux，可选）
默认的文件选择策略是扫描 `sessions/**/rollout-*.jsonl` 并跟随“最近修改”的文件。为了更精准地跟随“正在进行的会话”，可以启用进程优先定位：

- `基于 Codex 进程定位`：从 `/proc/<pid>/fd` 扫描匹配到的 Codex 进程及其子进程，优先锁定它正在写入的 `rollout-*.jsonl`
- `仅在检测到进程时跟随`：避免 Codex 未运行时误切到历史会话文件（推荐保持开启）
- `Codex 进程匹配（regex）`：默认 `codex`，如命中范围过大可自行收敛

命令行参数对应：
- `--follow-codex-process`
- `--codex-process-regex`
- `--allow-follow-without-process`（允许在未检测到进程时仍按 sessions 扫描回退）

## 显示模式
UI 支持三种显示模式：`中英文对照 / 仅中文 / 仅英文`，该选择保存在浏览器 `localStorage` 中（不写入服务端配置文件）。

## 配置生效时机
监听线程启动时会读取一次配置；如果你在“已开始监听”的状态下修改翻译配置，UI 会提示是否重启监听以立即生效。

## UI 内容（更完整的 turn 视图）
UI 会展示：
- 用户输入（`user_message`）
- 工具调用与输出（`tool_call` / `tool_output`，输出默认折叠）
- 最终回答（`assistant_message`）
- 思考摘要（`reasoning_summary`，并可选采集 `agent_reasoning`）

翻译仅作用于思考类内容（`reasoning_summary` / `agent_reasoning`）。

会话切换列表固定在页面左侧，滚动到中后段也可随时切换不同会话视图。

## 硅基流动 translate.json（免费优先的简单方案）
如果你想用硅基流动 translate.js 暴露的翻译接口（`application/x-www-form-urlencoded`），无需新增 Provider：直接使用 `HTTP（通用适配器）` 并把 URL 指向 `translate.json` 即可。

- `HTTP URL`：`https://siliconflow.zvo.cn/translate.json?to=chinese_simplified`
- `HTTP Token/Auth ENV`：留空

可选参数（通过 URL query 传入）：
- `to`：目标语言（例如 `chinese_simplified` / `chinese_traditional`）
- `from`：源语言（默认 `auto`）
