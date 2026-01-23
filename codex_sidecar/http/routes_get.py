import os
from http import HTTPStatus
from typing import Any, Dict
from urllib.parse import parse_qs, urlparse

from .sfx import list_sfx, read_custom_sfx_bytes
from ..offline import (
    build_offline_messages,
    list_offline_rollout_files,
    offline_key_from_rel,
    resolve_offline_rollout_path,
)


def dispatch_get(h) -> None:
    """
    GET 路由分发（从 SidecarHandler.do_GET 拆分）。

    说明：
    - h 为 BaseHTTPRequestHandler 的实例（SidecarHandler）。
    - 本模块不依赖具体 handler 类型，仅调用其约定的内部方法/属性。
    """
    u = urlparse(h.path)
    path = u.path
    qs = parse_qs(u.query or "")

    if path == "/health":
        h._send_json(HTTPStatus.OK, {"ok": True, "pid": os.getpid()})
        return

    if path == "/api/messages":
        msgs = h._state.list_messages()
        thread_id = (qs.get("thread_id") or [""])[0]
        if thread_id:
            msgs = [m for m in msgs if str(m.get("thread_id") or "") == thread_id]
        h._send_json(HTTPStatus.OK, {"messages": msgs})
        return

    if path == "/api/threads":
        h._send_json(HTTPStatus.OK, {"threads": h._state.list_threads()})
        return

    if path == "/api/config":
        raw_cfg = h._controller.get_config()
        h._send_json(HTTPStatus.OK, h._build_config_payload(raw_cfg))
        return

    if path == "/api/status":
        st = h._controller.status()
        h._send_json(HTTPStatus.OK, h._decorate_status_payload(st))
        return

    if path == "/api/sfx":
        cfg = h._controller_config_best_effort()
        cfg_home = h._config_home_best_effort(cfg)
        payload = list_sfx(cfg_home)
        try:
            if isinstance(cfg, dict) and isinstance(payload, dict):
                payload["selected_assistant"] = str(cfg.get("notify_sound_assistant") or "none")
                payload["selected_tool_gate"] = str(cfg.get("notify_sound_tool_gate") or "none")
        except Exception:
            pass
        h._send_json(HTTPStatus.OK, payload if isinstance(payload, dict) else {"ok": False})
        return

    if path.startswith("/api/sfx/file/"):
        name = path[len("/api/sfx/file/") :]
        cfg = h._controller_config_best_effort()
        cfg_home = h._config_home_best_effort(cfg)
        data, ct = read_custom_sfx_bytes(cfg_home, name)
        if data is None:
            h._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
            return
        h.send_response(HTTPStatus.OK)
        h.send_header("Content-Type", ct or "application/octet-stream")
        h.send_header("Cache-Control", "no-store, max-age=0")
        h.send_header("Pragma", "no-cache")
        h.send_header("Content-Length", str(len(data)))
        h.end_headers()
        h.wfile.write(data)
        return

    if path == "/api/translators":
        payload = h._controller.translators()
        try:
            translators = payload.get("translators")
            if isinstance(translators, list):
                for t in translators:
                    if isinstance(t, dict) and "id" in t and "name" not in t:
                        t["name"] = t["id"]
        except Exception:
            pass
        h._send_json(HTTPStatus.OK, payload)
        return

    if path == "/api/offline/files":
        cfg = h._controller_config_best_effort()
        codex_home = h._watch_codex_home_best_effort(cfg)
        try:
            sessions_dir = codex_home / "sessions"
            if not sessions_dir.exists() or not sessions_dir.is_dir():
                h._send_json(HTTPStatus.OK, {"ok": False, "error": "sessions_not_found", "files": []})
                return
        except Exception:
            h._send_json(HTTPStatus.OK, {"ok": False, "error": "sessions_not_found", "files": []})
            return
        try:
            limit = int((qs.get("limit") or ["60"])[0])
        except Exception:
            limit = 60
        limit = max(0, min(500, int(limit)))
        files = list_offline_rollout_files(codex_home, limit=limit)
        h._send_json(HTTPStatus.OK, {"ok": True, "files": files})
        return

    if path == "/api/offline/messages":
        cfg = h._controller_config_best_effort()
        codex_home = h._watch_codex_home_best_effort(cfg)
        rel = str((qs.get("rel") or qs.get("path") or [""])[0] or "").strip()
        if not rel:
            h._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "missing_rel"})
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
            h._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_path"})
            return

        rel_norm = str(rel or "").strip().replace("\\", "/")
        while rel_norm.startswith("/"):
            rel_norm = rel_norm[1:]
        offline_key = offline_key_from_rel(rel_norm)
        msgs = build_offline_messages(rel=rel_norm, file_path=p, tail_lines=tail_lines, offline_key=offline_key)
        h._send_json(
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
        h._serve_ui_file("index.html")
        return

    if path.startswith("/ui/"):
        rel = path[len("/ui/") :]
        if not rel or rel == "index.html":
            rel = "index.html"
        h._serve_ui_file(rel)
        return

    if path == "/events":
        h._handle_sse()
        return

    h._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})

