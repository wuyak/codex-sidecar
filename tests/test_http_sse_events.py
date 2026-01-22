import json
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

from codex_sidecar.http.handler import SidecarHandler
from codex_sidecar.http.state import SidecarState


class _FakeController:
    def get_config(self) -> dict:
        return {}

    def update_config(self, _patch: dict) -> dict:
        return {}

    def status(self) -> dict:
        return {"ok": True}


class TestHttpSseEvents(unittest.TestCase):
    def setUp(self) -> None:
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), SidecarHandler)
        self.httpd.state = SidecarState(max_messages=10)  # type: ignore[attr-defined]
        self.httpd.controller = _FakeController()  # type: ignore[attr-defined]
        self.port = int(self.httpd.server_address[1])
        t = threading.Thread(target=self.httpd.serve_forever, name="test-httpd-sse", daemon=True)
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

    def test_events_stream_emits_json_payload(self) -> None:
        url = f"http://127.0.0.1:{int(self.port)}/events"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            # Initial comment to establish the stream.
            self.assertEqual(resp.readline(), b":ok\n")
            self.assertEqual(resp.readline(), b"\n")

            # Publish a message and ensure the SSE handler can JSON-encode it.
            self.httpd.state.add({"id": "m1", "kind": "assistant", "text": "hi"})  # type: ignore[attr-defined]

            self.assertEqual(resp.readline(), b"event: message\n")
            data_line = resp.readline()
            self.assertTrue(data_line.startswith(b"data: "), msg=data_line)
            payload = data_line[len(b"data: ") :].decode("utf-8", errors="replace").strip()
            obj = json.loads(payload)
            self.assertEqual(obj.get("id"), "m1")


if __name__ == "__main__":
    unittest.main()

