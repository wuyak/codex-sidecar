import json
import os
import queue
import secrets
import shutil
import subprocess
import threading
import time
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Deque, Dict, List, Optional, Any
from urllib.parse import parse_qs, urlparse, unquote
from pathlib import Path


class _ReuseHTTPServer(ThreadingHTTPServer):
    # Allow quick restart during iterative development (avoid EADDRINUSE from TIME_WAIT).
    allow_reuse_address = True


class _Broadcaster:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: List["queue.Queue[dict]"] = []

    def subscribe(self) -> "queue.Queue[dict]":
        q: "queue.Queue[dict]" = queue.Queue(maxsize=256)
        with self._lock:
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q: "queue.Queue[dict]") -> None:
        with self._lock:
            try:
                self._subscribers.remove(q)
            except ValueError:
                return

    def publish(self, msg: dict) -> None:
        with self._lock:
            subs = list(self._subscribers)
        for q in subs:
            try:
                q.put_nowait(msg)
            except queue.Full:
                # Drop if the client can't keep up.
                continue


class _State:
    def __init__(self, max_messages: int) -> None:
        self._lock = threading.Lock()
        self._max_messages = max(1, int(max_messages or 1000))
        self._messages: Deque[dict] = deque()
        self._by_id: Dict[str, dict] = {}
        self._next_seq = 1
        self._broadcaster = _Broadcaster()

    def add(self, msg: dict) -> None:
        op = ""
        try:
            op = str(msg.get("op") or "").strip().lower()
        except Exception:
            op = ""
        if op == "update":
            self.update(msg)
            return

        mid = ""
        try:
            mid = str(msg.get("id") or "")
        except Exception:
            mid = ""

        added = False
        with self._lock:
            if mid and mid in self._by_id:
                added = False
            else:
                # Enforce bounded history while keeping id-set in sync.
                while len(self._messages) >= self._max_messages:
                    old = self._messages.popleft()
                    try:
                        oid = str(old.get("id") or "")
                        if oid:
                            self._by_id.pop(oid, None)
                    except Exception:
                        pass
                try:
                    msg["seq"] = int(self._next_seq)
                    self._next_seq += 1
                except Exception:
                    try:
                        msg["seq"] = int(time.time() * 1000)
                    except Exception:
                        pass
                self._messages.append(msg)
                if mid:
                    self._by_id[mid] = msg
                added = True
        if added:
            self._broadcaster.publish(msg)

    def update(self, patch: dict) -> None:
        mid = ""
        try:
            mid = str(patch.get("id") or "")
        except Exception:
            mid = ""
        if not mid:
            return

        out: Optional[dict] = None
        with self._lock:
            cur = self._by_id.get(mid)
            if cur is None:
                # If update arrives before initial add (shouldn't happen), ignore.
                out = None
            else:
                seq = cur.get("seq")
                for k, v in patch.items():
                    if k in ("op", "id", "seq"):
                        continue
                    cur[k] = v
                if seq is not None:
                    cur["seq"] = seq
                out = dict(cur)
                out["op"] = "update"

        if out is not None:
            self._broadcaster.publish(out)

    def clear(self) -> None:
        with self._lock:
            self._messages.clear()
            self._by_id.clear()

    def list_messages(self) -> List[dict]:
        with self._lock:
            return list(self._messages)

    def list_threads(self) -> List[dict]:
        with self._lock:
            msgs = list(self._messages)
        agg: Dict[str, dict] = {}
        for m in msgs:
            thread_id = str(m.get("thread_id") or "")
            file_path = str(m.get("file") or "")
            key = thread_id or file_path or "unknown"
            if key not in agg:
                agg[key] = {
                    "key": key,
                    "thread_id": thread_id,
                    "file": file_path,
                    "count": 0,
                    "last_ts": "",
                    "last_seq": 0,
                    "kinds": {},
                }
            a = agg[key]
            a["count"] += 1
            ts = str(m.get("ts") or "")
            if ts and (not a["last_ts"] or ts > a["last_ts"]):
                a["last_ts"] = ts
            try:
                seq = int(m.get("seq") or 0)
            except Exception:
                seq = 0
            if seq and seq > int(a.get("last_seq") or 0):
                a["last_seq"] = seq
            kind = str(m.get("kind") or "")
            if kind:
                a["kinds"][kind] = int(a["kinds"].get(kind, 0)) + 1
        items = list(agg.values())
        items.sort(key=lambda x: (int(x.get("last_seq") or 0), x.get("last_ts") or ""), reverse=True)
        return items

    def subscribe(self) -> "queue.Queue[dict]":
        return self._broadcaster.subscribe()

    def unsubscribe(self, q: "queue.Queue[dict]") -> None:
        self._broadcaster.unsubscribe(q)


