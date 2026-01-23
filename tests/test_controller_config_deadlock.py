import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codex_sidecar.controller import SidecarController
from codex_sidecar.http.state import SidecarState


class TestControllerConfigDeadlock(unittest.TestCase):
    def test_update_config_does_not_deadlock(self) -> None:
        with TemporaryDirectory() as td:
            st = SidecarState(max_messages=10)
            ctl = SidecarController(config_home=Path(td), server_url="http://127.0.0.1:1", state=st)

            out = {}
            err = {}

            def _worker() -> None:
                nonlocal out, err
                try:
                    out = ctl.update_config({"translate_mode": "manual"})
                except Exception as e:
                    err["e"] = e

            t = threading.Thread(target=_worker, name="test-update-config", daemon=True)
            t.start()
            t.join(timeout=1.0)

            self.assertFalse(t.is_alive(), "update_config deadlocked")
            self.assertEqual(err, {})
            self.assertIsInstance(out, dict)
            self.assertEqual(str(out.get("translate_mode") or ""), "manual")


if __name__ == "__main__":
    unittest.main()

