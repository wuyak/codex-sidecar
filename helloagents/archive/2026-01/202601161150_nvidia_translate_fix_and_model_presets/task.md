# 轻量迭代任务清单：NVIDIA 翻译修复 + 模型预设

- [√] 修复：NVIDIA Chat Completions 响应解析更健壮（兼容 `message.content` 非字符串形态），避免误判空译文
- [√] 诊断：将 NVIDIA 返回的错误信息（如 error.message）纳入 `translate_error`，便于 UI 直接定位 401/429/模型不可用等原因
- [√] UI：为 NVIDIA Model 增加预设候选（datalist/下拉），可快速切换常用模型
- [√] 质量验证：`python3 -m py_compile`；`node --check`（相关 UI 模块）
