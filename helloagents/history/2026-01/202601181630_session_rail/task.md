# 任务清单: 右侧会话书签轨（Navigation Rail）

目录: `helloagents/plan/202601181630_session_rail/`

---

## 1. UI（会话书签轨）
- [√] 1.1 在 `ui/index.html` 中为会话书签轨渲染预留结构/语义（复用 `#bookmarks`），验证 why.md#需求-更直观的会话切换-场景-右侧中部快捷切换（1~6）
- [√] 1.2 在 `ui/styles.css` 中实现“右侧中部 rail + 悬停 popover + 右侧按钮靠下”布局，验证 why.md#需求-更直观的会话切换-场景-查看与管理完整会话列表（悬停展开）

## 2. 会话渲染（不改业务逻辑）
- [√] 2.1 在 `ui/app/sidebar/tabs.js` 中渲染 rail（1~6）并保证当前会话可见，验证 why.md#需求-更直观的会话切换-场景-右侧中部快捷切换（1~6）
- [√] 2.2 在 `ui/app/sidebar/tabs.js` 中渲染 popover（全量列表），复用既有右键/重命名/隐藏逻辑，验证 why.md#需求-更直观的会话切换-场景-查看与管理完整会话列表（悬停展开）

## 3. 安全检查
- [√] 3.1 执行安全检查（按G9: 不引入敏感信息、无危险命令、无越权行为）

## 4. 文档更新
- [√] 4.1 更新 `helloagents/wiki/modules/rollout_sidecar.md`
- [√] 4.2 更新 `helloagents/CHANGELOG.md`

## 5. 测试
- [√] 5.1 运行基础测试：`python3 -m unittest discover -s tests -p "test_*.py"` + `node --check ui/app/sidebar/tabs.js`（环境未安装 pytest）
