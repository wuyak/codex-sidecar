# 技术设计: /ingest JSON 解析复用（Phase23）

## 技术方案

### 核心技术
- Python 3.8
- 复用 `http/json_helpers.parse_json_object` 统一 JSON object 解析与错误码

### 实现要点
- `codex_sidecar/http/routes_post.py`
  - `/ingest` 分支保留 `empty_body` 特判
  - 其他解析统一走 `parse_json_object(raw, allow_invalid_json=False)`，错误时返回 `invalid_json/invalid_payload`
- `tests/test_http_ingest.py`
  - 使用 `ThreadingHTTPServer + SidecarHandler` 做轻量端到端测试
  - 覆盖：空 body、invalid json、invalid payload、add、update（含 missing_id）

## 安全与性能
- **安全:** 不改变校验范围；仍只接受 dict payload
- **性能:** 等价；减少重复实现与维护成本

## 测试与部署
- **测试:** 新增 `tests/test_http_ingest.py` + 运行全量测试
- **部署:** 无（结构性重构，行为不变）

