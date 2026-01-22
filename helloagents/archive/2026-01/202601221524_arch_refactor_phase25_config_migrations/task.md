# 任务清单: Config migrations 模块化（Phase25）

目录: `helloagents/plan/202601221524_arch_refactor_phase25_config_migrations/`

---

## 1. config 模块
- [√] 1.1 新增 `codex_sidecar/config_migrations.py`（invariants + inplace migrations）
- [√] 1.2 重构 `codex_sidecar/config.py` 调用新模块（行为保持不变）

## 2. 文档更新
- [√] 2.1 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 3. 质量检查
- [√] 3.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 3.2 运行 `python3 -m unittest discover -s tests`

## 4. 方案包迁移
- [√] 4.1 将本方案包迁移至 `helloagents/archive/2026-01/202601221524_arch_refactor_phase25_config_migrations/` 并更新 `helloagents/archive/_index.md`
