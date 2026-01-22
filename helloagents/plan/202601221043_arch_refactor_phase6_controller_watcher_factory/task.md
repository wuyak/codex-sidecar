# 任务清单: Controller Watcher 构建解耦（Phase 6）

目录: `helloagents/plan/202601221043_arch_refactor_phase6_controller_watcher_factory/`

---

## 1. watcher factory
- [√] 1.1 新增 `codex_sidecar/control/watcher_factory.py`（构建 watcher + 注入 follow 状态）
- [√] 1.2 `codex_sidecar/controller_core.py` 的 `start()` 改为调用 factory（保持行为一致）

## 2. 安全检查
- [√] 2.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 3. 文档更新
- [√] 3.1 更新 `helloagents/wiki/modules/rollout_sidecar.md`
- [ ] 3.2 更新 `helloagents/CHANGELOG.md` 与 `helloagents/history/index.md`

## 4. 测试
- [√] 4.1 运行单测：`python3 -m unittest discover -s tests`
- [√] 4.2 运行编译检查：`python3 -m compileall -q codex_sidecar`
