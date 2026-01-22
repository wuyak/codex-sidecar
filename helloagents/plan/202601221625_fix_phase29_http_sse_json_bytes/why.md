# 修复提案: SSE /events 使用错误函数名导致崩溃（Phase29）

## 需求背景
`codex_sidecar/http/handler.py` 的 SSE 实现（`/events`）在发送事件时调用了不存在的 `_json_bytes`：
- 这会触发 `NameError`，导致 SSE handler 线程异常退出/连接中断
- UI 端表现为事件流不稳定或直接无更新

## 变更内容
1. 将 SSE 的 JSON 编码调用改为已存在的 `json_bytes()`（来自 `http/json_helpers.py`）
2. 新增回归测试：启动临时 HTTPServer，连接 `/events` 后注入一条 state 消息，断言可收到 `event: message` 与有效 JSON payload

## 影响范围
- **模块:** http
- **文件:**
  - `codex_sidecar/http/handler.py`
  - `tests/test_http_sse_events.py`
- **API:** 无（修复内部实现错误）
- **数据:** 无

## 风险评估
- **风险:** 极低（仅修复函数名引用）
- **缓解:** 增加端到端回归测试覆盖 SSE 基本发送路径

