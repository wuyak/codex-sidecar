# 任务清单: Bookmark drawer 模块化（Phase41）

目录: `helloagents/plan/202601221858_arch_refactor_phase41_bookmark_drawer_module/`

---

## 1. UI 控制层拆分
- [√] 1.1 新增 `ui/app/control/wire/bookmark_drawer.js`（抽屉渲染 + 交互）
- [√] 1.2 精简 `ui/app/control/wire.js`：移除抽屉逻辑，改为调用模块（行为保持不变）

## 2. 文档更新
- [√] 2.1 更新 `helloagents/modules/rollout_sidecar.md` 补充 wire 子模块示例

## 3. 质量检查
- [√] 3.1 运行 `python3 -m unittest discover -s tests`

## 4. 方案包迁移
- [√] 4.1 将本方案包迁移至 `helloagents/archive/2026-01/202601221858_arch_refactor_phase41_bookmark_drawer_module/` 并更新 `helloagents/archive/_index.md`

