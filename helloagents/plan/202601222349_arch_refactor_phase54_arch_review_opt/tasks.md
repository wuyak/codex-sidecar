# 任务清单: 架构审视与优化（Phase54）

目录: `helloagents/plan/202601222349_arch_refactor_phase54_arch_review_opt/`

---

## 1. SSE 模块化与断线补齐（Phase54.1）
- [√] 1.1 抽离 SSE 辅助逻辑到 `codex_sidecar/http/sse.py`（解析 `Last-Event-ID`、构造 event bytes、可选补齐）。
- [√] 1.2 调整 `codex_sidecar/http/handler.py` 复用新模块：
  - 仅对非 `op=update` 事件写入 `id:`（避免 update 事件回填导致游标倒退）。
  - 仅当客户端带 `Last-Event-ID` 时进行补齐（首连不回放历史）。
- [√] 1.3 更新/新增单测：SSE 正常推送 + 断线补齐行为（Last-Event-ID）。

## 2. 启动脚本去重（Phase54.2）
- [√] 2.1 新增 `scripts/_common.sh`：集中 `open_browser`、health check、lock pid 读取等公共逻辑。
- [√] 2.2 `scripts/run.sh`、`scripts/ui.sh` 改为 `source scripts/_common.sh` 并移除重复实现（行为不变）。
- [√] 2.3 基础验证：`bash -n scripts/run.sh scripts/ui.sh scripts/_common.sh`。

## 3. Config 模型整理（Phase54.3）
- [ ] 3.1 `SidecarConfig.translator_config` 改为 `field(default_factory=dict)`，清理 `None` 分支与序列化兜底（行为不变）。
- [ ] 3.2 回归测试：确保 config load/migrations 相关测试通过。

## 4. 收尾与归档（Phase54.4）
- [ ] 4.1 更新 `helloagents/CHANGELOG.md`（记录 Phase54 的结构性优化）。
- [ ] 4.2 将本方案包迁移至 `helloagents/archive/2026-01/` 并更新 `helloagents/archive/_index.md`。
- [ ] 4.3 质量验证：`python3 -m compileall -q codex_sidecar`、`python3 -m unittest discover -s tests`。
