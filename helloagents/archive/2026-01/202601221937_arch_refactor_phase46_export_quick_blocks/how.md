# How - Phase46 export quick blocks

## 方案

1. 新增 `ui/app/export/quick_blocks.js`
   - 提供 `getQuickBlocks(state)`：封装 quick blocks 的 sanitize + localStorage 加载 + 默认回退策略。
2. `ui/app/export.js`
   - 删除内联 `_sanitizeQuickBlocks/_loadQuickBlocksFromLocalStorage/_getQuickBlocks` 与相关常量，改为调用 `getQuickBlocks(state)`。
3. 更新知识库，记录导出模块拆分点。
4. 运行后端单测与编译校验，确保重构不影响既有行为。

## 风险控制

- 抽离模块仅包含纯逻辑与 localStorage 读取，不涉及导出主体行为与渲染细节。
- 返回类型保持一致（`Set<string>`）。

