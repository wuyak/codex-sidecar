# 任务清单: Watch Follow 目标计算解耦（Phase 5）

目录: `helloagents/plan/202601221034_arch_refactor_phase5_follow_targets/`

---

## 1. 拆分 targets 计算
- [√] 1.1 新增 `codex_sidecar/watch/follow_targets.py`（is_excluded/compute_follow_targets）
- [√] 1.2 `codex_sidecar/watch/rollout_watcher.py` 调整为使用新模块（保持行为一致）
- [√] 1.3 新增单测 `tests/test_follow_targets.py` 覆盖关键分支

## 2. 安全检查
- [√] 2.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 3. 文档更新
- [√] 3.1 更新 `helloagents/wiki/modules/rollout_sidecar.md`（记录 follow_targets 抽离点）
- [√] 3.2 更新 `helloagents/CHANGELOG.md` 与 `helloagents/history/index.md`

## 4. 测试
- [√] 4.1 运行单测：`python3 -m unittest discover -s tests`
- [√] 4.2 运行编译检查：`python3 -m compileall -q codex_sidecar`
