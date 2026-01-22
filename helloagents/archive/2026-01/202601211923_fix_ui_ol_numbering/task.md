# 任务清单: 修复 UI 有序列表序号丢失（始终从 1 开始）

目录: `helloagents/plan/202601211923_fix_ui_ol_numbering/`

---

## 1. UI Markdown 渲染
- [√] 1.1 在 `ui/app/markdown/render.js` 中让有序列表保留原始序号（输出 `<li value="N">`）
- [√] 1.2 在 `ui/app/markdown/render.js` 中修正 list item “续行合并”逻辑，兼容带 value 的 list item 结构

## 2. 安全检查
- [√] 2.1 检查 HTML 输出是否存在注入风险（仅允许数字 value）

## 3. 文档更新
- [√] 3.1 更新 `helloagents/modules/rollout_sidecar.md`：记录根因与修复方式
- [√] 3.2 更新 `helloagents/CHANGELOG.md`：补充一条修复记录

## 4. 测试
- [√] 4.1 用 node 复现实例验证：跨段落/混合列表时序号仍按原文递增显示
