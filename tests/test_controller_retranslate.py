import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codex_sidecar.controller import SidecarController
from codex_sidecar.http.state import SidecarState


class _AliveThread:
    def is_alive(self) -> bool:
        return True


class _FakeWatcher:
    def __init__(self, *, ok: bool) -> None:
        self._ok = ok
        self.calls = []

    def retranslate(self, mid: str, *, text: str, thread_key: str, fallback_zh: str = "") -> bool:
        self.calls.append((mid, text, thread_key, fallback_zh))
        return bool(self._ok)


class TestControllerRetranslate(unittest.TestCase):
    def test_missing_id(self) -> None:
        with TemporaryDirectory() as td:
            st = SidecarState(max_messages=10)
            ctl = SidecarController(config_home=Path(td), server_url="http://127.0.0.1:1", state=st)
            r = ctl.retranslate("   ")
            self.assertEqual(r.get("ok"), False)
            self.assertEqual(r.get("error"), "missing_id")

    def test_not_found(self) -> None:
        with TemporaryDirectory() as td:
            st = SidecarState(max_messages=10)
            ctl = SidecarController(config_home=Path(td), server_url="http://127.0.0.1:1", state=st)
            r = ctl.retranslate("x")
            self.assertEqual(r.get("ok"), False)
            self.assertEqual(r.get("error"), "not_found")

    def test_not_thinking(self) -> None:
        with TemporaryDirectory() as td:
            st = SidecarState(max_messages=10)
            ctl = SidecarController(config_home=Path(td), server_url="http://127.0.0.1:1", state=st)
            st.add({"id": "m1", "kind": "assistant_message", "text": "hi"})
            r = ctl.retranslate("m1")
            self.assertEqual(r.get("ok"), False)
            self.assertEqual(r.get("error"), "not_thinking")

    def test_not_running(self) -> None:
        with TemporaryDirectory() as td:
            st = SidecarState(max_messages=10)
            ctl = SidecarController(config_home=Path(td), server_url="http://127.0.0.1:1", state=st)
            st.add({"id": "m1", "kind": "reasoning_summary", "text": "hi", "zh": "OLD"})
            r = ctl.retranslate("m1")
            self.assertEqual(r.get("ok"), False)
            self.assertEqual(r.get("error"), "not_running")

    def test_enqueue_failed(self) -> None:
        with TemporaryDirectory() as td:
            st = SidecarState(max_messages=10)
            ctl = SidecarController(config_home=Path(td), server_url="http://127.0.0.1:1", state=st)
            st.add({"id": "m1", "kind": "reasoning_summary", "text": "hi", "zh": "OLD", "thread_id": "t1"})
            fw = _FakeWatcher(ok=False)
            with ctl._lock:
                ctl._watcher = fw  # type: ignore[assignment]
                ctl._thread = _AliveThread()  # type: ignore[assignment]
            r = ctl.retranslate("m1")
            self.assertEqual(r.get("ok"), False)
            self.assertEqual(r.get("error"), "enqueue_failed")
            self.assertEqual(r.get("id"), "m1")
            self.assertEqual(r.get("queued"), False)
            self.assertEqual(len(fw.calls), 1)

    def test_ok_clears_translate_error(self) -> None:
        with TemporaryDirectory() as td:
            st = SidecarState(max_messages=10)
            ctl = SidecarController(config_home=Path(td), server_url="http://127.0.0.1:1", state=st)
            st.add(
                {
                    "id": "m1",
                    "kind": "reasoning_summary",
                    "text": "hi",
                    "zh": "OLD",
                    "translate_error": "ERR",
                    "thread_id": "t1",
                }
            )
            fw = _FakeWatcher(ok=True)
            with ctl._lock:
                ctl._watcher = fw  # type: ignore[assignment]
                ctl._thread = _AliveThread()  # type: ignore[assignment]
            r = ctl.retranslate("m1")
            self.assertEqual(r.get("ok"), True)
            self.assertEqual(r.get("id"), "m1")
            self.assertEqual(r.get("queued"), True)

            msg = st.get_message("m1")
            self.assertIsInstance(msg, dict)
            self.assertEqual(msg.get("zh"), "OLD")
            self.assertEqual(msg.get("translate_error"), "")


if __name__ == "__main__":
    unittest.main()

