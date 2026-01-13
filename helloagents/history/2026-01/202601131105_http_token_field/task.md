# 轻量迭代：HTTP 翻译 token 字段（URL + token 分离）

目标：在 UI 中为 HTTP 翻译 Provider 提供独立的 token 输入，并支持在 URL 中使用 `{token}` 占位符自动替换，便于对接 DeepLX 等“token 在路径里”的接口；同时兼容现有 Profiles。

## 任务清单
- [√] 翻译器：支持 `token` 字段，并在 URL 中替换 `{token}`
- [√] 控制器：构建 HttpTranslator 时读取选中 Profile 的 token
- [√] UI：HTTP Profiles 编辑区新增 token 输入，并参与保存/切换
- [√] 文档：更新配置说明与示例（不写入真实 token）
- [√] 验证：语法检查 + Python 编译检查
