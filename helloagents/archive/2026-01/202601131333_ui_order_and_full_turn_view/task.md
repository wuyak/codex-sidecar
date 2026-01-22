# 轻量迭代：UI 顺序（新内容在下）+ 展示用户/工具/回答

目标：
- 列表从上到下按时间顺序展示（新内容在底部）；
- 采集并展示：用户输入、工具调用/输出、最终回答；
- 仅对“思考内容”（reasoning summary / 可选 agent_reasoning）做翻译；工具输出与回答不翻译。

## 任务清单
- [√] watcher：提取 user_message / assistant message / tool call & output
- [√] watcher：仅对思考类条目调用翻译
- [√] UI：渲染顺序改为 append，并对 tool output 使用折叠展示
- [√] UI：自动滚动（仅在用户位于底部时）
- [√] 文档与 changelog 同步
- [√] 验证：py_compile + 启动后可见新类型
