# 任务清单: UI wire 拆分（secrets/sfx）（Phase39）

目录: `helloagents/plan/202601221808_arch_refactor_phase39_ui_wire_secrets_sfx/`

---

## 1. UI 控制层拆分
- [√] 1.1 新增 `ui/app/control/wire/secrets.js` 并迁移密钥显隐逻辑
- [√] 1.2 新增 `ui/app/control/wire/sfx.js` 并迁移提示音选择逻辑
- [√] 1.3 精简 `ui/app/control/wire.js`：改为调用子模块（行为保持不变）

## 2. 文档更新
- [√] 2.1 更新 `helloagents/wiki/modules/rollout_sidecar.md` 补充 wire 子模块示例

## 3. 质量检查
- [√] 3.1 运行 `python3 -m unittest discover -s tests`

## 4. 方案包迁移
- [√] 4.1 将本方案包迁移至 `helloagents/history/2026-01/202601221808_arch_refactor_phase39_ui_wire_secrets_sfx/` 并更新 `helloagents/history/index.md`

