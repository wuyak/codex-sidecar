# How - Phase51 export remove unused translate helper

## 方案

1. 移除 `ui/app/export.js` 内未被引用的 `_ensureReasoningTranslated(...)`。
2. 保留现有 direct/offline 两条导出翻译路径与调用点不变。
3. 运行后端单测与编译校验，确保重构未引入语法错误。