def _json_bytes(obj: dict) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _is_loopback_host(host: str) -> bool:
    h = (host or "").strip().lower()
    return h in ("127.0.0.1", "localhost", "::1", "[::1]")


def _repo_root() -> Path:
    # tools/codex_thinking_sidecar/codex_thinking_sidecar/server.py -> repo root
    return Path(__file__).resolve().parents[3]


def _sdk_dir() -> Path:
    return _repo_root() / "src" / "codex-sdk"


def _sdk_runner_path() -> Path:
    return _sdk_dir() / "run_turn.mjs"


class _Handler(BaseHTTPRequestHandler):
    server_version = "codex-thinking-sidecar/0.1"

    @property
    def _state(self) -> _State:
        return self.server.state  # type: ignore[attr-defined]

    @property
    def _controller(self):
        return self.server.controller  # type: ignore[attr-defined]

    @property
    def _sdk_csrf_token(self) -> str:
        return str(getattr(self.server, "sdk_csrf_token", "") or "")  # type: ignore[attr-defined]

    def log_message(self, _format: str, *_args) -> None:
        # Silence default logging.
        return

    def _send_json(self, status: int, obj: dict) -> None:
        body = _json_bytes(obj)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_text(
        self,
        status: int,
        body: str,
        content_type: str = "text/plain; charset=utf-8",
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> None:
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _sdk_allowed(self) -> bool:
        """
        安全保护：默认仅允许在 loopback 绑定下启用 SDK 控制能力。

        如确需对外开放（非常危险），需显式设置环境变量：
        - CODEX_SDK_ALLOW_REMOTE=1
        """
        try:
            host = str(getattr(self.server, "server_address", ("", 0))[0] or "")
        except Exception:
            host = ""
        if _is_loopback_host(host):
            return True
        return str(os.environ.get("CODEX_SDK_ALLOW_REMOTE") or "").strip() == "1"

    def _sdk_check_csrf(self) -> bool:
        want = self._sdk_csrf_token
        if not want:
            return False
        got = str(self.headers.get("X-CSRF-Token") or "").strip()
        return bool(got) and got == want

    def _sdk_run_turn(self, req: Dict[str, Any]) -> Dict[str, Any]:
        """
        调用 src/codex-sdk/run_turn.mjs 执行一次 turn（支持 threadId 续聊）。

        约定：
        - runner 读取 stdin JSON
        - runner 输出 stdout JSON（单行）
        """
        runner = _sdk_runner_path()
        sdk_dir = _sdk_dir()
        if not runner.exists():
            return {"ok": False, "error": f"sdk_runner_missing: {runner}"}
        if not (sdk_dir / "node_modules").exists():
            return {"ok": False, "error": "sdk_deps_missing: 请先在 src/codex-sdk 执行 npm install"}

        # 默认使用当前 sidecar 配置的 watch_codex_home 作为 CODEX_HOME
        try:
            cfg = self._controller.get_config() if self._controller is not None else {}
        except Exception:
            cfg = {}
        codex_home = str((cfg.get("watch_codex_home") if isinstance(cfg, dict) else "") or "").strip()
        if not codex_home:
            codex_home = str(os.environ.get("CODEX_HOME") or "").strip()
        if not codex_home:
            try:
                codex_home = str((Path.home() / ".codex").resolve())
            except Exception:
                codex_home = str(Path.home() / ".codex")

        # 确保 codex_home 结构存在（Codex 需要能创建 sessions/log 等目录）
        if codex_home:
            try:
                p = Path(codex_home).expanduser()
                (p / "sessions").mkdir(parents=True, exist_ok=True)
                (p / "log").mkdir(parents=True, exist_ok=True)
            except Exception:
                pass

        payload = dict(req) if isinstance(req, dict) else {}
        if codex_home and not payload.get("codexHome"):
            payload["codexHome"] = codex_home

        raw_in = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        try:
            proc = subprocess.run(
                ["node", str(runner)],
                input=raw_in,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=str(sdk_dir),
                timeout=float(os.environ.get("CODEX_SDK_TURN_TIMEOUT_S") or "900"),
            )
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "sdk_timeout"}
        except FileNotFoundError:
            return {"ok": False, "error": "node_not_found"}
        except Exception as e:
            return {"ok": False, "error": f"sdk_spawn_failed: {e}"}

        out = (proc.stdout or b"").decode("utf-8", errors="replace").strip()
        if not out:
            err = (proc.stderr or b"").decode("utf-8", errors="replace").strip()
            return {"ok": False, "error": f"sdk_no_output: {err}"}
        try:
            obj = json.loads(out)
        except Exception:
            err = (proc.stderr or b"").decode("utf-8", errors="replace").strip()
            return {"ok": False, "error": f"sdk_invalid_json: {out[:200]}", "stderr": err[:200]}
        if not isinstance(obj, dict):
            return {"ok": False, "error": "sdk_invalid_payload"}
        if not obj.get("ok"):
            return {"ok": False, "error": obj.get("error") or "sdk_error"}
        return obj

    def do_GET(self) -> None:
        u = urlparse(self.path)
        path = u.path
        qs = parse_qs(u.query or "")

        if path == "/health":
            self._send_json(HTTPStatus.OK, {"ok": True, "pid": os.getpid()})
            return

        if path == "/api/messages":
            msgs = self._state.list_messages()
            thread_id = (qs.get("thread_id") or [""])[0]
            if thread_id:
                msgs = [m for m in msgs if str(m.get("thread_id") or "") == thread_id]
            self._send_json(HTTPStatus.OK, {"messages": msgs})
            return

        if path == "/api/threads":
            self._send_json(HTTPStatus.OK, {"threads": self._state.list_threads()})
            return

        if path == "/api/config":
            cfg = self._controller.get_config()
            payload = {"ok": True, "config": cfg, "recovery": self._controller.recovery_info()}
            if isinstance(cfg, dict):
                payload.update(cfg)
            self._send_json(HTTPStatus.OK, payload)
            return

        if path == "/api/status":
            self._send_json(HTTPStatus.OK, self._controller.status())
            return

        if path == "/api/sdk/status":
            if not self._sdk_allowed():
                self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "sdk_disabled_on_non_loopback"})
                return
            # 额外状态信息（用于 UI 更快定位“依赖/权限”问题）
            runner = _sdk_runner_path()
            sdk_dir = _sdk_dir()
            deps_installed = (sdk_dir / "node_modules").exists()

            try:
                cfg = self._controller.get_config() if self._controller is not None else {}
            except Exception:
                cfg = {}
            codex_home = str((cfg.get("watch_codex_home") if isinstance(cfg, dict) else "") or "").strip()
            if not codex_home:
                codex_home = str(os.environ.get("CODEX_HOME") or "").strip()
            if not codex_home:
                try:
                    codex_home = str((Path.home() / ".codex").resolve())
                except Exception:
                    codex_home = str(Path.home() / ".codex")

            codex_home_exists = False
            codex_home_writable = False
            codex_home_creatable = False
            if codex_home:
                try:
                    p = Path(codex_home).expanduser()
                    codex_home_exists = p.exists()
                    if codex_home_exists:
                        codex_home_writable = os.access(str(p), os.W_OK)
                    else:
                        codex_home_creatable = os.access(str(p.parent), os.W_OK)
                except Exception:
                    pass

            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "available": runner.exists(),
                    "csrf_token": self._sdk_csrf_token,
                    "runner": str(runner),
                    "deps_installed": deps_installed,
                    "node": bool(shutil.which("node")),
                    "codex_home": codex_home,
                    "codex_home_exists": codex_home_exists,
                    "codex_home_writable": codex_home_writable,
                    "codex_home_creatable": codex_home_creatable,
                },
            )
            return

        if path == "/api/translators":
            payload = self._controller.translators()
            try:
                translators = payload.get("translators")
                if isinstance(translators, list):
                    for t in translators:
                        if isinstance(t, dict) and "id" in t and "name" not in t:
                            t["name"] = t["id"]
            except Exception:
                pass
            self._send_json(HTTPStatus.OK, payload)
            return

        if path == "/ui":
            self._serve_ui_file("index.html")
            return

        if path.startswith("/ui/"):
            rel = path[len("/ui/") :]
            if not rel or rel == "index.html":
                rel = "index.html"
            self._serve_ui_file(rel)
            return

        if path == "/events":
            self._handle_sse()
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})

    def _serve_ui_file(self, rel: str) -> None:
        """
        Serve static UI assets from the local ui/ folder.

        Notes:
        - All UI routes are marked no-store to avoid confusing stale caches during iteration.
        - Rel path is sanitized and forced to stay inside _UI_DIR.
        """
        headers = {
            "Cache-Control": "no-store, max-age=0",
            "Pragma": "no-cache",
        }
        try:
            rel_norm = unquote(rel or "").lstrip("/")
            cand = (_UI_DIR / rel_norm).resolve()
            root = _UI_DIR.resolve()
            if root not in cand.parents and cand != root:
                self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
                return
            if not cand.exists() or not cand.is_file():
                # Keep dev-friendly fallbacks for common asset types.
                if rel_norm.endswith(".js"):
                    self._send_text(
                        HTTPStatus.OK,
                        f"console.warn('UI file missing: {cand}');\n",
                        content_type="application/javascript; charset=utf-8",
                        extra_headers=headers,
                    )
                    return
                if rel_norm.endswith(".css"):
                    self._send_text(
                        HTTPStatus.OK,
                        f"/* UI file missing: {cand} */\n",
                        content_type="text/css; charset=utf-8",
                        extra_headers=headers,
                    )
                    return
                self._send_text(
                    HTTPStatus.OK,
                    (
                        "<!doctype html><meta charset=\"utf-8\"/>"
                        "<title>Codex Sidecar</title>"
                        "<pre>UI file missing: {}\n".format(cand) + "</pre>"
                    ),
                    content_type="text/html; charset=utf-8",
                    extra_headers=headers,
                )
                return
            ct = _ui_content_type(cand)
            body = _load_ui_text(cand, "")
            self._send_text(HTTPStatus.OK, body, content_type=ct, extra_headers=headers)
        except Exception:
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})

    def _handle_sse(self) -> None:
        q = self._state.subscribe()
        try:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

            # Initial comment to establish the stream.
            self.wfile.write(b":ok\n\n")
            self.wfile.flush()

            while True:
                try:
                    msg = q.get(timeout=10.0)
                except queue.Empty:
                    # heartbeat
                    self.wfile.write(b":ping\n\n")
                    self.wfile.flush()
                    continue

                data = _json_bytes(msg)
                self.wfile.write(b"event: message\n")
                self.wfile.write(b"data: ")
                self.wfile.write(data)
                self.wfile.write(b"\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return
        finally:
            self._state.unsubscribe(q)

    def do_POST(self) -> None:
        # Control plane (JSON).
        if self.path == "/api/sdk/turn/run":
            if not self._sdk_allowed():
                self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "sdk_disabled_on_non_loopback"})
                return
            if not self._sdk_check_csrf():
                self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "bad_csrf"})
                return

            length = int(self.headers.get("Content-Length") or "0")
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                obj = json.loads(raw.decode("utf-8", errors="replace"))
            except Exception:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_json"})
                return
            if not isinstance(obj, dict):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_payload"})
                return

            text = str(obj.get("text") or "").strip()
            thread_id = str(obj.get("thread_id") or obj.get("threadId") or "").strip()
            if not text:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "empty_text"})
                return

            sdk_req: Dict[str, Any] = {"threadId": thread_id, "input": text}
            sdk_resp = self._sdk_run_turn(sdk_req)
            if not isinstance(sdk_resp, dict) or not sdk_resp.get("ok"):
                err = sdk_resp.get("error") if isinstance(sdk_resp, dict) else "sdk_error"
                self._send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": err})
                return

            new_thread_id = str(sdk_resp.get("threadId") or thread_id or "").strip()
            turn = sdk_resp.get("turn") if isinstance(sdk_resp.get("turn"), dict) else {}
            final = str((turn.get("finalResponse") if isinstance(turn, dict) else "") or "")

            # 将 SDK 对话写入同一消息流（/events），以便 UI 与旁路输出统一展示。
            now = time.time()
            ts = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now)) + "Z"

            def _mkid(suffix: str) -> str:
                return f"sdk:{int(now*1000)}:{suffix}:{secrets.token_hex(4)}"

            try:
                self._state.add({"id": _mkid("user"), "kind": "user_message", "text": text, "thread_id": new_thread_id, "ts": ts})
            except Exception:
                pass
            try:
                if final:
                    self._state.add({"id": _mkid("assistant"), "kind": "assistant_message", "text": final, "thread_id": new_thread_id, "ts": ts})
            except Exception:
                pass

            self._send_json(HTTPStatus.OK, {"ok": True, "thread_id": new_thread_id, "final": final})
            return

        if self.path == "/api/config/recover":
            r = self._controller.recover_translator_config()
            if not isinstance(r, dict) or not r.get("ok"):
                self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "no_recovery_source"})
                return
            cfg = r.get("config")
            payload = {"ok": True, "restored": True, "source": r.get("source") or "", "config": cfg}
            if isinstance(cfg, dict):
                payload.update(cfg)
            self._send_json(HTTPStatus.OK, payload)
            return

        if self.path == "/api/config":
            length = int(self.headers.get("Content-Length") or "0")
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                obj = json.loads(raw.decode("utf-8", errors="replace"))
            except Exception:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_json"})
                return
            if not isinstance(obj, dict):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_payload"})
                return
            try:
                cfg = self._controller.update_config(obj)
            except ValueError as e:
                self._send_json(HTTPStatus.CONFLICT, {"ok": False, "error": str(e)})
                return
            payload = {"ok": True, "config": cfg}
            if isinstance(cfg, dict):
                payload.update(cfg)
            self._send_json(HTTPStatus.OK, payload)
            return

        if self.path == "/api/control/start":
            self._send_json(HTTPStatus.OK, self._controller.start())
            return

        if self.path == "/api/control/stop":
            self._send_json(HTTPStatus.OK, self._controller.stop())
            return

        if self.path == "/api/control/follow":
            length = int(self.headers.get("Content-Length") or "0")
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                obj = json.loads(raw.decode("utf-8", errors="replace"))
            except Exception:
                obj = {}
            if not isinstance(obj, dict):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_payload"})
                return
            mode = str(obj.get("mode") or obj.get("selection_mode") or "auto")
            thread_id = str(obj.get("thread_id") or obj.get("threadId") or "")
            file = str(obj.get("file") or "")
            self._send_json(HTTPStatus.OK, self._controller.set_follow(mode, thread_id=thread_id, file=file))
            return

        if self.path == "/api/control/restart_process":
            # Respond first, then restart asynchronously; otherwise the process may re-exec/exit
            # before the response body is fully written.
            self._send_json(HTTPStatus.OK, {"ok": True})

            def _restart_later() -> None:
                time.sleep(0.06)
                try:
                    self._controller.request_restart()
                except Exception:
                    return

            threading.Thread(target=_restart_later, name="sidecar-restart", daemon=True).start()
            return

        if self.path == "/api/control/clear":
            self._controller.clear_messages()
            self._send_json(HTTPStatus.OK, {"ok": True})
            return

        if self.path == "/api/control/shutdown":
            # Respond first, then shutdown asynchronously; otherwise the process may exit
            # before the response body is fully written, causing clients to see a truncated transfer.
            self._send_json(HTTPStatus.OK, {"ok": True})

            def _shutdown_later() -> None:
                time.sleep(0.05)
                try:
                    self._controller.request_shutdown()
                except Exception:
                    return

            threading.Thread(target=_shutdown_later, name="sidecar-shutdown", daemon=True).start()
            return

        if self.path != "/ingest":
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
            return

        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "empty_body"})
            return

        raw = self.rfile.read(length)
        try:
            obj = json.loads(raw.decode("utf-8", errors="replace"))
        except Exception:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_json"})
            return

        if not isinstance(obj, dict):
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_payload"})
            return

        op = str(obj.get("op") or "").strip().lower()
        if op == "update":
            if "id" not in obj:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "missing_id"})
                return
            self._state.add(obj)
            self._send_json(HTTPStatus.OK, {"ok": True, "op": "update"})
            return

        # Minimal validation for normal ingest.
        if "id" not in obj or "kind" not in obj or "text" not in obj:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "missing_fields"})
            return

        self._state.add(obj)
        self._send_json(HTTPStatus.OK, {"ok": True, "op": "add"})



