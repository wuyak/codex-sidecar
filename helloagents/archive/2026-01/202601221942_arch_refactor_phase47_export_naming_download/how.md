# How - Phase47 export naming download

## 方案

1. 新增 `ui/app/export/naming.js`
   - `pickCustomLabel()`：统一从 key/threadId/filePath/历史 uuid key 读取自定义会话名。
   - `sanitizeFileName()`：导出文件名安全清洗（跨平台）。
   - `baseName()`：源文件 basename 处理。
2. 新增 `ui/app/export/download.js`
   - `downloadTextFile(name, text, mime)`：封装 Blob + a.click 下载触发。
3. `ui/app/export.js`
   - 删除内联命名/下载函数，改为调用上述模块导出函数。
4. 更新知识库，记录导出模块拆分点。
5. 运行后端单测与编译校验，确保重构不影响既有行为。

## 风险控制

- 仅移动与封装，不改变导出文件名生成规则与下载 MIME。
- 对外暴露函数签名明确，避免引入循环依赖。

