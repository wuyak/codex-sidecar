# 轻量迭代任务清单：导出 Markdown 体验对齐 UI

- [√] 导出按钮：成功仅提示一次 toast（“已导出”）
- [√] 导出文件名：使用会话自定义名称 + 导出模式/语言（不再使用 `codex-sidecar_*`）
- [√] 精简导出：跟随“精简显示设置”选择的内容块（含思考/终端确认/更新计划等）
- [√] 译文导出：思考内容仅输出中文译文（不混入英文）
- [√] 导出渲染：对齐 UI（工具输出/树形摘要/代码块/编辑摘要等用 fenced code + `<details>`）
- [√] 更新知识库（CHANGELOG / Wiki）
- [√] 基础验证（`python3 -m unittest discover -s tests -p 'test_*.py' -q`）
