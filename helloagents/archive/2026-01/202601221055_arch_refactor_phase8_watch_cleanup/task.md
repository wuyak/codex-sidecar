# 任务清单: Watcher 清理遗留死代码（Phase 8）

目录: `helloagents/plan/202601221055_arch_refactor_phase8_watch_cleanup/`

---

## 1. 清理
- [√] 1.1 删除 `codex_sidecar/watch/rollout_watcher.py` 中的 `_replay_tail()` 死代码

## 2. 安全检查
- [√] 2.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 3. 文档更新
- [√] 3.1 更新 `helloagents/CHANGELOG.md` 与 `helloagents/archive/_index.md`（如有必要）

## 4. 测试
- [√] 4.1 运行单测：`python3 -m unittest discover -s tests`
- [√] 4.2 运行编译检查：`python3 -m compileall -q codex_sidecar`
