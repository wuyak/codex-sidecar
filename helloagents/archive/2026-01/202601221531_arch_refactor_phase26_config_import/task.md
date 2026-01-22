# 任务清单: Config legacy import 模块化（Phase26）

目录: `helloagents/plan/202601221531_arch_refactor_phase26_config_import/`

---

## 1. config 模块
- [√] 1.1 新增 `codex_sidecar/config_import.py`（legacy homes/snapshots 导入）
- [√] 1.2 重构 `codex_sidecar/config.py` 调用新模块（行为保持不变）

## 2. 测试
- [√] 2.1 新增 `tests/test_config_import_legacy.py` 覆盖关键分支

## 3. 文档更新
- [√] 3.1 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [√] 5.1 将本方案包迁移至 `helloagents/archive/2026-01/202601221531_arch_refactor_phase26_config_import/` 并更新 `helloagents/archive/_index.md`
