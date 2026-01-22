# 任务清单: TranslationPump 批量翻译执行解耦（Phase 11）

目录: `helloagents/plan/202601221150_arch_refactor_phase11_translation_batch_worker/`

---

## 1. watch 分层
- [√] 1.1 新增 `codex_sidecar/watch/translation_batch_worker.py`：抽离批量翻译执行/回退逻辑
- [√] 1.2 重构 `codex_sidecar/watch/translation_pump_core.py`：调用 batch_worker，保持行为不变

## 2. 测试
- [√] 2.1 新增 `tests/test_translation_batch_worker.py` 覆盖空输出不回退、缺失项回退、stop 中断

## 3. 安全检查
- [√] 3.1 确认批量失败仍不触发逐条回退（避免请求风暴），不引入敏感信息输出（按G9）

## 4. 文档更新
- [√] 4.1 更新 `helloagents/modules/rollout_sidecar.md` 记录模块边界变化
- [√] 4.2 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 5. 验证
- [√] 5.1 执行 `python3 -m compileall -q codex_sidecar`
- [√] 5.2 执行 `python3 -m unittest discover -s tests`
