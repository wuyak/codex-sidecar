import argparse
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

from .config import default_config_home, load_config
from .control.translator_build import build_translator
from .controller import SidecarController
from .server import SidecarServer
from .watcher import HttpIngestClient, RolloutWatcher


def _default_codex_home() -> str:
    env = os.environ.get("CODEX_HOME")
    if env:
        return env
    return str(Path.home() / ".codex")


def _parse_args(argv):
    # 兼容常见误用：用户在 bash 中写成 --codex-home"$HOME/.codex"
    # 这会变成单个参数 "--codex-home/home/kino/.codex" 并导致 argparse 报错。
    # 这里做一次轻量修正：把它拆成 ["--codex-home", "/home/kino/.codex"]。
    fixed = []
    for a in argv:
        if a.startswith("--codex-home") and a not in ("--codex-home",) and not a.startswith("--codex-home="):
            v = a[len("--codex-home") :]
            if v:
                fixed.extend(["--codex-home", v])
                continue
        fixed.append(a)

    p = argparse.ArgumentParser(
        prog="codex_thinking_sidecar",
        description="旁路监听 Codex rollout JSONL，提取思考摘要并推送到本地服务端（含 SSE/UI）。",
    )
    p.add_argument("--codex-home", default=_default_codex_home(), help="Codex 数据目录（默认: $CODEX_HOME 或 ~/.codex）")
    p.add_argument(
        "--config-home",
        default=str(default_config_home()),
        help="Sidecar 配置目录（默认: $CODEX_HOME/tmp/codex-thinking-sidecar 或 ~/.codex/tmp/codex-thinking-sidecar）",
    )
    p.add_argument("--host", default="127.0.0.1", help="本地服务监听地址（默认: 127.0.0.1）")
    p.add_argument("--port", type=int, default=8787, help="本地服务端口（默认: 8787）")
    p.add_argument("--max-messages", type=int, default=1000, help="内存中保留的最近消息条数（默认: 1000）")
    p.add_argument("--replay-last-lines", type=int, default=200, help="启动时从文件尾部回放的行数（默认: 200）")
    p.add_argument("--poll-interval", type=float, default=0.5, help="轮询间隔秒数（默认: 0.5）")
    p.add_argument("--file-scan-interval", type=float, default=2.0, help="扫描最新会话文件的间隔秒数（默认: 2.0）")
    p.add_argument("--follow-codex-process", action="store_true", help="优先基于 Codex 进程定位当前 rollout 文件（WSL2/Linux）")
    p.add_argument("--codex-process-regex", default=None, help="匹配 Codex 进程 cmdline 的正则（默认: codex）")
    p.add_argument("--allow-follow-without-process", action="store_true", help="允许在未检测到 Codex 进程时仍按 sessions 扫描回退")
    p.add_argument("--ui", action="store_true", help="仅启动本地 UI/服务端，不自动开始监听（在 UI 里点“开始监听”）")
    p.add_argument("--no-server", action="store_true", help="不启动本地服务（仅推送到 --server-url）")
    p.add_argument("--server-url", default=None, help="将事件推送到已有服务端（如 http://127.0.0.1:8787）")
    return p.parse_args(fixed)


