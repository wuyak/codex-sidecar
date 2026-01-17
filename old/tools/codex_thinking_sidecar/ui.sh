#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 一键启动 UI（不自动监听），在浏览器打开 http://127.0.0.1:${PORT}/ui 后配置并点击“开始监听”。
PORT="${PORT:-8787}"
HOST="${HOST:-127.0.0.1}"
CODEX_HOME_ARG="${CODEX_HOME:-$HOME/.codex}"

# 配置默认放在项目目录内（避免污染 ~/.config 或 ~/.codex）。
repo_root="$(cd "${here}/../.." && pwd)"
default_config_home="${repo_root}/.codex-thinking-sidecar"
has_config_home="0"
prev=""
for a in "$@"; do
  if [ "${prev}" = "--config-home" ]; then has_config_home="1"; break; fi
  case "$a" in
    --config-home=*) has_config_home="1"; break ;;
    --config-home) prev="--config-home" ;;
    *) prev="" ;;
  esac
done

extra_args=()
if [ "${has_config_home}" != "1" ]; then
  extra_args=(--config-home "${default_config_home}")
fi

PYTHONPATH="${here}" exec python3 -m codex_thinking_sidecar \
  --ui \
  --host "${HOST}" \
  --port "${PORT}" \
  --codex-home "${CODEX_HOME_ARG}" \
  "${extra_args[@]}" \
  "$@"
