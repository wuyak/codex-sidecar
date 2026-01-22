# 任务清单: UI prefs SSOT（Phase38）

目录: `helloagents/plan/202601221803_arch_refactor_phase38_ui_prefs_ssot/`

---

## 1. UI 控制层重构
- [√] 1.1 新增 `ui/app/control/ui_prefs.js` 统一 localStorage key 与应用逻辑
- [√] 1.2 重构 `ui/app/control/load.js` 使用 SSOT（行为保持不变）
- [√] 1.3 重构 `ui/app/control/wire.js` 使用 SSOT（行为保持不变）

## 2. 文档更新
- [√] 2.1 更新 `helloagents/modules/rollout_sidecar.md` 记录 SSOT 位置

## 3. 质量检查
- [√] 3.1 运行 `python3 -m unittest discover -s tests`

## 4. 方案包迁移
- [√] 4.1 将本方案包迁移至 `helloagents/archive/2026-01/202601221803_arch_refactor_phase38_ui_prefs_ssot/` 并更新 `helloagents/archive/_index.md`

