# 轻量迭代任务清单：回放期批量翻译加速（OpenAI）

- [√] 翻译：OpenAI/Responses 翻译器识别 batch prompt，避免外层“只输出译文”包装导致 marker 失效
- [√] 文档：README / wiki 补充翻译队列与批量策略说明
- [√] 质量验证：`python3 -m py_compile ...`（如涉及 UI：`node --check`）
- [√] 迁移方案包至 `helloagents/history/` 并更新 `helloagents/history/index.md`
- [√] Git 提交
