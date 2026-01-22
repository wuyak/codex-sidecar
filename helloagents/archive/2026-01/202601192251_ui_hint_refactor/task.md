# 任务清单: UI 提示系统统一与会话管理整改

目录: `helloagents/plan/202601192251_ui_hint_refactor/`

---

## 1. 提示系统统一（方案2）
- [√] 1.1 在 `ui/styles.css` 中统一 tooltip 风格：以 `aria-label` 为 SSOT，补齐 `.float-nav` 的 hover 信息栏样式，验证 why.md#核心场景-需求-1-精简信息按钮-场景-悬停提示与状态同步
- [√] 1.2 在 `ui/app/control/ui.js`、`ui/app/view_mode.js` 中移除 `title` 造成的双提示来源，并改为动态更新精简显示按钮 `aria-label`，验证 why.md#核心场景-需求-1-精简信息按钮
- [√] 1.3 在 `ui/app/control/wire.js` 中移除“折叠/展开标签页”的 toast 提示，保证长按无浮动信息，验证 why.md#核心场景-需求-2-会话管理按钮-场景-长按不再弹浮动提示

## 2. 标签页提示整改（重命名 / 关闭监听）
- [√] 2.1 在 `ui/app/sidebar/tabs.js` 中移除 hover toast（避免“标签弹出浮动信息”叠加），并统一使用信息栏提示（重命名/关闭监听），验证 why.md#核心场景-需求-3-5-标签提示
- [√] 2.2 在 `ui/styles.css` 中实现信息栏样式与时机（hover/close-hover 文案切换），验证 why.md#核心场景-需求-3-5-标签提示

## 3. 会话管理抽屉整改（布局 / 提示 / 导出按钮）
- [√] 3.1 在 `ui/app/control/wire.js` 中移除会话条目 `data-hint` 与相关提示触发，确保不出现“点击：切换会话”，验证 why.md#核心场景-需求-11-切换会话提示移除
- [√] 3.2 在 `ui/app/control/wire.js` 中调整会话副标题：不显示原始文件名，改为“长按复制对话 JSON 路径”，并实现长按复制，验证 why.md#核心场景-需求-12-会话信息页面
- [√] 3.3 在 `ui/styles.css` 中实现导出按钮角标（`.mini-flag`）定位与显隐逻辑，保证 4 状态组合显示正确，验证 why.md#核心场景-需求-6-会话管理内部布局-场景-导出按钮-4-状态角标
- [√] 3.4 在 `ui/index.html`、`ui/styles.css`、`ui/app/control/wire.js` 中修复导出设置弹层层级与冗余内容（移除“当前会话”），并统一导出按钮提示为 `导出（长按设置）`，验证 why.md#核心场景-需求-9-10-导出设置与提示

## 4. 精简显示弹层 UI 对齐
- [√] 4.1 在 `ui/app/quick_view_settings.js` 中将列表渲染切换为 `.qk-panel/.qk-row` 结构，使用 `aria-pressed` 表达选中状态，验证 why.md#核心场景-需求-7-精简显示弹层样式
- [√] 4.2 在 `ui/styles.css` 中降级旧 checkbox 列表样式影响，确保视觉与配图一致，验证 why.md#核心场景-需求-7-精简显示弹层样式

## 5. 顶部状态栏移除
- [√] 5.1 在 `ui/index.html` 中移除顶部右侧状态栏 DOM（`#statusText/#statusHover`），验证 why.md#核心场景-需求-8-顶部状态栏移除
- [√] 5.2 在 `ui/app/dom.js`、`ui/app/control/load.js` 中保持引用兜底（元素不存在时跳过），保证运行无报错

## 6. Git 提交（用户要求）
- [√] 6.1 每完成一次“单条整改项/独立交互面”执行 `git status`→`git commit`（更细粒度；提交信息遵循 how.md#Git-提交策略-用户要求）

## 7. 安全检查
- [√] 7.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 8. 测试
- [√] 8.1 运行 `python3 -m unittest discover -s tests -p "test_*.py" -q`（OK）
