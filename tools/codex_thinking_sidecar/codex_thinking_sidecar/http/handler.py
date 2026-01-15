import json
import os
import queue
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, urlparse

from .state import SidecarState
from .ui_assets import load_ui_text, resolve_ui_path, ui_content_type


def _json_bytes(obj: dict) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class SidecarHandler(BaseHTTPRequestHandler):
    server_version = "codex-thinking-sidecar/0.1"

    @property
    def _state(self) -> SidecarState:
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
        - Rel path is sanitized and forced to stay inside ui/ dir.
        """
        headers = {
            "Cache-Control": "no-store, max-age=0",
            "Pragma": "no-cache",
        }
        try:
            cand = resolve_ui_path(rel)
            if cand is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
                return
            if not cand.exists() or not cand.is_file():
                # Keep dev-friendly fallbacks for common asset types.
                rel_norm = str(rel or "")
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
            ct = ui_content_type(cand)
            body = load_ui_text(cand, "")
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

        if self.path == "/api/control/retranslate":
            length = int(self.headers.get("Content-Length") or "0")
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                obj = json.loads(raw.decode("utf-8", errors="replace"))
            except Exception:
                obj = {}
            if not isinstance(obj, dict):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_payload"})
                return
            mid = str(obj.get("id") or obj.get("mid") or obj.get("msg_id") or "")
            self._send_json(HTTPStatus.OK, self._controller.retranslate(mid))
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
