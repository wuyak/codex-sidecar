import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Tuple

from codex_sidecar.http.handler import SidecarHandler
from codex_sidecar.http.state import SidecarState


class _FakeController:
    def __init__(self) -> None:
        self._cfg: Dict[str, Any] = {"config_home": str(Path.cwd() / "config" / "sidecar")}

    def get_config(self) -> Dict[str, Any]:
        return dict(self._cfg)


def _post_raw(port: int, path: str, data: bytes, *, content_type: str = "application/json; charset=utf-8") -> Tuple[int, Dict[str, Any]]:
    url = f"http://127.0.0.1:{int(port)}/{path.lstrip('/')}"
    req = urllib.request.Request(url, data=data, method="POST")
    if content_type:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return int(resp.status), json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        try:
            obj = json.loads(body) if body else {}
        except Exception:
            obj = {}
        return int(e.code), obj


class TestHttpIngest(unittest.TestCase):
    def setUp(self) -> None:
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), SidecarHandler)
        self.httpd.state = SidecarState(max_messages=10)  # type: ignore[attr-defined]
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

    def test_empty_body(self) -> None:
        st, data = _post_raw(self.port, "/ingest", b"")
        self.assertEqual(st, 400)
        self.assertEqual(data.get("ok"), False)
        self.assertEqual(data.get("error"), "empty_body")

    def test_invalid_json(self) -> None:
        st, data = _post_raw(self.port, "/ingest", b"{bad")
        self.assertEqual(st, 400)
        self.assertEqual(data.get("error"), "invalid_json")

    def test_invalid_payload(self) -> None:
        st, data = _post_raw(self.port, "/ingest", json.dumps([1]).encode("utf-8"))
        self.assertEqual(st, 400)
        self.assertEqual(data.get("error"), "invalid_payload")

    def test_add_then_update(self) -> None:
        st1, data1 = _post_raw(self.port, "/ingest", json.dumps({"id": "a", "kind": "assistant_message", "text": "hi"}).encode("utf-8"))
        self.assertEqual(st1, 200)
        self.assertEqual(data1.get("ok"), True)
        self.assertEqual(data1.get("op"), "add")

        st2, data2 = _post_raw(self.port, "/ingest", json.dumps({"op": "update"}).encode("utf-8"))
        self.assertEqual(st2, 400)
        self.assertEqual(data2.get("error"), "missing_id")

        st3, data3 = _post_raw(self.port, "/ingest", json.dumps({"op": "update", "id": "a", "zh": "ZH"}).encode("utf-8"))
        self.assertEqual(st3, 200)
        self.assertEqual(data3.get("ok"), True)
        self.assertEqual(data3.get("op"), "update")

        msg = self.httpd.state.get_message("a")  # type: ignore[attr-defined]
        self.assertIsInstance(msg, dict)
        self.assertEqual(msg.get("zh"), "ZH")


if __name__ == "__main__":
    unittest.main()

