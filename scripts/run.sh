#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${here}/.." && pwd)"

source "${here}/_common.sh"

host="${HOST:-127.0.0.1}"
port="${PORT:-8787}"
server_url=""
no_server="0"

for a in "$@"; do
  case "$a" in
    --host=*) host="${a#--host=}" ;;
    --port=*) port="${a#--port=}" ;;
    --server-url=*) server_url="${a#--server-url=}" ;;
    --no-server) no_server="1" ;;
  esac
done

prev=""
for a in "$@"; do
  if [ "${prev}" = "--host" ]; then host="${a}"; prev=""; continue; fi
  if [ "${prev}" = "--port" ]; then port="${a}"; prev=""; continue; fi
  if [ "${prev}" = "--server-url" ]; then server_url="${a}"; prev=""; continue; fi
  case "$a" in
    --host|--port|--server-url) prev="$a" ;;
  esac
done

browser_host="${host}"
case "${browser_host}" in
  0.0.0.0|::|[::]) browser_host="127.0.0.1" ;;
esac

base_url="${server_url:-http://${browser_host}:${port}}"
ui_url="${base_url%/}/ui"
health_url="${base_url%/}/health"

# 默认配置落在项目内显式目录（避免污染 ~/.config 或 ~/.codex）。
default_config_home="${repo_root}/config/sidecar"
config_home="${default_config_home}"
has_config_home="0"
prev=""
for a in "$@"; do
  if [ "${prev}" = "--config-home" ]; then config_home="${a}"; has_config_home="1"; break; fi
  case "$a" in
    --config-home=*) config_home="${a#--config-home=}"; has_config_home="1"; break ;;
    --config-home) prev="--config-home" ;;
    *) prev="" ;;
  esac
done

extra_args=()
if [ "${has_config_home}" != "1" ]; then
  extra_args=(--config-home "${default_config_home}")
fi

if [ "${no_server}" != "1" ]; then
  maybe_autorecover_port "${no_server}" "${config_home}" "${port}" "${health_url}" "${base_url}" "${ui_url}"
fi

PYTHONPATH="${repo_root}" python3 -m codex_sidecar --host "${host}" --port "${port}" "${extra_args[@]}" "$@" &
pid="$!"

trap 'kill "${pid}" 2>/dev/null || true' INT TERM

if [ "${no_server}" != "1" ]; then
  if wait_for_health "${health_url}"; then
    open_browser "${ui_url}"
  else
    echo "[sidecar] WARN: 服务未就绪，未自动打开浏览器：${ui_url}" >&2
  fi
fi

wait "${pid}"
