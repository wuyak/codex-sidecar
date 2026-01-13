#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 一键启动 UI（不自动监听），在浏览器打开 http://127.0.0.1:${PORT}/ui 后配置并点击“开始监听”。
PORT="${PORT:-8787}"
HOST="${HOST:-127.0.0.1}"
CODEX_HOME_ARG="${CODEX_HOME:-$HOME/.codex}"

PYTHONPATH="${here}" exec python3 -m codex_thinking_sidecar \
  --ui \
  --host "${HOST}" \
  --port "${PORT}" \
  --codex-home "${CODEX_HOME_ARG}" \
  "$@"
