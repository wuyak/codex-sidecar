# 轻量迭代任务清单：UI 切换无漂移稳定（tool 详情 / thinking 模式）

- [√] UI：新增 `stabilizeToggleNoDrift()`（切换前后测量 anchor `top` 差值并补偿滚动）
- [√] UI：工具“详情/收起”切换改用无漂移补偿（`ui/app/decorate/tool_toggle.js`）
- [√] UI：思考块 EN/ZH 切换改用无漂移补偿（`ui/app/interactions/thinking_rows.js`）
- [√] 文档同步：更新 `helloagents/CHANGELOG.md` 与 `helloagents/modules/rollout_sidecar.md`
- [√] 质量验证：`node --input-type=module` 导入检查（环境未安装 `pytest`）
- [√] 迁移方案包至 `helloagents/archive/` 并更新 `helloagents/archive/_index.md`
