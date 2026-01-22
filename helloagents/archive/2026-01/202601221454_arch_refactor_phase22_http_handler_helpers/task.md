# 任务清单: HTTP Handler 纯逻辑解耦（Phase22）

目录: `helloagents/plan/202601221454_arch_refactor_phase22_http_handler_helpers/`

---

## 1. http 模块
- [√] 1.1 新增 `codex_sidecar/http/json_helpers.py`（JSON bytes + object 解析）
- [√] 1.2 新增 `codex_sidecar/http/config_payload.py`（config/status payload 组装）
- [√] 1.3 重构 `codex_sidecar/http/handler.py` 调用 helper（行为保持不变）

## 2. 测试
- [√] 2.1 新增 `tests/test_http_helpers.py` 覆盖关键分支

## 3. 文档更新
- [√] 3.1 更新 `helloagents/modules/rollout_sidecar.md`（http 分层补充）
- [√] 3.2 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [√] 5.1 将本方案包迁移至 `helloagents/archive/2026-01/202601221454_arch_refactor_phase22_http_handler_helpers/` 并更新 `helloagents/archive/_index.md`
