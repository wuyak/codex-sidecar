# How - Phase50 export markdown utils

## 方案

1. 新增 `ui/app/export/markdown_utils.js`
   - `balanceFences(md)`：检测/补齐未闭合 fence
   - `safeCodeFence(text, lang)`：生成足够长的代码围栏，避免内容内 backticks 冲突
   - `convertKnownHtmlCodeBlocksToFences(md)`：将 `<pre class="code">` 转为 fenced code block
2. `ui/app/export.js`
   - 删除内联 `_balanceFences/_safeCodeFence/_convertKnownHtmlCodeBlocksToFences` 等，改为调用新模块导出函数。
3. 更新知识库，记录拆分点。
4. 运行后端单测与编译校验，确保重构不引入语法错误。

## 风险控制

- 逻辑保持与原实现一致（不改 fence 规则、不改替换正则）。
- 新模块为纯函数，不引入状态/副作用。

