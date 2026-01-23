import json
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Tuple

from codex_sidecar.http.handler import SidecarHandler
from codex_sidecar.http.state import SidecarState


class _FakeController:
    def __init__(self, *, config_home: str) -> None:
        self._cfg: Dict[str, Any] = {
            "config_home": str(config_home),
            "watch_codex_home": str(Path.home() / ".codex"),
            "translate_mode": "auto",
            "translator_provider": "openai",
            "translator_config": {},
        }

    def get_config(self) -> Dict[str, Any]:
        return dict(self._cfg)

    def update_config(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        for k, v in (patch or {}).items():
            self._cfg[k] = v
        return dict(self._cfg)

    def status(self) -> Dict[str, Any]:
        return {"ok": True, "pid": 123, "running": False, "config": dict(self._cfg)}


def _get_json(port: int, path: str) -> Tuple[int, Dict[str, Any]]:
    url = f"http://127.0.0.1:{int(port)}/{path.lstrip('/')}"
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=2.0) as resp:
        body = resp.read().decode("utf-8", errors="replace")
        return int(resp.status), json.loads(body) if body else {}


def _post_json(port: int, path: str, obj: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
    url = f"http://127.0.0.1:{int(port)}/{path.lstrip('/')}"
    data = json.dumps(obj if obj is not None else {}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    with urllib.request.urlopen(req, timeout=2.0) as resp:
        body = resp.read().decode("utf-8", errors="replace")
        return int(resp.status), json.loads(body) if body else {}


class TestHttpConfigStatus(unittest.TestCase):
    def setUp(self) -> None:
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), SidecarHandler)
        self.httpd.state = SidecarState(max_messages=10)  # type: ignore[attr-defined]
        cfg_home = str(Path.cwd() / "config" / "sidecar")
        self.httpd.controller = _FakeController(config_home=cfg_home)  # type: ignore[attr-defined]
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

    def test_get_config_includes_display_fields(self) -> None:
        st, data = _get_json(self.port, "/api/config")
        self.assertEqual(st, 200)
        self.assertEqual(data.get("ok"), True)
        cfg = data.get("config")
        self.assertIsInstance(cfg, dict)
        self.assertIn("config_home_display", cfg)
        self.assertIn("config_file_display", cfg)
        # Handler also spreads config keys to top-level for backwards-compat.
        self.assertEqual(data.get("translate_mode"), "auto")

    def test_post_config_then_status_is_responsive(self) -> None:
        st1, data1 = _post_json(self.port, "/api/config", {"translate_mode": "manual"})
        self.assertEqual(st1, 200)
        self.assertEqual(data1.get("ok"), True)
        st2, data2 = _get_json(self.port, "/api/status")
        self.assertEqual(st2, 200)
        self.assertEqual(data2.get("ok"), True)
        cfg = data2.get("config")
        self.assertIsInstance(cfg, dict)
        self.assertEqual(cfg.get("translate_mode"), "manual")
        # Display fields should also be present in status.config (best-effort).
        self.assertIn("config_home_display", cfg)
        self.assertIn("config_file_display", cfg)


if __name__ == "__main__":
    unittest.main()

