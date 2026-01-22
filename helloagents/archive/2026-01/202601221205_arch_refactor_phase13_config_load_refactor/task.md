# 任务清单: config.load_config 结构化重构（Phase 13）

目录: `helloagents/plan/202601221205_arch_refactor_phase13_config_load_refactor/`

---

## 1. config 重构
- [√] 1.1 重构 `codex_sidecar/config.py`：拆分 `load_config()` 为线性流程 + helper（行为保持不变）

## 2. 测试
- [√] 2.1 新增 `tests/test_config_load_migrations.py` 覆盖关键迁移语义

## 3. 安全检查
- [√] 3.1 确认迁移与导入候选路径不扩大（按G9）

## 4. 文档更新
- [√] 4.1 更新 `helloagents/CHANGELOG.md` 记录本次重构
- [-] 4.2（可选）如有必要，补充 `helloagents/modules/rollout_sidecar.md` 中对 config 迁移的说明

## 5. 验证
- [√] 5.1 执行 `python3 -m compileall -q codex_sidecar`
- [√] 5.2 执行 `python3 -m unittest discover -s tests`
