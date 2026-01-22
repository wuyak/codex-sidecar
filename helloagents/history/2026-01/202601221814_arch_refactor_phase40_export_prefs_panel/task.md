# 任务清单: Export prefs panel 拆分（Phase40）

目录: `helloagents/plan/202601221814_arch_refactor_phase40_export_prefs_panel/`

---

## 1. UI 控制层拆分
- [√] 1.1 新增 `ui/app/control/wire/export_prefs_panel.js` 封装导出偏好弹层逻辑
- [√] 1.2 重构 `ui/app/control/wire.js` 调用 controller 并保留 `_openExportPrefsPanel` 接口（行为保持不变）

## 2. 文档更新
- [√] 2.1 更新 `helloagents/wiki/modules/rollout_sidecar.md` 补充 wire 子模块示例

## 3. 质量检查
- [√] 3.1 运行 `python3 -m unittest discover -s tests`

## 4. 方案包迁移
- [√] 4.1 将本方案包迁移至 `helloagents/history/2026-01/202601221814_arch_refactor_phase40_export_prefs_panel/` 并更新 `helloagents/history/index.md`

