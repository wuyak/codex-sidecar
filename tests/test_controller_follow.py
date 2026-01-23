import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codex_sidecar.controller import SidecarController
from codex_sidecar.http.state import SidecarState


class _FakeWatcher:
    def __init__(self) -> None:
        self.calls = []

    def set_follow(self, mode: str, *, thread_id: str = "", file: str = "") -> None:
        self.calls.append((mode, str(thread_id), str(file)))


class TestControllerFollow(unittest.TestCase):
    def test_set_follow_normalizes_and_applies(self) -> None:
        with TemporaryDirectory() as td:
            st = SidecarState(max_messages=10)
            ctl = SidecarController(config_home=Path(td), server_url="http://127.0.0.1:1", state=st)

            w = _FakeWatcher()
            with ctl._lock:
                ctl._watcher = w  # type: ignore[assignment]

            r = ctl.set_follow(" BAD ", thread_id=" t ", file=" f ")
            self.assertEqual(r.get("ok"), True)
            self.assertEqual(r.get("mode"), "auto")
            self.assertEqual(r.get("thread_id"), "t")
            self.assertEqual(r.get("file"), "f")
            self.assertEqual(w.calls, [("auto", "t", "f")])


if __name__ == "__main__":
    unittest.main()

