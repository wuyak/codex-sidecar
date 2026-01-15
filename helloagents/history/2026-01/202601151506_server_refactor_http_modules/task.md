# 轻量迭代任务清单：服务端分层（http/ 子模块）

- [√] 重构：将 `server.py` 拆分为 `http/state.py`（内存存储/广播）、`http/ui_assets.py`（静态资源）、`http/handler.py`（HTTP 路由/SSE）
- [√] 兼容：保留 `SidecarServer` 对外接口不变（`cli.py` 无需改动或仅最小改动）
- [√] 文档同步：README / wiki / CHANGELOG
- [√] 质量验证：`python3 -m py_compile`
- [√] 迁移方案包至 `helloagents/history/` 并更新 `helloagents/history/index.md`
- [√] Git 提交
