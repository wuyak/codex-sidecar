# 任务清单: HTTP Handler 路由分层（Phase 4）

目录: `helloagents/plan/202601221024_arch_refactor_phase4_http_routes/`

---

## 1. 路由分层
- [√] 1.1 新增 `codex_sidecar/http/routes_get.py`，迁移 `do_GET` 的分支逻辑（保持行为一致）
- [√] 1.2 新增 `codex_sidecar/http/routes_post.py`，迁移 `do_POST` 的分支逻辑（保持行为一致）
- [√] 1.3 `codex_sidecar/http/handler.py` 的 `do_GET/do_POST` 改为委托 routes，并清理不再需要的耦合/导入

## 2. 安全检查
- [√] 2.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 3. 文档更新
- [√] 3.1 更新 `helloagents/modules/rollout_sidecar.md`（记录 HTTP 路由分层点）
- [√] 3.2 更新 `helloagents/CHANGELOG.md` 与 `helloagents/archive/_index.md`

## 4. 测试
- [√] 4.1 运行单测：`python3 -m unittest discover -s tests`
- [√] 4.2 运行编译检查：`python3 -m compileall -q codex_sidecar`