_UI_DIR = Path(__file__).with_name("ui")
_UI_INDEX_PATH = _UI_DIR / "index.html"
_UI_CSS_PATH = _UI_DIR / "styles.css"
_UI_JS_PATH = _UI_DIR / "app.js"

def _ui_content_type(path: Path) -> str:
    ext = (path.suffix or "").lower()
    if ext in (".html", ".htm"):
        return "text/html; charset=utf-8"
    if ext == ".css":
        return "text/css; charset=utf-8"
    if ext == ".js":
        return "application/javascript; charset=utf-8"
    if ext == ".json":
        return "application/json; charset=utf-8"
    return "text/plain; charset=utf-8"

def _load_ui_text(path: Path, fallback: str) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return fallback


class SidecarServer:
    def __init__(self, host: str, port: int, max_messages: int, controller: Optional[Any] = None) -> None:
        self._host = host
        self._port = port
        self._state = _State(max_messages=max_messages)
        self._httpd = _ReuseHTTPServer((host, port), _Handler)
        # Attach state to server instance for handler access.
        self._httpd.state = self._state  # type: ignore[attr-defined]
        self._httpd.controller = controller  # type: ignore[attr-defined]
        # SDK 控制模式：CSRF token（仅驻内存，避免落盘）。
        self._httpd.sdk_csrf_token = secrets.token_hex(16)  # type: ignore[attr-defined]
        self._thread: Optional[threading.Thread] = None

    @property
    def state(self) -> _State:
        return self._state

    def set_controller(self, controller: Any) -> None:
        self._httpd.controller = controller  # type: ignore[attr-defined]

    def start_in_background(self) -> None:
        t = threading.Thread(target=self._httpd.serve_forever, name="sidecar-httpd", daemon=True)
        t.start()
        self._thread = t
        # Small delay to reduce race when watcher starts immediately.
        time.sleep(0.05)

    def shutdown(self) -> None:
        try:
            self._httpd.shutdown()
            self._httpd.server_close()
            if self._thread is not None and self._thread.is_alive():
                self._thread.join(timeout=0.5)
        except Exception:
            return
