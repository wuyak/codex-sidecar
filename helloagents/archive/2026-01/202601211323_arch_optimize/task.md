# 任务清单: 架构优化（无功能变更）

目录: `helloagents/plan/202601211323_arch_optimize/`

---

## 1. HTTP 控制面降噪（handler）
- [√] 1.1 在 `codex_sidecar/http/handler.py` 内抽离通用 `_read_json_object()` 与 `_send_error()`，统一 JSON body 读取/校验与错误响应，保持现有端点行为不变。
- [√] 1.2 在 `codex_sidecar/http/handler.py` 内抽离翻译请求处理 helper，让 `/api/control/translate_text` 与 `/api/offline/translate` 复用同一内部实现（返回 shape 兼容）。
- [√] 1.3 为 handler 重构补齐单元测试（覆盖：非法 JSON、非 dict、items 批量与 text 单条等），确保回归。

## 2. watcher 周边空转开销优化
- [√] 2.1 在 `codex_sidecar/watch/tui_gate.py` 中加入 `size==offset` 早退，避免无新增时反复打开文件。
- [-] 2.2 补齐/更新相关单测（该模块依赖时间/文件 tail 状态机，当前以 compileall + 全量单测回归覆盖为主），确保行为一致。

## 3. 自检与收尾
- [√] 3.1 运行 `python3 -m compileall -q codex_sidecar` 与单测全量回归。
- [√] 3.2 更新 `helloagents/CHANGELOG.md` 与受影响模块文档（如有）。
- [√] 3.3 按阶段 git commit（每个大改动一次），最后迁移方案包到 `helloagents/archive/2026-01/` 并更新 `helloagents/archive/_index.md`。
