# 技术设计: 右侧会话书签轨（Navigation Rail）

## 技术方案
### 核心技术
- 纯静态 HTML/CSS/JS（不引入前端框架）
- 复用既有会话索引：`state.threadIndex/currentKey`、未读统计 `unread.js`、隐藏会话 `sidebar/hidden.js`
- 复用既有切换入口：`onSelectKey()`（包含 follow policy 与回放逻辑）

### 实现要点
- 将 `#bookmarks` 从“左侧隐藏面板”改为“右侧中部会话书签轨”
- `tabs.js` 同时渲染两层：
  1) **Rail（1~6）**：圆形图标按钮（快捷切换）
  2) **Popover（全量）**：悬停/聚焦时显示的完整会话列表面板
- 右侧按钮组 `#rightbar` 改为靠下固定定位；`float-nav` 保持底部

## 交互与可访问性（对齐 ui-skills 原则）
- icon-only 会话按钮提供 `aria-label`（即便视觉隐藏标签）
- 键盘可达：Tab 可聚焦到会话按钮；`focus-within` 触发展开面板
- 动效仅使用 `transform/opacity`，并尊重 `prefers-reduced-motion`
- fixed 元素遵守 `safe-area-inset-*`，避免贴边遮挡

## 测试与验证
- 视觉：右侧中部出现 1~6 会话书签；右侧操作按钮更靠下；滚动按钮最底
- 功能：点击会话书签后，选中态/未读计数/消息列表刷新行为与旧版一致
- 面板：悬停/聚焦时显示完整会话列表；离开即收起；不挤压对话区
- 可访问性：键盘可切换；tooltip/aria-label 完整；无焦点陷阱

