# 项目技术约定

## 范围
- 默认模式：旁路展示/翻译（读取 `CODEX_HOME/sessions/**/rollout-*.jsonl` 并在本地 UI 渲染）。
- 不修改 Codex 官方二进制；不提供 Web 执行入口（只读旁路）。

## 运行环境
- Python 3（运行 sidecar：标准库即可启动本地服务）
- Node.js + npm（可选：仅在需要回看/重构已归档 UI v2 时）
  - UI v2 已归档：`old/tools/codex_thinking_sidecar/codex_thinking_sidecar/ui_v2/`（默认不启用，运行时不依赖 Node）
  - 在受限环境下如需 npm，建议显式指定 cache（示例：`npm install --cache ./old/.npm-cache`），避免写入不可写目录导致安装失败。

## 安全与隐私
- 默认仅监听本地文件并在 `127.0.0.1` 提供服务。
- 若使用翻译 Provider（如 `http`），请自行评估将文本发送到第三方服务的风险。
