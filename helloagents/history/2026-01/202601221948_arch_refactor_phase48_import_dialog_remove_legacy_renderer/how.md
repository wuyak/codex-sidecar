# How - Phase48 import dialog remove legacy renderer

## 方案

1. 删除 `renderImportListLegacy` 及其内部仅用于 legacy renderer 的辅助逻辑（包含 `parseYmd` 等）。
2. 保留并不改动当前使用中的 `renderImportList()` 渲染路径。
3. 运行后端单测与编译校验，确保重构未引入语法错误或回归。

## 风险控制

- 通过全文搜索确认 `renderImportListLegacy` 未被引用后再移除。
- 不调整现用逻辑分支与 UI 文案。

