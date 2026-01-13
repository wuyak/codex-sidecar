# codex-thinking-sidecar-zh

一个**不修改 Codex** 的旁路工具：读取 `CODEX_HOME/sessions/**/rollout-*.jsonl`，提取思考摘要/推理文本并在本地 Web UI 展示（可选翻译 Provider）。

## 快速开始

```bash
cd ~/src/codex-thinking-sidecar-zh
./ui.sh
```

打开：
- `http://127.0.0.1:8787/ui`

在 UI 里配置 `监视目录（CODEX_HOME）`，保存后点击“开始监听”；也可以启用“自动开始监听（UI）”省去手动点击。

## 说明
- 默认翻译为占位实现（`stub`），不调用任何外部 API。
- 你可以在 UI 里切换翻译 Provider（预留 `stub/none/http`）。
