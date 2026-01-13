# Changelog

## [Unreleased]
- 新增：UI 控制面（保存配置、开始/停止监听、清空显示）+ 短命令 `./ui.sh`。
- 新增：翻译 Provider 预留与 UI 切换（stub/none/http）。
- 新增：HTTP Profiles（可保存多个翻译 API 配置并手动切换）。
- 调整：`./run.sh` 默认沿用已保存配置（未显式传参时不再用默认值覆盖）。
- 新增：HTTP Token 字段（可用于 Header 鉴权或替换 URL 中 `{token}`，方便对接 DeepLX）。
- 新增：UI 显示模式（仅中文/仅英文/中英对照）。
- 修复：HTTP 翻译适配更多常见入参/回参字段，降低“无译文”的概率。
