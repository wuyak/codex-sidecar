# Changelog

## [Unreleased]
- 新增：UI 控制面（保存配置、开始/停止监听、清空显示）+ 短命令 `./ui.sh`。
- 优化：`./ui.sh` 当端口已有健康服务时直接打开已有 UI 并退出，避免端口占用反复报错。
- 新增：翻译 Provider 预留与 UI 切换（stub/none/http）。
- 新增：HTTP Profiles（可保存多个翻译 API 配置并手动切换）。
- 调整：`./run.sh` 默认沿用已保存配置（未显式传参时不再用默认值覆盖）。
- 新增：HTTP Token 字段（可用于 Header 鉴权或替换 URL 中 `{token}`，方便对接 DeepLX）。
- 新增：UI 显示模式（仅中文/仅英文/中英对照）。
- 修复：HTTP 翻译适配更多常见入参/回参字段，降低“无译文”的概率。
- 优化：保存配置时提示重启监听以立即生效；UI 响应增加 no-cache 避免浏览器缓存旧页面。
- 修复：为 `/api/config` 与 `/api/translators` 增加向后兼容字段，避免旧版 UI（缓存）无法读取配置导致“配置丢失”错觉。
- 优化：控制面板接口请求增加 cache-bust，API 响应标记为 no-store，避免浏览器缓存导致配置不刷新。
- 优化：控制面板新增“调试信息”面板，显示配置来源/Profiles 概览与加载失败原因（不展示 token/url）。
- 修复：保存配置时不再在 Provider≠HTTP 的情况下清空已保存的 HTTP Profiles，避免误操作导致配置丢失。
- 新增：翻译配置自动备份（`codex_thinking_sidecar.config.json.bak-*` / `.lastgood`）与 UI 一键“恢复配置”。
- 诊断：HTTP 翻译失败时输出去敏后的告警日志（终端可见）。
- 新增：HTTP 适配 `translate.json`（硅基流动 translate.js 形式，表单提交）。
- 优化：UI 列表改为从上到下（新内容在底部），并展示用户输入/工具调用与输出/最终回答。
- 调整：仅翻译思考类内容（reasoning summary / agent_reasoning），工具输出与最终回答不翻译。
- 新增：WSL2/Linux 下可选“进程优先定位”当前会话文件（扫描 `/proc/<pid>/fd`），更精准地跟随正在进行的会话。
- 新增：会话切换列表固定在页面左侧 sidebar，滚动到中后段也可随时切换。
- 新增：UI 配置支持“自动开始监听（UI）”与进程匹配规则。
- 新增：CLI 支持 `--follow-codex-process` / `--codex-process-regex` / `--allow-follow-without-process`。
- 优化：tool_call/tool_output 展示更友好（`shell_command` 命令块高亮、tool_output 提取 Exit/耗时/Output 正文，并保留“原始输出/参数”可展开）。
- 新增：UI 右下角悬浮“↑ 顶部 / ↓ 底部”按钮，便于快速跳转页面上下。
- 优化：消息时间戳统一按北京时间展示（不再额外显示 UTC 行）。
- 优化：tool_call 默认折叠展示（点击展开），摘要更智能地跳过 `set -euo pipefail` 等 bash prologue。
