# 变更提案: HTTP Handler 路由分层（Phase 4）

## 需求背景
后端 HTTP 入口 `codex_sidecar/http/handler.py` 目前承担了过多职责（路由分发 + 参数解析 + 业务处理 + SSE + UI 静态资源），导致：
- 路由逻辑难以局部理解与维护
- 修改某个端点容易误伤其它端点（回归风险上升）
- 单文件过大，不利于单元测试覆盖与复用

本轮目标是在**不改动对外行为**（路径、返回 JSON shape、错误码、兼容字段、SSE 行为均保持一致）的前提下，将 GET/POST 路由分发逻辑拆分到独立模块，提升可维护性与边界清晰度。

## 变更内容
1. 将 `do_GET` 与 `do_POST` 的路由分发与业务分支迁移到 `http/routes_*` 模块。
2. `SidecarHandler` 仅保留通用能力（发送响应、读 JSON、SSE、UI 静态文件服务、payload 装饰等），并委托 routes 模块处理具体路径。
3. 保持测试与行为不变：单测通过，且对外 API 返回保持兼容。

## 影响范围
- **模块:** `codex_sidecar/http/*`
- **文件:** `codex_sidecar/http/handler.py`（内部结构）、新增 `codex_sidecar/http/routes_get.py`、`codex_sidecar/http/routes_post.py`
- **API:** 无（保持兼容）
- **数据:** 无

## 风险评估
- **风险:** 迁移路由分支时可能引入遗漏或路径不一致。
- **缓解:** 采用“机械搬迁 + 逐端点对照”方式；执行 `unittest` + `compileall`；必要时补最小回归测试覆盖关键端点。

