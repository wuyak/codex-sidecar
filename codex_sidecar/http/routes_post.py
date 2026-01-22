import json
import threading
import time
from http import HTTPStatus


def dispatch_post(h) -> None:
    """
    POST 路由分发（从 SidecarHandler.do_POST 拆分）。

    说明：
    - h 为 BaseHTTPRequestHandler 的实例（SidecarHandler）。
    - 本模块不依赖具体 handler 类型，仅调用其约定的内部方法/属性。
    """
    # Control plane (JSON).
    if h.path == "/api/config":
        obj = h._read_json_object(allow_invalid_json=False)
        if obj is None:
            return
        try:
            cfg = h._controller.update_config(obj)
        except ValueError as e:
            h._send_error(HTTPStatus.CONFLICT, str(e))
            return
        h._send_json(HTTPStatus.OK, h._build_config_payload(cfg))
        return

    if h.path == "/api/control/start":
        h._send_json(HTTPStatus.OK, h._controller.start())
        return

    if h.path == "/api/control/stop":
        h._send_json(HTTPStatus.OK, h._controller.stop())
        return

    if h.path == "/api/control/retranslate":
        obj = h._read_json_object(allow_invalid_json=True)
        if obj is None:
            return
        mid = str(obj.get("id") or obj.get("mid") or obj.get("msg_id") or "")
        h._send_json(HTTPStatus.OK, h._controller.retranslate(mid))
        return

    if h.path == "/api/control/translate_text":
        obj = h._read_json_object(allow_invalid_json=True)
        if obj is None:
            return
        h._handle_translate_text(obj)
        return

    if h.path == "/api/control/translate_probe":
        # No payload needed; probes current translator config.
        h._send_json(HTTPStatus.OK, h._controller.translate_probe())
        return

    if h.path == "/api/control/reveal_secret":
        obj = h._read_json_object(allow_invalid_json=True)
        if obj is None:
            return
        provider = str(obj.get("provider") or obj.get("p") or "")
        field = str(obj.get("field") or obj.get("k") or "")
        profile = str(obj.get("profile") or obj.get("profile_name") or "")
        h._send_json(HTTPStatus.OK, h._controller.reveal_secret(provider, field, profile=profile))
        return

    if h.path == "/api/control/follow":
        obj = h._read_json_object(allow_invalid_json=True)
        if obj is None:
            return
        mode = str(obj.get("mode") or obj.get("selection_mode") or "auto")
        thread_id = str(obj.get("thread_id") or obj.get("threadId") or "")
        file = str(obj.get("file") or "")
        h._send_json(HTTPStatus.OK, h._controller.set_follow(mode, thread_id=thread_id, file=file))
        return

    if h.path == "/api/control/follow_excludes":
        obj = h._read_json_object(allow_invalid_json=True)
        if obj is None:
            return
        keys = obj.get("keys") or obj.get("exclude_keys") or obj.get("thread_keys") or []
        files = obj.get("files") or obj.get("exclude_files") or []
        if not isinstance(keys, list):
            keys = []
        if not isinstance(files, list):
            files = []
        h._send_json(HTTPStatus.OK, h._controller.set_follow_excludes(keys=keys, files=files))
        return

    if h.path == "/api/control/restart_process":
        # Respond first, then restart asynchronously; otherwise the process may re-exec/exit
        # before the response body is fully written.
        h._send_json(HTTPStatus.OK, {"ok": True})

        def _restart_later() -> None:
            time.sleep(0.06)
            try:
                h._controller.request_restart()
            except Exception:
                return

        threading.Thread(target=_restart_later, name="sidecar-restart", daemon=True).start()
        return

    if h.path == "/api/control/clear":
        h._controller.clear_messages()
        h._send_json(HTTPStatus.OK, {"ok": True})
        return

    if h.path == "/api/control/shutdown":
        # Respond first, then shutdown asynchronously; otherwise the process may exit
        # before the response body is fully written, causing clients to see a truncated transfer.
        h._send_json(HTTPStatus.OK, {"ok": True})

        def _shutdown_later() -> None:
            time.sleep(0.05)
            try:
                h._controller.request_shutdown()
            except Exception:
                return

        threading.Thread(target=_shutdown_later, name="sidecar-shutdown", daemon=True).start()
        return

    if h.path == "/api/offline/translate":
        obj = h._read_json_object(allow_invalid_json=True)
        if obj is None:
            return
        h._handle_translate_text(obj)
        return

    if h.path != "/ingest":
        h._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
        return

    length = int(h.headers.get("Content-Length") or "0")
    if length <= 0:
        h._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "empty_body"})
        return

    raw = h.rfile.read(length)
    try:
        obj = json.loads(raw.decode("utf-8", errors="replace"))
    except Exception:
        h._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_json"})
        return

    if not isinstance(obj, dict):
        h._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_payload"})
        return

    op = str(obj.get("op") or "").strip().lower()
    if op == "update":
        if "id" not in obj:
            h._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "missing_id"})
            return
        h._state.add(obj)
        h._send_json(HTTPStatus.OK, {"ok": True, "op": "update"})
        return

    # Minimal validation for normal ingest.
    if "id" not in obj or "kind" not in obj or "text" not in obj:
        h._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "missing_fields"})
        return

    h._state.add(obj)
    h._send_json(HTTPStatus.OK, {"ok": True, "op": "add"})

