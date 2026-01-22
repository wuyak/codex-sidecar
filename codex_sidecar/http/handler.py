import queue
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, Dict, Optional

from .state import SidecarState
from .routes_get import dispatch_get
from .routes_post import dispatch_post
from .ui_assets import load_ui_text, resolve_ui_path, ui_content_type, ui_dir
from .json_helpers import json_bytes, parse_json_object
from .config_payload import apply_config_display_fields, build_config_payload, decorate_status_payload
from .sse import parse_last_event_id, sse_message_event_bytes


class SidecarHandler(BaseHTTPRequestHandler):
    server_version = "codex-sidecar/0.1"

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
        body = json_bytes(obj)
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

    def _send_error(self, status: int, error: str, extra: Optional[Dict[str, Any]] = None) -> None:
        obj: Dict[str, Any] = {"ok": False, "error": str(error or "")}
        if isinstance(extra, dict):
            obj.update(extra)
        self._send_json(status, obj)

    def _read_json_object(self, *, allow_invalid_json: bool) -> Optional[Dict[str, Any]]:
        """
        Read request body as a JSON object.

        - allow_invalid_json=True: invalid JSON falls back to {} (compat for control endpoints).
        - allow_invalid_json=False: invalid JSON returns 400 invalid_json.
        """
        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        obj, err = parse_json_object(raw, allow_invalid_json=allow_invalid_json)
        if err:
            self._send_error(HTTPStatus.BAD_REQUEST, err)
            return None
        return obj

    def _controller_config_best_effort(self) -> Dict[str, Any]:
        """
        Best-effort fetch of controller config for endpoints that can tolerate failure.
        """
        try:
            cfg = self._controller.get_config()
        except Exception:
            cfg = {}
        return cfg if isinstance(cfg, dict) else {}

    def _config_home_best_effort(self, cfg: Optional[Dict[str, Any]] = None) -> Path:
        src = cfg if isinstance(cfg, dict) else {}
        try:
            return Path(str((src or {}).get("config_home") or "")).expanduser()
        except Exception:
            return Path.cwd()

    def _watch_codex_home_best_effort(self, cfg: Optional[Dict[str, Any]] = None) -> Path:
        """
        Resolve CODEX_HOME to watch, based on controller config (best-effort).

        Notes:
        - UI may pass a sessions/** path; normalize to its parent.
        - Fallback is ~/.codex.
        """
        src = cfg if isinstance(cfg, dict) else {}
        try:
            wh_raw = str((src or {}).get("watch_codex_home") or "").strip()
            codex_home = (Path(wh_raw).expanduser() if wh_raw else (Path.home() / ".codex"))
            try:
                if codex_home.name == "sessions":
                    codex_home = codex_home.parent
            except Exception:
                pass
            return codex_home
        except Exception:
            return Path.home() / ".codex"

    def _apply_config_display_fields(self, cfg: Dict[str, Any]) -> None:
        apply_config_display_fields(cfg)

    def _build_config_payload(self, raw_cfg: Any) -> Dict[str, Any]:
        return build_config_payload(raw_cfg)

    def _decorate_status_payload(self, st: Any) -> Any:
        return decorate_status_payload(st)

    def _handle_translate_text(self, obj: Dict[str, Any]) -> None:
        items = obj.get("items")
        if isinstance(items, list):
            try:
                r = self._controller.translate_items(items)
            except Exception:
                r = {"ok": False, "error": "translate_failed", "items": []}
            out_items = []
            try:
                out_items = r.get("items") if isinstance(r, dict) and isinstance(r.get("items"), list) else []
            except Exception:
                out_items = []
            # Keep legacy shape: always return {ok:true, items:[...]} and surface per-item errors.
            self._send_json(HTTPStatus.OK, {"ok": True, "items": out_items})
            return

        text = str(obj.get("text") or "")
        self._send_json(HTTPStatus.OK, self._controller.translate_text(text))

    def do_GET(self) -> None:
        dispatch_get(self)

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
            root = ui_dir()
            cand = resolve_ui_path(rel, root_dir=root)
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
            # Serve binary assets (audio, etc.) as bytes.
            if (ct.startswith("audio/")) or (cand.suffix.lower() in (".ogg", ".mp3", ".wav", ".woff2", ".woff", ".ttf", ".otf")):
                data = cand.read_bytes()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", ct)
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            body = load_ui_text(cand, "")
            self._send_text(HTTPStatus.OK, body, content_type=ct, extra_headers=headers)
        except Exception:
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})

    def _handle_sse(self) -> None:
        # If present, resume from Last-Event-ID (EventSource reconnect).
        last_event_id = parse_last_event_id(self.headers)
        last_sent_add_seq = int(last_event_id or 0)

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

            # Best-effort catch-up: only when the client provides Last-Event-ID.
            # Avoid replaying full history on first connect (UI already does /api/messages).
            if last_event_id is not None:
                try:
                    for m in self._state.list_messages():
                        try:
                            seq = int(m.get("seq") or 0)
                        except Exception:
                            continue
                        if seq <= int(last_event_id or 0):
                            continue
                        id_line, out = sse_message_event_bytes(m)
                        if id_line is not None:
                            self.wfile.write(id_line)
                        self.wfile.write(out)
                        last_sent_add_seq = max(last_sent_add_seq, int(seq or 0))
                    self.wfile.flush()
                except Exception:
                    pass

            while True:
                try:
                    msg = q.get(timeout=10.0)
                except queue.Empty:
                    # heartbeat
                    self.wfile.write(b":ping\n\n")
                    self.wfile.flush()
                    continue

                # Skip duplicates already delivered via resume catch-up.
                try:
                    op = str(msg.get("op") or "").strip().lower()
                except Exception:
                    op = ""
                if op != "update":
                    try:
                        seq = int(msg.get("seq") or 0)
                    except Exception:
                        seq = 0
                    if seq and seq <= last_sent_add_seq:
                        continue
                    last_sent_add_seq = max(last_sent_add_seq, int(seq or 0))

                id_line, out = sse_message_event_bytes(msg)
                if id_line is not None:
                    self.wfile.write(id_line)
                self.wfile.write(out)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return
        finally:
            self._state.unsubscribe(q)

    def do_POST(self) -> None:
        dispatch_post(self)
