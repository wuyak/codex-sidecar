# 任务清单：书签栏右中定位 + 顶层图层 + 系统性 UI 美化 + Git 提交

## UI 位置/图层
- [√] 书签栏移动到“右侧中间”（固定居中，不占布局宽度）
- [√] 书签栏图层提升：覆盖主列表/右侧按钮/底部浮动按钮，但仍低于抽屉 overlay

## 统一按钮设计
- [√] 右侧工具栏与底部浮动按钮统一为 SVG 图标（替换字符/emoji），保持可访问性（aria-label）
- [√] 抽离设计 token（颜色/阴影/尺寸）到 CSS Variables，并统一应用到按钮/卡片

## 验证
- [√] 冒烟：启动 `--ui` 并验证 `/health`、`/ui`、`/ui/styles.css`
- [√] Python：`python3 -m compileall -q .`

## 交付
- [ ] 迁移方案包到 `helloagents/archive/`
- [ ] 更新 `helloagents/archive/_index.md` 与 `helloagents/CHANGELOG.md`
- [ ] 生成 Git 提交（一次或按逻辑拆分多次）
