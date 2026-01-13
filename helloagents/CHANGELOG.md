# Changelog

## [Unreleased]
- 新增：UI 控制面（保存配置、开始/停止监听、清空显示）+ 短命令 `./ui.sh`。
- 新增：翻译 Provider 预留与 UI 切换（stub/none/http）。
- 新增：HTTP Profiles（可保存多个翻译 API 配置并手动切换）。
- 调整：`./run.sh` 默认沿用已保存配置（未显式传参时不再用默认值覆盖）。
- 新增：HTTP Token 字段（可用于 Header 鉴权或替换 URL 中 `{token}`，方便对接 DeepLX）。
- 新增：UI 显示模式（仅中文/仅英文/中英对照）。
- 修复：HTTP 翻译适配更多常见入参/回参字段，降低“无译文”的概率。
- 优化：保存配置时提示重启监听以立即生效；UI 响应增加 no-cache 避免浏览器缓存旧页面。
- 诊断：HTTP 翻译失败时输出去敏后的告警日志（终端可见）。
- 新增：HTTP 适配 `translate.json`（硅基流动 translate.js 形式，表单提交）。
- 优化：UI 列表改为从上到下（新内容在底部），并展示用户输入/工具调用与输出/最终回答。
- 调整：仅翻译思考类内容（reasoning summary / agent_reasoning），工具输出与最终回答不翻译。
