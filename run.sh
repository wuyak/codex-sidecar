#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

wait_for_health() {
  python3 - <<PY
import time, urllib.request
url = ${health_url@Q}
deadline = time.time() + 8.0
while time.time() < deadline:
    try:
        with urllib.request.urlopen(url, timeout=0.4) as resp:
            if resp.status == 200:
                raise SystemExit(0)
    except Exception:
        time.sleep(0.05)
raise SystemExit(1)
PY
}

open_browser() {
  local url="$1"
  if command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /c start "" "$url" >/dev/null 2>&1 || true
  elif command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -Command "Start-Process '$url'" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
  else
    echo "[sidecar] WARN: 无法自动打开浏览器：${url}" >&2
  fi
}

"${here}/tools/codex_thinking_sidecar/run.sh" "$@" &
pid="$!"

trap 'kill "${pid}" 2>/dev/null || true' INT TERM

if [ "${no_server}" != "1" ]; then
  if wait_for_health; then
    open_browser "${ui_url}"
  else
    echo "[sidecar] WARN: 服务未就绪，未自动打开浏览器：${ui_url}" >&2
  fi
fi

wait "${pid}"
