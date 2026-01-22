# 任务清单: TranslationPump 单条翻译/错误归一化逻辑抽离（Phase35）

目录: `helloagents/plan/202601221724_arch_refactor_phase35_translation_pump_translate/`

---

## 1. watch 模块
- [√] 1.1 新增 `codex_sidecar/watch/translation_pump_translate.py`
- [√] 1.2 重构 `codex_sidecar/watch/translation_pump_core.py` 复用 helper（行为保持不变）

## 2. 测试
- [√] 2.1 新增 `tests/test_translation_pump_translate.py` 覆盖关键分支

## 3. 文档更新
- [√] 3.1 更新 `helloagents/CHANGELOG.md` 记录本次重构
- [√] 3.2 更新 `helloagents/modules/rollout_sidecar.md` 增加模块条目（如适用）

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [√] 5.1 将本方案包迁移至 `helloagents/archive/2026-01/202601221724_arch_refactor_phase35_translation_pump_translate/` 并更新 `helloagents/archive/_index.md`
