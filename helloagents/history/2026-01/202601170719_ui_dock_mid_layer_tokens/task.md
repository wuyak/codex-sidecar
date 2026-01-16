# 任务清单：右侧控件右中定位 + 顶层图层 + 设计 token 统一 + 去 emoji

- [√] 右侧工具栏（actions）移动到右侧中间（小屏高度时自动回退到顶部）
- [√] 书签栏保持右侧中间，且不挤压主列表宽度
- [√] 提升图层：右侧工具栏/书签栏/底部浮动按钮覆盖主列表内容（抽屉 overlay 仍为最高优先级）
- [√] 统一设计 token：颜色/危险色/阴影/焦点 ring，应用到按钮/表单/抽屉/tool 卡片/pill 等组件
- [√] UI 按钮图标全面改为 SVG（移除 emoji/文本箭头覆写）
- [√] 冒烟验证：`codex_thinking_sidecar --ui` + `/health`、`/ui`、`/ui/styles.css`
- [√] Python：`python3 -m compileall -q tools/codex_thinking_sidecar/codex_thinking_sidecar`

