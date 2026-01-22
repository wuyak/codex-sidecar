# 任务清单: UI 会话标签栏稳定顺序与未读徽标优化

目录: `helloagents/plan/202601192302_ui_tabs_stable_order_badge/`

---

## 1. 会话标签栏稳定性
- [√] 1.1 修复底部会话标签栏随消息刷新频繁重排导致“来回跳”的问题（保持稳定顺序）
- [√] 1.2 保留横向滚动位置，避免 SSE 触发重绘时滚动条抖动

## 2. 未读提示展示优化
- [√] 2.1 调整未读徽标位置/样式，避免遮挡标签名字与关闭按钮

## 3. 文档更新
- [√] 3.1 更新 `helloagents/modules/rollout_sidecar.md`（补充标签顺序与未读徽标说明）
- [√] 3.2 更新 `helloagents/CHANGELOG.md`（记录本次 UI 修复/改进）

## 4. 质量检查
- [√] 4.1 执行前端语法检查（`node --check`）

## 5. 收尾
- [√] 5.1 迁移方案包到 `helloagents/archive/YYYY-MM/` 并更新 `helloagents/archive/_index.md`
