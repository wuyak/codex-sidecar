# 轻量迭代任务清单：书签栏右侧布局 + 图层修复 + 皮肤接口

- [√] 将“会话书签栏”从左侧移动到右侧空余区域（避开主列表与右侧工具栏）
- [√] 修复书签栏图层（z-index/层级顺序）避免被消息卡片遮挡，同时确保抽屉/提示层优先级正确
- [√] 增加书签皮肤接口（CSS Variables + `data-bm-skin`），默认外观不变
- [√] 同步更新知识库：`helloagents/modules/rollout_sidecar.md`
- [√] 更新变更日志：`helloagents/CHANGELOG.md`
- [√] 基础验证：`python3 -m compileall -q tools/codex_thinking_sidecar/codex_thinking_sidecar`

