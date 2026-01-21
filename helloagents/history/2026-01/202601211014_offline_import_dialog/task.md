# 任务清单：离线对话“展示”接入（导入对话 + 只读渲染/翻译/导出复用）

目录：`helloagents/plan/202601211014_offline_import_dialog/`

---

## 1. UI：导入对话入口与文件列表
- [√] 1.1 右侧工具栏“导入对话”按钮打开/关闭弹窗（popover 风格）
- [√] 1.2 弹窗支持手动输入 `rel` 并导入打开
- [√] 1.3 弹窗展示最近 `rollout-*.jsonl`，按 `sessions/YYYY/MM/DD` 分组
- [√] 1.4 导入后进入“展示中”列表与展示标签栏，关闭=移除展示

## 2. 代码清理与一致性
- [√] 2.1 清理旧的“会话管理抽屉内加入展示”UI 绑定（DOM id / 事件监听 / 文案）
- [√] 2.2 状态字段补齐：`offlineFiles/offlineFilesLastSyncMs` 显式纳入 state（避免隐式挂载）

## 3. 文档与变更记录
- [√] 3.1 更新 `helloagents/wiki/modules/rollout_sidecar.md`：补充“导入对话”入口与使用说明
- [√] 3.2 更新 `helloagents/CHANGELOG.md`

## 4. 验证
- [√] 4.1 运行 `python3 -m unittest discover -s tests -p 'test_*.py' -q`
- [√] 4.2 Smoke 验证：`--ui` 模式下离线 `/api/offline/files` 与 `/api/offline/messages` 可在不启动 watcher 时正常工作
