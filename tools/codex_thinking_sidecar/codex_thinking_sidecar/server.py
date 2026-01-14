import json
import queue
import threading
import time
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Deque, Dict, List, Optional, Any
from urllib.parse import parse_qs, urlparse
from pathlib import Path


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
        self._messages: Deque[dict] = deque(maxlen=max_messages)
        self._broadcaster = _Broadcaster()

    def add(self, msg: dict) -> None:
        with self._lock:
            self._messages.append(msg)
        self._broadcaster.publish(msg)

    def clear(self) -> None:
        with self._lock:
            self._messages.clear()

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
                    "kinds": {},
                }
            a = agg[key]
            a["count"] += 1
            ts = str(m.get("ts") or "")
            if ts and (not a["last_ts"] or ts > a["last_ts"]):
                a["last_ts"] = ts
            kind = str(m.get("kind") or "")
            if kind:
                a["kinds"][kind] = int(a["kinds"].get(kind, 0)) + 1
        items = list(agg.values())
        items.sort(key=lambda x: x.get("last_ts") or "", reverse=True)
        return items

    def subscribe(self) -> "queue.Queue[dict]":
        return self._broadcaster.subscribe()

    def unsubscribe(self, q: "queue.Queue[dict]") -> None:
        self._broadcaster.unsubscribe(q)


def _json_bytes(obj: dict) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class _Handler(BaseHTTPRequestHandler):
    server_version = "codex-thinking-sidecar/0.1"

    @property
    def _state(self) -> _State:
        return self.server.state  # type: ignore[attr-defined]

    @property
    def _controller(self):
        return self.server.controller  # type: ignore[attr-defined]

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

    def do_GET(self) -> None:
        u = urlparse(self.path)
        path = u.path
        qs = parse_qs(u.query or "")

        if path == "/health":
            self._send_json(HTTPStatus.OK, {"ok": True})
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
            # Avoid stale UI HTML due to browser caching when iterating locally.
            self._send_text(
                HTTPStatus.OK,
                _load_ui_html(),
                content_type="text/html; charset=utf-8",
                extra_headers={
                    "Cache-Control": "no-store, max-age=0",
                    "Pragma": "no-cache",
                },
            )
            return

        if path == "/events":
            self._handle_sse()
            return

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

        if self.path == "/api/control/clear":
            self._controller.clear_messages()
            self._send_json(HTTPStatus.OK, {"ok": True})
            return

        if self.path == "/api/control/shutdown":
            try:
                r = self._controller.request_shutdown()
            except Exception:
                r = {"ok": True}
            self._send_json(HTTPStatus.OK, r if isinstance(r, dict) else {"ok": True})
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

        # Minimal validation.
        if "id" not in obj or "kind" not in obj or "text" not in obj:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "missing_fields"})
            return

        self._state.add(obj)
        self._send_json(HTTPStatus.OK, {"ok": True})



_UI_INDEX_PATH = Path(__file__).with_name("ui") / "index.html"

def _load_ui_html() -> str:
    try:
        return _UI_INDEX_PATH.read_text(encoding="utf-8")
    except Exception:
        return (
            "<!doctype html><meta charset=\"utf-8\"/>"
            "<title>Codex Thinking Sidecar</title>"
            "<pre>UI file missing: {}\n".format(_UI_INDEX_PATH) + "</pre>"
        )


class SidecarServer:
    def __init__(self, host: str, port: int, max_messages: int, controller: Optional[Any] = None) -> None:
        self._host = host
        self._port = port
        self._state = _State(max_messages=max_messages)
        self._httpd = ThreadingHTTPServer((host, port), _Handler)
        # Attach state to server instance for handler access.
        self._httpd.state = self._state  # type: ignore[attr-defined]
        self._httpd.controller = controller  # type: ignore[attr-defined]
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
        except Exception:
            return
