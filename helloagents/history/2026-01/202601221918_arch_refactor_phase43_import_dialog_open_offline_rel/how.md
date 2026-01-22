# How - Phase43 import dialog open offline rel

## 方案

1. 新增 `ui/app/control/wire/import_dialog/open_offline_rel.js`
   - 封装 `normalizeRelForImport()` 与 `openOfflineRel()`（以 `createOpenOfflineRel(dom, state, helpers)` 形式返回 closure）。
   - 模块内部负责：rel 归一化、合法性校验、`offline_show` 更新、触发 `onSelectKey`、关闭导入弹窗与书签抽屉。
2. `ui/app/control/wire/import_dialog.js`
   - 保留渲染与列表逻辑，改为通过 `createOpenOfflineRel(...)` 获取 `openOfflineRel`，删除重复内联实现。
3. 同步更新知识库，记录 UI wire 拆分点。
4. 运行后端单测与编译校验（重构不影响 Python 行为）。

## 风险控制

- 仅移动并封装逻辑，不改变分支与提示文案。
- 通过 helpers 注入 `setImportError/renderTabs/renderBookmarkDrawerList/onSelectKey`，避免引入额外依赖与循环引用。

