# 变更提案: /ingest JSON 解析复用（Phase23）

## 需求背景
此前 Phase22 已将 JSON object 解析抽离到 `codex_sidecar/http/json_helpers.py`，但 `/ingest` 路径仍在 `http/routes_post.py` 内联使用 `json.loads(...)` 做重复解析与校验。

重复实现带来的问题：
- 解析/错误码语义容易分叉（invalid_json/invalid_payload）
- 未来继续拆分 handler 时需要重复搬运逻辑
- 缺少专门针对 `/ingest` 的端到端回归测试

## 变更内容
1. `/ingest` 的 JSON object 解析改为复用 `parse_json_object`
2. 新增 `tests/test_http_ingest.py`，覆盖 empty_body / invalid_json / invalid_payload / add / update 关键分支

## 影响范围
- **模块:** http
- **文件:**
  - `codex_sidecar/http/routes_post.py`
  - `tests/test_http_ingest.py`
- **API:** 无
- **数据:** 无

## 核心场景

### 需求: /ingest 错误码一致性
**模块:** http
保持现有语义：
- 空 body: `empty_body`
- 非法 JSON: `invalid_json`
- 非 object: `invalid_payload`

### 需求: /ingest add/update
**模块:** http
保持现有语义：
- op=update 需要 id
- add 需要最小字段 id/kind/text

## 风险评估
- **风险:** 复用 helper 后错误处理路径变化
- **缓解:** 新增端到端 HTTP 测试覆盖关键分支，并全量运行测试集回归

