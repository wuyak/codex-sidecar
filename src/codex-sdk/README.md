# codex-sdk（控制模式）

本目录用于通过 **Codex SDK（`@openai/codex-sdk`）** 在本机执行“持续对话”能力，为浏览器 UI 提供可写输入通道（由上层服务调用）。

## 运行要求
- Node.js ≥ 18
- 首次安装依赖：
  - `npm install`

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
