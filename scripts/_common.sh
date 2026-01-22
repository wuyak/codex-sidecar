wait_for_health() {
  local url="$1"
  python3 - <<PY
import time, urllib.request
url = ${url@Q}
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

check_health_once() {
  local url="$1"
  python3 - <<PY
import urllib.request
url = ${url@Q}
try:
    with urllib.request.urlopen(url, timeout=0.4) as resp:
        raise SystemExit(0 if resp.status == 200 else 1)
except Exception:
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

detect_locked_pid() {
  local config_home="$1"
  local port="$2"
  python3 - <<PY
import tempfile
from pathlib import Path

config_home = Path(${config_home@Q}).expanduser()
port = int(${port@Q})

try:
    import fcntl  # type: ignore
except Exception:
    raise SystemExit(2)

lock_dir = config_home
try:
    lock_dir.mkdir(parents=True, exist_ok=True)
except Exception:
    lock_dir = Path(tempfile.gettempdir())

lock_path = lock_dir / f"codex_sidecar.{port}.lock"
with open(lock_path, "a+", encoding="utf-8") as f:
    try:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.seek(0)
        print((f.read() or "").strip())
        raise SystemExit(0)
raise SystemExit(1)
PY
}

pid_cmdline() {
  local pid="$1"
  ps -p "${pid}" -o command= 2>/dev/null || true
}

looks_like_sidecar_cmd() {
  local cmd="${1}"
  case "${cmd}" in
    *codex_sidecar* ) return 0 ;;
    * ) return 1 ;;
  esac
}

wait_pid_exit() {
  local pid="$1"
  local i=""
  for i in {1..40}; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      return 0
    fi
    sleep 0.05
  done
  return 1
}

maybe_autorecover_port() {
  local no_server="$1"
  local config_home="$2"
  local port="$3"
  local health_url="$4"
  local base_url="$5"
  local ui_url="$6"

  if [ "${no_server}" = "1" ]; then return 0; fi

  if check_health_once "${health_url}"; then
    echo "[sidecar] INFO: 已有 sidecar 在运行：${base_url}，将直接打开 UI" >&2
    open_browser "${ui_url}"
    exit 0
  fi

  local lock_pid=""
  if lock_pid="$(detect_locked_pid "${config_home}" "${port}")"; then
    if [ -z "${lock_pid}" ]; then
      echo "[sidecar] WARN: 检测到端口 ${port} 的 sidecar 锁被占用，但未能读取 PID；将继续尝试启动" >&2
      return 0
    fi
    if ! echo "${lock_pid}" | grep -Eq '^[0-9]+$'; then
      echo "[sidecar] WARN: 检测到端口 ${port} 的 sidecar 锁被占用，但 PID 非法：${lock_pid}；将继续尝试启动" >&2
      return 0
    fi
    if ! kill -0 "${lock_pid}" 2>/dev/null; then
      return 0
    fi
    local cmd=""
    cmd="$(pid_cmdline "${lock_pid}")"
    if ! looks_like_sidecar_cmd "${cmd}"; then
      echo "[sidecar] ERROR: 端口 ${port} 的锁被 PID ${lock_pid} 占用，但该进程看起来不是 codex_sidecar：${cmd}" >&2
      echo "[sidecar] ERROR: 为安全起见不会自动终止。请手动停止该进程或换一个端口（PORT=... / --port ...）。" >&2
      exit 3
    fi
    echo "[sidecar] WARN: 检测到旧 sidecar 占用端口 ${port}（PID ${lock_pid}），但健康检查失败；尝试终止后重启…" >&2
    if ! kill "${lock_pid}" 2>/dev/null; then
      echo "[sidecar] ERROR: 无法终止旧 sidecar（PID ${lock_pid}）。请手动 kill 后重试。" >&2
      exit 3
    fi
    if ! wait_pid_exit "${lock_pid}"; then
      echo "[sidecar] WARN: 旧 sidecar 未在预期时间退出，发送 SIGKILL（PID ${lock_pid}）…" >&2
      kill -9 "${lock_pid}" 2>/dev/null || true
      wait_pid_exit "${lock_pid}" || true
    fi
    echo "[sidecar] INFO: 已清理旧 sidecar（PID ${lock_pid}），准备重新启动。" >&2
    return 0
  fi
  return 0
}

