# 项目技术约定

## 范围
- 默认模式：旁路展示/翻译（读取 `CODEX_HOME/sessions/**/rollout-*.jsonl` 并在本地 UI 渲染）。
- 不修改 Codex 官方二进制；不提供 Web 执行入口（只读旁路）。

## 运行环境
- Python 3（运行 sidecar：标准库即可启动本地服务）
- Node.js + npm（可选：仅用于开发/构建 UI v2：`tools/codex_thinking_sidecar/codex_thinking_sidecar/ui_v2/`）
  - 运行时默认不依赖 Node：`/ui` 使用 legacy 静态资源；`/ui-v2` 仅在需要试用/开发 UI v2 时才需要构建 `ui_v2/dist/`。
  - 在受限环境下建议显式指定 npm cache（示例：`npm install --cache ./.npm-cache`），避免写入不可写目录导致安装失败。

## 安全与隐私
- 默认仅监听本地文件并在 `127.0.0.1` 提供服务。
- 若使用翻译 Provider（如 `http`），请自行评估将文本发送到第三方服务的风险。