def main(argv=None) -> int:
    raw_argv = list(sys.argv[1:] if argv is None else argv)
    args = _parse_args(raw_argv)

    codex_home = Path(args.codex_home).expanduser()
    config_home = Path(args.config_home).expanduser()
    server_url = args.server_url
    lock_fh = None
    controller = None

    server = None
    if not args.no_server:
        # Prevent multiple sidecar instances pushing to the same server/port.
        #
        # 用户常见误用是开了多个终端重复启动 sidecar，导致“同一条内容出现两次”。
        # 更合理的做法是阻止重复进程，而不是靠服务端去重掩盖问题。
        try:
            import fcntl  # type: ignore

            lock_dir = config_home
            try:
                lock_dir.mkdir(parents=True, exist_ok=True)
            except Exception:
                lock_dir = Path(tempfile.gettempdir())
            lock_path = lock_dir / f"codex_thinking_sidecar.{args.port}.lock"
            lock_fh = open(lock_path, "a+", encoding="utf-8")
            try:
                fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                lock_fh.seek(0)
                pid = (lock_fh.read() or "").strip()
                hint = f"（PID {pid}）" if pid else ""
                print(f"[sidecar] ERROR: 检测到已有 sidecar 正在使用端口 {args.port} {hint}，请先停止它或换一个端口。", file=sys.stderr)
                return 3
            lock_fh.seek(0)
            lock_fh.truncate(0)
            lock_fh.write(str(os.getpid()))
            lock_fh.flush()
        except Exception:
            # 在不支持 fcntl 的环境里跳过锁（例如非 Linux）；仍可正常运行。
            lock_fh = None

        server_url = server_url or f"http://{args.host}:{args.port}"
        server = SidecarServer(host=args.host, port=args.port, max_messages=args.max_messages)
        controller = SidecarController(config_home=config_home, server_url=server_url, state=server.state)
        server.set_controller(controller)
        server.start_in_background()

    if not server_url:
        print("ERROR: 必须提供 --server-url，或不要设置 --no-server。", file=sys.stderr)
        return 2

    print(f"[sidecar] config_home={config_home}", file=sys.stderr)
    print(f"[sidecar] codex_home={codex_home}", file=sys.stderr)
    print(f"[sidecar] server_url={server_url}", file=sys.stderr)

    # Ensure the local server is ready before we start replaying (otherwise /ingest may fail
    # during the initial burst and never be retried).
    if server is not None and server_url.startswith("http://"):
        health_url = server_url.rstrip("/") + "/health"
        ready = False
        for _ in range(40):
            try:
                with urllib.request.urlopen(health_url, timeout=0.5) as resp:
                    if resp.status == 200:
                        ready = True
                        break
            except Exception:
                time.sleep(0.05)
        if not ready:
            print(f"[sidecar] WARN: 本地服务未就绪：{health_url}", file=sys.stderr)

    stop_event = threading.Event()
    restart_event = threading.Event()
    if controller is not None:
        try:
            controller.set_process_stop_event(stop_event)
            controller.set_process_restart_event(restart_event)
        except Exception:
            pass

    def _handle_sigint(_sig, _frame):
        stop_event.set()

    signal.signal(signal.SIGINT, _handle_sigint)
    signal.signal(signal.SIGTERM, _handle_sigint)

    do_restart = False
    try:
        # UI mode: only run the server; watcher is controlled via HTTP endpoints.
        if server is not None and args.ui:
            stop_event.wait()
        elif server is not None:
            # Start watching immediately. When the user doesn't pass CLI flags, prefer
            # the persisted config (saved via UI) instead of overwriting with defaults.
            def _argv_has(flag: str) -> bool:
                for a in raw_argv:
                    if a == flag or a.startswith(flag + "="):
                        return True
                return False

            def _argv_has_prefix(flag_prefix: str) -> bool:
                for a in raw_argv:
                    if a == flag_prefix or a.startswith(flag_prefix + "=") or a.startswith(flag_prefix):
                        return True
                return False

            if controller is not None:
                patch = {}
                # If user explicitly specifies --codex-home, also watch that directory.
                if _argv_has_prefix("--codex-home"):
                    patch["watch_codex_home"] = str(codex_home)
                if _argv_has("--replay-last-lines"):
                    patch["replay_last_lines"] = int(args.replay_last_lines)
                if _argv_has("--poll-interval"):
                    patch["poll_interval"] = float(args.poll_interval)
                if _argv_has("--file-scan-interval"):
                    patch["file_scan_interval"] = float(args.file_scan_interval)
                if _argv_has("--follow-codex-process"):
                    patch["follow_codex_process"] = True
                if _argv_has("--codex-process-regex"):
                    patch["codex_process_regex"] = str(args.codex_process_regex or "codex")
                if _argv_has("--allow-follow-without-process"):
                    patch["only_follow_when_process"] = False
                if patch:
                    controller.apply_runtime_overrides(patch)
                controller.start()
            stop_event.wait()
        else:
            # no-server mode: behave like the original watcher-only sidecar.
            ingest = HttpIngestClient(server_url=server_url)
            cfg = load_config(config_home)
            translator = build_translator(cfg)
            watcher = RolloutWatcher(
                codex_home=codex_home,
                ingest=ingest,
                translator=translator,
                replay_last_lines=int(args.replay_last_lines),
                watch_max_sessions=int(getattr(cfg, "watch_max_sessions", 3) or 3),
                translate_mode=str(getattr(cfg, "translate_mode", "auto") or "auto"),
                poll_interval_s=float(args.poll_interval),
                file_scan_interval_s=float(args.file_scan_interval),
                follow_codex_process=bool(args.follow_codex_process),
                codex_process_regex=str(args.codex_process_regex or "codex"),
                only_follow_when_process=not bool(args.allow_follow_without_process),
            )
            watcher.run(stop_event=stop_event)
    finally:
        stop_event.set()
        if server is not None:
            server.shutdown()
            # Give the server a moment to exit cleanly.
            time.sleep(0.1)
        if lock_fh is not None:
            try:
                lock_fh.close()
            except Exception:
                pass
        do_restart = restart_event.is_set()

    if do_restart:
        cmd = [sys.executable, "-m", "codex_thinking_sidecar"] + raw_argv
        try:
            print(f"[sidecar] RESTART: {' '.join(cmd)}", file=sys.stderr)
        except Exception:
            pass
        try:
            subprocess.Popen(cmd, env=os.environ.copy(), start_new_session=True)
            return 0
        except Exception:
            # Fallback: in-place restart (PID unchanged).
            os.execv(cmd[0], cmd)

    return 0
