# 技术设计: 架构优化（无功能变更）

## 技术方案

### 核心技术
- **后端:** Python（标准库 `http.server`）
- **前端:** 原生 JS（不改动）
- **测试:** `unittest`

### 实现要点
1. **HTTP Handler 降噪**
   - 在 `SidecarHandler` 内部新增轻量 helper（例如 `_read_json()`、`_send_error()`、`_handle_translate_request()`），统一 body 读取与错误响应。
   - `POST /api/offline/translate` 与 `POST /api/control/translate_text` 复用同一内部实现，保持返回 shape 不变。
2. **轮询短路**
   - `tui_gate`：当 `size==offset` 时直接返回，避免反复 `open()`。
   - watcher 其它轮询点已做类似优化的保持不变，必要时补充一致的早退逻辑。
3. **测试策略**
   - 新增/调整单测覆盖重构 helper 的关键输入输出（尤其是 handler 翻译端点与错误路径）。

## 架构决策 ADR
### ADR-001: 优先“内部 helper”而非“拆分文件/模块”
**上下文:** `codex_sidecar/http/handler.py` 代码较长，但拆分为多个文件会引入额外跳转与抽象层。
**决策:** 本轮先在同文件内抽离最小 helper，减少重复样板代码，不引入新的模块分层。
**理由:** 满足“抽象程度减少”的目标，同时能显著降低重复与维护成本。
**替代方案:** 彻底模块化拆分（`handlers/config.py` 等）→ 拒绝原因: 会增加抽象层级与文件跳转成本，且本轮目标是无功能变更的保守优化。
**影响:** handler 文件仍然存在，但入口逻辑更清晰、重复更少，可在未来再评估拆分。

## API设计
不变（仅内部实现重构，保持现有兼容）。

## 安全与性能
- **安全:** 保持现有路径/文件读取安全边界与密钥脱敏逻辑不变。
- **性能:** 减少空转 IO（tui/log poll 早退）、减少重复 JSON 解析样板代码带来的逻辑分叉。

## 测试与部署
- **测试:** `python3 -m unittest discover -s tests -p 'test_*.py'` + `python3 -m compileall -q codex_sidecar`
- **部署:** 无（本地运行 sidecar 即可）；每个大改动点完成后进行一次 git commit。

