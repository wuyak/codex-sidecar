#!/usr/bin/env bash
set -euo pipefail

# SDK 控制模式最小自测：
# -（可选）启动 sidecar UI 服务
# - 获取 /api/sdk/status 的 CSRF token
# - 调用 /api/sdk/turn/run 发送一条消息
#
# 用法：
#   tools/codex_thinking_sidecar/sdk_smoke_test.sh
#   tools/codex_thinking_sidecar/sdk_smoke_test.sh --server-url http://127.0.0.1:8787
#   tools/codex_thinking_sidecar/sdk_smoke_test.sh --no-start   # 仅测试已运行的服务
#
# 环境变量：
#   CODEX_HOME=/path/to/.codex     # 可选（用于启动 sidecar 时指定）
#   SDK_TEXT="..."                # 可选（覆盖默认测试文本）

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

server_url="http://127.0.0.1:8787"
no_start="0"

for a in "$@"; do
  case "$a" in
    --server-url=*) server_url="${a#--server-url=}" ;;
    --no-start) no_start="1" ;;
  esac
done

prev=""
for a in "$@"; do
  if [ "${prev}" = "--server-url" ]; then server_url="${a}"; prev=""; continue; fi
  case "$a" in
    --server-url) prev="$a" ;;
  esac
done

base_url="${server_url%/}"
health_url="${base_url}/health"

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

pid=""
cleanup() {
  if [ -n "${pid}" ]; then
    kill "${pid}" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

if [ "${no_start}" != "1" ]; then
  if ! curl -fsS --max-time 0.4 "${health_url}" >/dev/null 2>&1; then
    "${here}/ui.sh" >/dev/null 2>&1 &
    pid="$!"
  fi
fi

if ! wait_for_health; then
  echo "[sdk_smoke_test] ERROR: sidecar 未就绪：${health_url}" >&2
  exit 1
fi

status_json="$(curl -fsS --max-time 2 "${base_url}/api/sdk/status?t=$(date +%s)" || true)"
if [ -z "${status_json}" ]; then
  echo "[sdk_smoke_test] ERROR: 无法获取 /api/sdk/status" >&2
  exit 1
fi

csrf="$(python3 - <<PY
import json, sys
try:
  obj = json.loads(sys.stdin.read() or "{}")
  print(obj.get("csrf_token","") or "")
except Exception:
  print("")
PY
<<<"${status_json}")"

available="$(python3 - <<PY
import json, sys
obj = json.loads(sys.stdin.read() or "{}")
print("1" if obj.get("available") else "0")
PY
<<<"${status_json}")"

deps_installed="$(python3 - <<PY
import json, sys
obj = json.loads(sys.stdin.read() or "{}")
print("1" if obj.get("deps_installed") else "0")
PY
<<<"${status_json}")"

if [ "${available}" != "1" ]; then
  echo "[sdk_smoke_test] ERROR: SDK runner 不可用：${status_json}" >&2
  exit 1
fi
if [ "${deps_installed}" != "1" ]; then
  echo "[sdk_smoke_test] ERROR: SDK 依赖未安装（请先 cd src/codex-sdk && npm install）" >&2
  exit 1
fi
if [ -z "${csrf}" ]; then
  echo "[sdk_smoke_test] ERROR: CSRF token 为空：${status_json}" >&2
  exit 1
fi

text="${SDK_TEXT:-请只回复 pong}"
payload="$(python3 - <<PY
import json, sys
text = sys.argv[1]
print(json.dumps({"text": text}, ensure_ascii=False))
PY
"${text}")"

resp_json="$(curl -fsS --max-time 180 \
  -H "Content-Type: application/json; charset=utf-8" \
  -H "X-CSRF-Token: ${csrf}" \
  -d "${payload}" \
  "${base_url}/api/sdk/turn/run?t=$(date +%s)" || true)"

if [ -z "${resp_json}" ]; then
  echo "[sdk_smoke_test] ERROR: /api/sdk/turn/run 无响应（可能 Codex 未登录/卡住）" >&2
  exit 1
fi

ok="$(python3 - <<PY
import json, sys
obj = json.loads(sys.stdin.read() or "{}")
print("1" if obj.get("ok") else "0")
PY
<<<"${resp_json}")"

if [ "${ok}" != "1" ]; then
  echo "[sdk_smoke_test] FAIL: ${resp_json}" >&2
  exit 2
fi

thread_id="$(python3 - <<PY
import json, sys
obj = json.loads(sys.stdin.read() or "{}")
print(obj.get("thread_id","") or "")
PY
<<<"${resp_json}")"

final="$(python3 - <<PY
import json, sys
obj = json.loads(sys.stdin.read() or "{}")
print(obj.get("final","") or "")
PY
<<<"${resp_json}")"

echo "[sdk_smoke_test] OK"
echo "[sdk_smoke_test] thread_id=${thread_id}"
echo "[sdk_smoke_test] final=${final}"

