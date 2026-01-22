# 技术设计: SSE /events JSON 编码修复（Phase29）

## 技术方案
- `SidecarHandler._handle_sse()`：
  - 将 `data = _json_bytes(msg)` 改为 `data = json_bytes(msg)`
  - 保持 SSE 协议输出格式不变（`event: message` + `data: <json>`）

## 测试与部署
- **测试:** 新增 `tests/test_http_sse_events.py`：
  - 建立到 `/events` 的连接，读到 `:ok`
  - 通过 `SidecarState.add()` 发布一条消息
  - 断言客户端读到 `event: message` 与 `data: ...`，且 JSON 可解析
- **部署:** 无

