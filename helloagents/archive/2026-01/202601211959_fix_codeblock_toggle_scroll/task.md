# 任务清单: 修复代码块展开/收起导致的滚动焦点漂移

目录: `helloagents/plan/202601211959_fix_codeblock_toggle_scroll/`

---

## 1. UI 交互（代码块/工具详情切换）
- [√] 1.1 在 `ui/app/decorate/tool_toggle.js` 中恢复“基于点击位置的滚动稳定”逻辑：展开/收起后仍停留在同一代码块区域
- [√] 1.2 确保无事件坐标（非鼠标/非触控触发）时不发生意外滚动

## 2. 文档更新
- [√] 2.1 更新 `helloagents/modules/rollout_sidecar.md`：记录问题现象、根因与修复策略
- [√] 2.2 更新 `helloagents/CHANGELOG.md`：补充修复记录

## 3. 测试
- [√] 3.1 手动验证：在展开的长代码块内滚动到中下部后点击收起，视口应回到该代码块（而不是跳到其下方内容）
