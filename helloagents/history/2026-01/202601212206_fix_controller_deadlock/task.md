# 任务清单: controller 配置更新自锁死锁修复

目录: `helloagents/plan/202601212206_fix_controller_deadlock/`

---

## 1. 后端修复
- [√] 1.1 修复 `SidecarController._patch_config()`：避免在持有 `self._lock` 时触发 watcher 热更新导致自锁死锁
- [√] 1.2 增加回归测试：确保 `update_config()` 不会卡死

## 2. 文档更新
- [√] 2.1 更新 `helloagents/wiki/modules/rollout_sidecar.md`：记录“/health 正常但控制面卡死”的根因与修复
- [√] 2.2 更新 `helloagents/CHANGELOG.md`：补充修复记录

## 3. 验证
- [√] 3.1 运行单元测试：`python3 -m unittest discover -s tests`
- [?] 3.2 现场验证：启动 sidecar 后修改配置（触发 `POST /api/config`），确认 `/api/config` 与 `/api/status` 可持续响应且 UI 不再出现“空白/无数据”

