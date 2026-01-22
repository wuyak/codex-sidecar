# 任务清单: TranslationPump 批处理逻辑解耦（Phase18）

目录: `helloagents/plan/202601221358_arch_refactor_phase18_translation_pump_batching/`

---

## 1. watch 模块
- [√] 1.1 新增 `codex_sidecar/watch/translation_pump_batching.py`，抽离 lo 队列 batch 聚合逻辑并保持行为等价
- [√] 1.2 重构 `codex_sidecar/watch/translation_pump_core.py` 的 `_worker()` 调用 helper

## 2. 测试
- [√] 2.1 新增 `tests/test_translation_pump_batching.py` 覆盖聚合/回退/截断逻辑

## 3. 文档更新
- [√] 3.1 更新 `helloagents/modules/rollout_sidecar.md`（watch 分层补充）
- [√] 3.2 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [√] 5.1 将本方案包迁移至 `helloagents/archive/2026-01/202601221358_arch_refactor_phase18_translation_pump_batching/` 并更新 `helloagents/archive/_index.md`
