# 任务清单: 架构梳理与分层解耦（不改功能）

目录: `helloagents/plan/202601212239_arch_refactor_codebase/`

---

## 1. watch 层分层
- [√] 1.1 `codex_sidecar/watcher.py` 改为 facade（向后兼容导入路径）
- [√] 1.2 核心实现迁移至 `codex_sidecar/watch/rollout_watcher.py`
- [√] 1.3 抽离 `HttpIngestClient` 到 `codex_sidecar/watch/ingest_client.py`
- [√] 1.4 抽离 tool gate 提示到 `codex_sidecar/watch/approval_hint.py`

## 2. controller 分层
- [√] 2.1 `codex_sidecar/controller.py` 改为 facade（向后兼容导入路径）
- [√] 2.2 核心实现迁移至 `codex_sidecar/controller_core.py`
- [√] 2.3 保留 `codex_sidecar.controller.build_translator` 可被测试/工具 patch 的兼容路径

## 3. HTTP handler 解耦
- [√] 3.1 抽取 `/api/config`、`/api/status`、`/api/sfx`、`/api/offline/*` 的重复逻辑为辅助方法，降低分支重复
- [√] 3.2 新增 HTTP 控制面回归测试覆盖（config/status）

## 4. 验证
- [√] 4.1 单元测试：`python3 -m unittest discover -s tests`
- [√] 4.2 语法检查：`python3 -m compileall -q ...`

