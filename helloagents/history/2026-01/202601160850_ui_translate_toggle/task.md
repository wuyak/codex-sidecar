# 轻量迭代任务清单：右侧栏“自动翻译”快捷开关

- [ ] 右侧栏新增“自动翻译”按钮（切换 auto/manual）
- [ ] UI 同步：按钮状态与配置面板 translateMode 一致，并在 loadControl 后自动刷新
- [ ] 后端热更新：translate_mode 变更无需重启 watcher（对运行中实例立即生效）
- [ ] 文档同步：更新 wiki + changelog
- [ ] 质量验证：python/node 语法检查

## 执行结果
- [√] 右侧栏新增“自动翻译”按钮（切换 auto/manual）
- [√] UI 同步：按钮状态与配置面板 translateMode 一致，并在 loadControl 后自动刷新
- [√] 后端热更新：translate_mode 变更无需重启 watcher（对运行中实例立即生效）
- [√] 文档同步：更新 wiki + changelog
- [√] 质量验证：`python3 -m py_compile` + `node --check --experimental-default-type=module` 通过
