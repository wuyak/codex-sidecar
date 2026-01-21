# 任务清单: 稳定滚动条槽位，消除弹窗/精简切换抖动

目录: `helloagents/plan/202601212038_fix_ui_scrollbar_gutter/`

---

## 1. UI 样式
- [√] 1.1 在 `ui/styles.css` 中启用 `scrollbar-gutter: stable`（全局预留滚动条槽位）

## 2. 文档更新
- [√] 2.1 更新 `helloagents/wiki/modules/rollout_sidecar.md`：记录该体验优化与原理
- [√] 2.2 更新 `helloagents/CHANGELOG.md`：补充变更记录

## 3. 验证
- [?] 3.1 手动验证：打开/关闭弹窗与切换精简模式时，右侧固定元素不再左右抖动
