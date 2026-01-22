# How - Phase44 import dialog import index

## 方案

1. 新增 `ui/app/control/wire/import_dialog/import_index.js`
   - 提供 `buildImportIndex(files)`：从 `offlineFiles` 构建 `{ byDate, countByMonth, countByYear, minDate, maxDate, other }`。
   - 内部包含 `parseYmdFromRel(rel)`，与原逻辑保持一致。
2. `import_dialog.js`
   - `renderImportList()` 中改为调用 `buildImportIndex(files)`，并将原本依赖的局部变量按需解构（`byDate/countByMonth/...`）。
3. 更新知识库，记录 UI wire 的进一步拆分点。
4. 运行后端单测与编译校验，确保重构不影响既有行为。

## 风险控制

- 抽离为纯函数，输入/输出类型保持不变（Map/Array/Date）。
- 不调整排序/计数/日期边界规则，避免 UI 行为改变。

