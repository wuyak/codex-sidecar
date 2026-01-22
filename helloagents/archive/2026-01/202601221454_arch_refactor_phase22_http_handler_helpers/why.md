# 变更提案: HTTP Handler 纯逻辑解耦（Phase22）

## 需求背景
`codex_sidecar/http/handler.py` 同时承担了：
- JSON 序列化/请求体解析
- config/status payload 的脱敏与展示字段补齐
- UI 静态资源与 SSE 处理

其中“JSON 编解码/校验”和“config/status payload 组装”属于可复用的纯逻辑，当前与 `BaseHTTPRequestHandler` 强耦合，导致：
- handler 体积偏大、阅读成本高
- 纯逻辑难以独立单测
- 后续扩展 endpoint 时容易复制粘贴同类逻辑

## 变更内容
1. 抽离 JSON 相关纯逻辑到 `codex_sidecar/http/json_helpers.py`
2. 抽离 config/status payload 组装到 `codex_sidecar/http/config_payload.py`
3. `SidecarHandler` 保持对外行为不变，仅改为调用 helper

## 影响范围
- **模块:** http
- **文件:**
  - `codex_sidecar/http/json_helpers.py`
  - `codex_sidecar/http/config_payload.py`
  - `codex_sidecar/http/handler.py`
  - `tests/test_http_helpers.py`
- **API:** 无（handler 方法签名不变）
- **数据:** 无

## 核心场景

### 需求: /api/config 与 /api/status 的 payload
**模块:** http
保持现有语义：
- `config` 字段内脱敏
- 补齐 `config_home_display` / `config_file_display`
- top-level 继续展开 config keys（向后兼容）

### 需求: JSON 请求体解析
**模块:** http
保持现有语义：
- `allow_invalid_json=True` 时无效 JSON 回退为 `{}`，用于兼容控制面旧客户端
- 仅接受 object（dict），否则返回 `invalid_payload`

## 风险评估
- **风险:** helper 抽离导致边界行为变化
- **缓解:** 新增单测覆盖 invalid_json / invalid_payload / display 字段，并运行全量单测回归

