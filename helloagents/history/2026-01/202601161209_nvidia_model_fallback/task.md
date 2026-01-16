# 轻量迭代任务清单：NVIDIA 模型 404 自动回退

- [√] 修复：NVIDIA Chat Completions 在模型不可用导致 404 时，自动探测 `/models` 并回退到可用模型
- [√] 修复：NVIDIA Chat Completions `Content-Type` 兼容（避免 415 Unsupported media type）
- [√] 体验：更新 UI/占位提示的默认 NVIDIA 模型，避免新配置直接落到不可用模型
- [√] 文档：同步更新知识库中 NVIDIA 翻译模块的推荐模型与排障说明
- [√] 质量验证：本机实测一次翻译请求可返回译文（不再 404 空译文）
