# 任务清单：Dock 质感 + 排版细节 + Markdown/工具块统一

- [√] 右侧工具栏 Dock：增加半透明背景/阴影/圆角容器，统一为“一个组件”的视觉
- [√] 修正书签栏与 Dock 的横向偏移（考虑 Dock padding/边框），避免贴太近或重叠
- [√] 顶栏视觉清理：`#topbar` 不再显示卡片边框与阴影
- [√] Badge 样式统一：加边框与文字色，减少“塑料感”
- [√] Markdown/table/code/pill/tool-card/mini-btn 等细节统一到设计 token（颜色/边框/焦点 ring）
- [√] 冒烟验证：`codex_thinking_sidecar --ui` + `/health`、`/ui`、`/ui/styles.css`
- [√] Python：`python3 -m compileall -q tools/codex_thinking_sidecar/codex_thinking_sidecar`

