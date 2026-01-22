# 任务清单: TranslationPump item 解析逻辑解耦（Phase21）

目录: `helloagents/plan/202601221439_arch_refactor_phase21_translation_pump_items/`

---

## 1. watch 模块
- [√] 1.1 新增 `codex_sidecar/watch/translation_pump_items.py`（pairs/ids 提取与过滤）
- [√] 1.2 重构 `codex_sidecar/watch/translation_pump_core.py` 使用 helper 并清理无用变量（行为保持不变）

## 2. 测试
- [√] 2.1 新增 `tests/test_translation_pump_items.py` 覆盖过滤规则

## 3. 文档更新
- [√] 3.1 更新 `helloagents/wiki/modules/rollout_sidecar.md`（watch 分层补充）
- [√] 3.2 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [ ] 5.1 将本方案包迁移至 `helloagents/history/2026-01/202601221439_arch_refactor_phase21_translation_pump_items/` 并更新 `helloagents/history/index.md`
