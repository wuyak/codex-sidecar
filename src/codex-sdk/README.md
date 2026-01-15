# codex-sdk（控制模式）

本目录用于通过 **Codex SDK（`@openai/codex-sdk`）** 在本机执行“持续对话”能力，为浏览器 UI 提供可写输入通道（由上层服务调用）。

## 运行要求
- Node.js ≥ 18
- 首次安装依赖：
  - `npm install`

## 官方教程（快速上手）

本目录内置了按官方 README 风格编写的示例（仅依赖 `@openai/codex-sdk`）：

```bash
cd src/codex-sdk
npm install

# Quickstart
npm run quickstart -- "Summarize repository status"

# Streaming（观察 tool/file_change/usage 等事件）
npm run stream -- "Diagnose the test failure and propose a fix"

# Structured output（outputSchema）
npm run structured -- "Summarize repository status"

# Resuming thread
npm run resume -- "<threadId>" "Implement the fix"
```

## 本地控制台（浏览器输入）

不改动本仓库既有 UI 目录；在 `src/codex-sdk` 内单独提供一个本地 Web 控制台：

```bash
cd src/codex-sdk
npm install
npm run serve
```

打开：
- `http://127.0.0.1:8790/ui`

说明：
- 默认仅监听 `127.0.0.1`；如确需对外开放，需显式设置 `CODEX_SDK_ALLOW_REMOTE=1`（强烈不建议）。
- `threadId` 可留空（新对话），也可粘贴恢复（续聊）。

## 本地自测（一次 Turn）

> 该脚本为“单次执行器”，由上层 Python sidecar 按需调用；不常驻端口。

```bash
cd src/codex-sdk
npm install

echo '{"input":"Summarize repository status"}' | node ./run_turn.mjs | jq .
```

你也可以传入 `threadId` 以续聊：

```bash
echo '{"threadId":"<threadId>","input":"Implement the fix"}' | node ./run_turn.mjs | jq .
```

## 输入/输出协议（JSON）

stdin JSON：
- `threadId`（可选）：续聊用的 threadId
- `input`：字符串，或 `[{type:"text",text:"..."},{type:"local_image",path:"..."}]`
- `codexHome`（可选）：覆盖 `CODEX_HOME`（用于指定 sessions/log 的落盘目录）
- `threadOptions`（可选）：如 `workingDirectory` / `sandboxMode` / `approvalPolicy` 等

stdout JSON：
- `{ ok: true, threadId, turn: { finalResponse, items, usage } }`
- 或 `{ ok: false, error }`
