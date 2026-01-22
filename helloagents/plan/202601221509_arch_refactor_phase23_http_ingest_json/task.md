# 任务清单: /ingest JSON 解析复用（Phase23）

目录: `helloagents/plan/202601221509_arch_refactor_phase23_http_ingest_json/`

---

## 1. http 模块
- [√] 1.1 重构 `codex_sidecar/http/routes_post.py` 的 `/ingest` JSON 解析复用 `parse_json_object`

## 2. 测试
- [√] 2.1 新增 `tests/test_http_ingest.py` 覆盖关键分支

## 3. 文档更新
- [√] 3.1 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [ ] 5.1 将本方案包迁移至 `helloagents/history/2026-01/202601221509_arch_refactor_phase23_http_ingest_json/` 并更新 `helloagents/history/index.md`
