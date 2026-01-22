# 技术设计: HTTP Handler 纯逻辑解耦（Phase22）

## 技术方案

### 核心技术
- Python 3.8
- 以“纯函数 helper + 单测 + handler 兼容 wrapper”的方式拆分

### 实现要点
- `codex_sidecar/http/json_helpers.py`
  - `_json_bytes(obj)` 等价实现（UTF-8 + ensure_ascii=False）
  - `parse_json_object(raw, allow_invalid_json)`：返回 `(obj, error)`，不直接依赖 handler
- `codex_sidecar/http/config_payload.py`
  - `apply_config_display_fields(cfg, cwd)`：补齐 display 字段（仅展示，不持久化）
  - `build_config_payload(raw_cfg, cwd)`：脱敏 + display + top-level spread
  - `decorate_status_payload(st, cwd)`：对 status.config 做 best-effort 脱敏与 display
- `codex_sidecar/http/handler.py`
  - 保留现有方法名（`_send_json/_read_json_object/_build_config_payload/_decorate_status_payload` 等）
  - 内部实现改为调用 helper，保证 routes_* 对 handler 的约定不变

## 安全与性能
- **安全:** 仍由 `security.redact_sidecar_config` 负责脱敏；路径展示仅用于 UI，避免泄露用户 home 路径
- **性能:** 等价；helper 为 O(n) 序列化/解析，未引入额外 IO

## 测试与部署
- **测试:** 新增 `tests/test_http_helpers.py` 覆盖 JSON 解析与 config payload display 关键分支；并运行全量测试集
- **部署:** 无（结构性重构，行为不变）

