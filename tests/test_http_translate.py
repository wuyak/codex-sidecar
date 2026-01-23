import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from typing import Any, Dict, Tuple

from codex_sidecar.http.handler import SidecarHandler
from codex_sidecar.http.state import SidecarState


class _FakeController:
    def translate_text(self, text: str):
        return {"ok": True, "zh": f"ZH:{text}"}

    def translate_items(self, items):
        out = []
        for it in items:
            if not isinstance(it, dict):
                continue
            mid = str(it.get("id") or "")
            txt = str(it.get("text") or "")
            out.append({"id": mid, "zh": f"ZH:{txt}", "error": ""})
        return {"ok": True, "items": out}


def _post_json(port: int, path: str, *, obj=None, raw: bytes = b"") -> Tuple[int, Dict[str, Any]]:
    url = f"http://127.0.0.1:{int(port)}/{path.lstrip('/')}"
    if raw:
        data = raw
    else:
        data = json.dumps(obj if obj is not None else {}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return int(resp.status), json.loads(body)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(body) if body else {}
        except Exception:
            payload = {}
        return int(getattr(e, "code", 0) or 0), payload


class TestHttpTranslate(unittest.TestCase):
    def setUp(self) -> None:
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), SidecarHandler)
        self.httpd.state = SidecarState(max_messages=20)  # type: ignore[attr-defined]
        self.httpd.controller = _FakeController()  # type: ignore[attr-defined]
        self.port = int(self.httpd.server_address[1])
        t = threading.Thread(target=self.httpd.serve_forever, name="test-httpd", daemon=True)
        t.start()
        self._thread = t

    def tearDown(self) -> None:
        try:
            self.httpd.shutdown()
            self.httpd.server_close()
        except Exception:
            pass
        try:
            self._thread.join(timeout=0.5)
        except Exception:
            pass

    def test_translate_text_invalid_json_is_tolerated(self) -> None:
        # Historically, translate_text endpoints tolerate invalid JSON and treat it as {}.
        st, data = _post_json(self.port, "/api/control/translate_text", raw=b"{")
        self.assertEqual(st, 200)
        self.assertEqual(data.get("ok"), True)
        self.assertEqual(data.get("zh"), "ZH:")

    def test_translate_text_rejects_non_object_payload(self) -> None:
        st, data = _post_json(self.port, "/api/control/translate_text", raw=b"[]")
        self.assertEqual(st, 400)
        self.assertEqual(data.get("ok"), False)
        self.assertEqual(data.get("error"), "invalid_payload")

    def test_translate_text_items_shape(self) -> None:
        st, data = _post_json(
            self.port,
            "/api/control/translate_text",
            obj={"items": [{"id": "a", "text": "x"}]},
        )
        self.assertEqual(st, 200)
        self.assertEqual(data.get("ok"), True)
        self.assertEqual(data.get("items"), [{"id": "a", "zh": "ZH:x", "error": ""}])

    def test_offline_translate_reuses_translate_text_logic(self) -> None:
        st, data = _post_json(
            self.port,
            "/api/offline/translate",
            obj={"items": [{"id": "a", "text": "x"}]},
        )
        self.assertEqual(st, 200)
        self.assertEqual(data.get("ok"), True)
        self.assertEqual(data.get("items"), [{"id": "a", "zh": "ZH:x", "error": ""}])


if __name__ == "__main__":
    unittest.main()
