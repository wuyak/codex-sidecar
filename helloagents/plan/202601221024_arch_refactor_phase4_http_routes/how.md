# 技术设计: HTTP Handler 路由分层（Phase 4）

## 技术方案
### 核心技术
- Python `http.server`（保持现状）
- 分层策略：`SidecarHandler` 提供通用能力；`routes_get/routes_post` 提供路由分发与端点实现

### 实现要点
- 新增：
  - `codex_sidecar/http/routes_get.py`: `dispatch_get(handler)` 负责解析 URL、处理所有 GET 路由并输出响应
  - `codex_sidecar/http/routes_post.py`: `dispatch_post(handler)` 负责处理所有 POST 路由并输出响应
- 修改：
  - `codex_sidecar/http/handler.py`: `do_GET/do_POST` 改为委托调用 routes 模块
- 兼容性：
  - 保持所有路径、响应字段、错误码与兼容分支不变
  - 继续使用 handler 内部的 `_send_json/_send_error/_read_json_object/_serve_ui_file/_handle_sse` 等能力，避免行为漂移

## 测试与验证
- `python3 -m compileall -q codex_sidecar`
- `python3 -m unittest discover -s tests`

