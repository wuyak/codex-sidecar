# 任务清单: SSE /events JSON 编码修复（Phase29）

目录: `helloagents/plan/202601221625_fix_phase29_http_sse_json_bytes/`

---

## 1. 后端修复
- [√] 1.1 修复 `codex_sidecar/http/handler.py` 中 SSE 事件 JSON 编码调用

## 2. 测试
- [√] 2.1 新增 `tests/test_http_sse_events.py` 覆盖 SSE 基本发送路径

## 3. 文档更新
- [√] 3.1 更新 `helloagents/CHANGELOG.md` 记录本次修复

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [ ] 5.1 将本方案包迁移至 `helloagents/history/2026-01/202601221625_fix_phase29_http_sse_json_bytes/` 并更新 `helloagents/history/index.md`
