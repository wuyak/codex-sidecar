# 任务清单: TranslationPump 队列/去重解耦（Phase 7）

目录: `helloagents/plan/202601221048_arch_refactor_phase7_translation_pump_queue/`

---

## 1. 队列模块化
- [√] 1.1 新增 `codex_sidecar/watch/translation_queue.py`（seen/inflight/force_after + drop 策略）
- [√] 1.2 `codex_sidecar/watch/translation_pump_core.py` 使用新模块（行为一致）
- [√] 1.3 新增单测 `tests/test_translation_pump_queue.py`

## 2. 安全检查
- [√] 2.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 3. 文档更新
- [√] 3.1 更新 `helloagents/wiki/modules/rollout_sidecar.md`
- [√] 3.2 更新 `helloagents/CHANGELOG.md` 与 `helloagents/history/index.md`

## 4. 测试
- [√] 4.1 运行单测：`python3 -m unittest discover -s tests`
- [√] 4.2 运行编译检查：`python3 -m compileall -q codex_sidecar`
