# 轻量迭代：支持硅基流动 translate.json

目标：让 sidecar 现有的 `HTTP（通用适配器）` 直接支持硅基流动 translate.js 暴露的 `/translate.json`（`application/x-www-form-urlencoded`），无需新增 UI 字段。

## 任务清单
- [√] HTTP 翻译：当 URL 路径为 `*/translate.json` 时，改用表单提交，并解析返回 `{text:[...]} `
- [√] 文档：补充硅基流动 translate.json 的配置方式与语言参数
- [√] 变更记录：更新 changelog
- [√] 验证：python 编译检查 + 端到端翻译调用（最小请求）
