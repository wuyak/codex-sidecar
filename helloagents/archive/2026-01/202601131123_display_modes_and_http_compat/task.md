# 轻量迭代：显示模式（三种）+ HTTP 翻译兼容

目标：
1) UI 增加三种显示模式：仅中文 / 仅英文 / 中英文对照；
2) HTTP 翻译适配更多常见字段（DeepLX 等），减少“无译文”的情况。

## 任务清单
- [√] 翻译器：请求体兼容（source/target + source_lang/target_lang），响应解析兼容多字段
- [√] UI：新增显示模式切换并持久化（localStorage），渲染按模式输出
- [√] 文档/变更：更新说明与 changelog
- [√] 验证：bash 语法检查 + python 编译检查
