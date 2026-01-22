# 任务清单: translator 元信息解析抽离（Phase36）

目录: `helloagents/plan/202601221729_arch_refactor_phase36_translator_meta/`

---

## 1. control 模块
- [√] 1.1 新增 `codex_sidecar/control/translator_meta.py`
- [√] 1.2 重构 `codex_sidecar/controller_core.py` 引用 helper（行为保持不变）

## 2. 测试
- [√] 2.1 新增 `tests/test_translator_meta.py` 覆盖关键分支

## 3. 文档更新
- [√] 3.1 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [ ] 5.1 将本方案包迁移至 `helloagents/history/2026-01/202601221729_arch_refactor_phase36_translator_meta/` 并更新 `helloagents/history/index.md`
