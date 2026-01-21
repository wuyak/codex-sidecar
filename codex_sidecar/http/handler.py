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
from .sfx import list_sfx, read_custom_sfx_bytes
from .ui_assets import load_ui_text, resolve_ui_path, ui_content_type, ui_dir
from ..security import redact_sidecar_config
from ..offline import (
    build_offline_messages,
    offline_key_from_rel,
    list_offline_rollout_files,
    resolve_offline_rollout_path,
)


def _json_bytes(obj: dict) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

def _project_rel_path(p: str) -> str:
    """
    Best-effort: display a project-relative path (avoid leaking /home/<user>/... in UI).
    """
    s = str(p or "").strip()
    if not s:
        return ""
    try:
        cand = Path(s).expanduser()
        cwd = Path.cwd()
        try:
            cand_r = cand.resolve()
        except Exception:
            cand_r = cand
        try:
            cwd_r = cwd.resolve()
        except Exception:
            cwd_r = cwd
        try:
            rel = cand_r.relative_to(cwd_r)
            return str(rel) if str(rel) != "." else "."
        except Exception:
            return s
    except Exception:
        return s


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
        try:
            obj = json.loads(raw.decode("utf-8", errors="replace"))
        except Exception:
            if allow_invalid_json:
                obj = {}
            else:
                self._send_error(HTTPStatus.BAD_REQUEST, "invalid_json")
                return None
        if not isinstance(obj, dict):
            self._send_error(HTTPStatus.BAD_REQUEST, "invalid_payload")
            return None
        return obj

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
            raw_cfg = self._controller.get_config()
            cfg = redact_sidecar_config(raw_cfg) if isinstance(raw_cfg, dict) else raw_cfg
            # Display-only helpers (do not persist).
            try:
                if isinstance(cfg, dict):
                    cfg_home = str(cfg.get("config_home") or "")
                    cfg["config_home_display"] = _project_rel_path(cfg_home)
                    if cfg.get("config_home_display"):
                        cfg["config_file_display"] = str(Path(str(cfg["config_home_display"])) / "config.json")
            except Exception:
                pass
            payload = {"ok": True, "config": cfg}
            if isinstance(cfg, dict):
                payload.update(cfg)
            self._send_json(HTTPStatus.OK, payload)
            return

        if path == "/api/status":
            st = self._controller.status()
            try:
                if isinstance(st, dict) and isinstance(st.get("config"), dict):
                    st["config"] = redact_sidecar_config(st["config"])
                    cfg_home = str(st["config"].get("config_home") or "")
                    st["config"]["config_home_display"] = _project_rel_path(cfg_home)
                    if st["config"].get("config_home_display"):
                        st["config"]["config_file_display"] = str(
                            Path(str(st["config"]["config_home_display"])) / "config.json"
                        )
            except Exception:
                pass
            self._send_json(HTTPStatus.OK, st)
            return

        if path == "/api/sfx":
            try:
                cfg = self._controller.get_config()
            except Exception:
                cfg = {}
            try:
                cfg_home = Path(str((cfg or {}).get("config_home") or "")).expanduser()
            except Exception:
                cfg_home = Path.cwd()
            payload = list_sfx(cfg_home)
            try:
                if isinstance(cfg, dict) and isinstance(payload, dict):
                    payload["selected_assistant"] = str(cfg.get("notify_sound_assistant") or "none")
                    payload["selected_tool_gate"] = str(cfg.get("notify_sound_tool_gate") or "none")
            except Exception:
                pass
            self._send_json(HTTPStatus.OK, payload if isinstance(payload, dict) else {"ok": False})
            return

        if path.startswith("/api/sfx/file/"):
            name = path[len("/api/sfx/file/") :]
            try:
                cfg = self._controller.get_config()
            except Exception:
                cfg = {}
            try:
                cfg_home = Path(str((cfg or {}).get("config_home") or "")).expanduser()
            except Exception:
                cfg_home = Path.cwd()
            data, ct = read_custom_sfx_bytes(cfg_home, name)
            if data is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", ct or "application/octet-stream")
            self.send_header("Cache-Control", "no-store, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
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

        if path == "/api/offline/files":
            try:
                cfg = self._controller.get_config()
            except Exception:
                cfg = {}
            try:
                wh_raw = str((cfg or {}).get("watch_codex_home") or "").strip()
                codex_home = (Path(wh_raw).expanduser() if wh_raw else (Path.home() / ".codex"))
                try:
                    if codex_home.name == "sessions":
                        codex_home = codex_home.parent
                except Exception:
                    pass
            except Exception:
                codex_home = Path.home() / ".codex"
            try:
                sessions_dir = codex_home / "sessions"
                if not sessions_dir.exists() or not sessions_dir.is_dir():
                    self._send_json(HTTPStatus.OK, {"ok": False, "error": "sessions_not_found", "files": []})
                    return
            except Exception:
                self._send_json(HTTPStatus.OK, {"ok": False, "error": "sessions_not_found", "files": []})
                return
            try:
                limit = int((qs.get("limit") or ["60"])[0])
            except Exception:
                limit = 60
            limit = max(0, min(500, int(limit)))
            files = list_offline_rollout_files(codex_home, limit=limit)
            self._send_json(HTTPStatus.OK, {"ok": True, "files": files})
            return

        if path == "/api/offline/messages":
            try:
                cfg = self._controller.get_config()
            except Exception:
                cfg = {}
            try:
                wh_raw = str((cfg or {}).get("watch_codex_home") or "").strip()
                codex_home = (Path(wh_raw).expanduser() if wh_raw else (Path.home() / ".codex"))
                try:
                    if codex_home.name == "sessions":
                        codex_home = codex_home.parent
                except Exception:
                    pass
            except Exception:
                codex_home = Path.home() / ".codex"
            rel = str((qs.get("rel") or qs.get("path") or [""])[0] or "").strip()
            if not rel:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "missing_rel"})
                return
            try:
                tail_lines = int((qs.get("tail_lines") or qs.get("tail") or [""])[0] or 0)
            except Exception:
                tail_lines = 0
            if tail_lines <= 0:
                try:
                    tail_lines = int((cfg or {}).get("replay_last_lines") or 200)
                except Exception:
                    tail_lines = 200
            tail_lines = max(0, min(50000, int(tail_lines)))

            p = resolve_offline_rollout_path(codex_home, rel)
            if p is None:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_path"})
                return

            rel_norm = str(rel or "").strip().replace("\\", "/")
            while rel_norm.startswith("/"):
                rel_norm = rel_norm[1:]
            offline_key = offline_key_from_rel(rel_norm)
            msgs = build_offline_messages(rel=rel_norm, file_path=p, tail_lines=tail_lines, offline_key=offline_key)
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "rel": rel_norm,
                    "key": offline_key,
                    "file": str(p),
                    "messages": msgs,
                },
            )
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
        if self.path == "/api/config":
            obj = self._read_json_object(allow_invalid_json=False)
            if obj is None:
                return
            try:
                cfg = self._controller.update_config(obj)
            except ValueError as e:
                self._send_error(HTTPStatus.CONFLICT, str(e))
                return
            safe_cfg = redact_sidecar_config(cfg) if isinstance(cfg, dict) else cfg
            try:
                if isinstance(safe_cfg, dict):
                    cfg_home = str(safe_cfg.get("config_home") or "")
                    safe_cfg["config_home_display"] = _project_rel_path(cfg_home)
                    if safe_cfg.get("config_home_display"):
                        safe_cfg["config_file_display"] = str(Path(str(safe_cfg["config_home_display"])) / "config.json")
            except Exception:
                pass
            payload = {"ok": True, "config": safe_cfg}
            if isinstance(safe_cfg, dict):
                payload.update(safe_cfg)
            self._send_json(HTTPStatus.OK, payload)
            return

        if self.path == "/api/control/start":
            self._send_json(HTTPStatus.OK, self._controller.start())
            return

        if self.path == "/api/control/stop":
            self._send_json(HTTPStatus.OK, self._controller.stop())
            return

        if self.path == "/api/control/retranslate":
            obj = self._read_json_object(allow_invalid_json=True)
            if obj is None:
                return
            mid = str(obj.get("id") or obj.get("mid") or obj.get("msg_id") or "")
            self._send_json(HTTPStatus.OK, self._controller.retranslate(mid))
            return

        if self.path == "/api/control/translate_text":
            obj = self._read_json_object(allow_invalid_json=True)
            if obj is None:
                return
            self._handle_translate_text(obj)
            return

        if self.path == "/api/control/translate_probe":
            # No payload needed; probes current translator config.
            self._send_json(HTTPStatus.OK, self._controller.translate_probe())
            return

        if self.path == "/api/control/reveal_secret":
            obj = self._read_json_object(allow_invalid_json=True)
            if obj is None:
                return
            provider = str(obj.get("provider") or obj.get("p") or "")
            field = str(obj.get("field") or obj.get("k") or "")
            profile = str(obj.get("profile") or obj.get("profile_name") or "")
            self._send_json(HTTPStatus.OK, self._controller.reveal_secret(provider, field, profile=profile))
            return

        if self.path == "/api/control/follow":
            obj = self._read_json_object(allow_invalid_json=True)
            if obj is None:
                return
            mode = str(obj.get("mode") or obj.get("selection_mode") or "auto")
            thread_id = str(obj.get("thread_id") or obj.get("threadId") or "")
            file = str(obj.get("file") or "")
            self._send_json(HTTPStatus.OK, self._controller.set_follow(mode, thread_id=thread_id, file=file))
            return

        if self.path == "/api/control/follow_excludes":
            obj = self._read_json_object(allow_invalid_json=True)
            if obj is None:
                return
            keys = obj.get("keys") or obj.get("exclude_keys") or obj.get("thread_keys") or []
            files = obj.get("files") or obj.get("exclude_files") or []
            if not isinstance(keys, list):
                keys = []
            if not isinstance(files, list):
                files = []
            self._send_json(HTTPStatus.OK, self._controller.set_follow_excludes(keys=keys, files=files))
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

        if self.path == "/api/offline/translate":
            obj = self._read_json_object(allow_invalid_json=True)
            if obj is None:
                return
            self._handle_translate_text(obj)
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
